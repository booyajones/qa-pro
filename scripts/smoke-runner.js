#!/usr/bin/env node
// qa-pro smoke runner — Playwright + axe-core + console-error capture
// Usage: node smoke-runner.js <config-json-path> [--full]
// Requires: npx playwright, @axe-core/playwright (auto-installed if missing)

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const cfgPath = process.argv[2];
const full = process.argv.includes('--full');
if (!cfgPath || !fs.existsSync(cfgPath)) { console.error('config json required'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

// Ensure Playwright available; install if needed
function ensure(pkg) {
  try { require.resolve(pkg, { paths: [process.cwd(), path.join(__dirname, '..')] }); return true; }
  catch { return false; }
}

if (!ensure('playwright')) {
  console.log('Installing playwright (one-time)...');
  execSync('npm install --no-save playwright @axe-core/playwright', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  execSync('npx playwright install chromium --with-deps', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
}

const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));
const AxeBuilder = require(path.join(__dirname, '..', 'node_modules', '@axe-core/playwright')).default;

(async () => {
  const findings = [];
  const startedAt = new Date().toISOString();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'qa-pro-smoke/1.3',
    reducedMotion: 'reduce',
  });

  // Determinism: freeze Date.now and Math.random
  await context.addInitScript(() => {
    const epoch = 1717286400000; // 2026-01-01
    const orig = Date.now;
    Date.now = () => epoch;
    const D = Date;
    // @ts-ignore
    Date = function(...args) { return args.length ? new D(...args) : new D(epoch); };
    Date.now = () => epoch;
    Object.setPrototypeOf(Date, D);
    Date.prototype = D.prototype;
    let s = 1; Math.random = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  });

  const pages = (cfg.pages && cfg.pages.length) ? cfg.pages : ['/'];

  for (const pPath of pages) {
    const url = new URL(pPath, cfg.test_url).toString();
    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];

    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', r => networkErrors.push(`${r.url()} :: ${r.failure()?.errorText}`));

    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      if (!resp || !resp.ok()) {
        findings.push({ severity: 1, layer: 'functional', page: pPath, finding: `page returned ${resp?.status()}`, url });
      } else {
        if (consoleErrors.length) findings.push({ severity: 2, layer: 'functional', page: pPath, finding: 'console errors', detail: consoleErrors.slice(0, 5), url });
        if (networkErrors.length) findings.push({ severity: 2, layer: 'functional', page: pPath, finding: 'network failures', detail: networkErrors.slice(0, 5), url });

        // axe-core a11y
        try {
          const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
          const critical = axe.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
          for (const v of critical) {
            findings.push({
              severity: v.impact === 'critical' ? 1 : 2,
              layer: 'a11y',
              page: pPath,
              finding: v.help,
              detail: { id: v.id, nodes: v.nodes.length, helpUrl: v.helpUrl },
              url,
            });
          }
          const minor = axe.violations.filter(v => v.impact === 'moderate' || v.impact === 'minor');
          for (const v of minor) {
            findings.push({ severity: 3, layer: 'a11y', page: pPath, finding: v.help, detail: { id: v.id, nodes: v.nodes.length }, url });
          }
        } catch (e) { findings.push({ severity: 3, layer: 'a11y', page: pPath, finding: `axe failed: ${e.message}`, url }); }

        // Functional: verify all <a> resolve
        try {
          const links = await page.$$eval('a[href]', as => as.map(a => a.href).filter(h => h.startsWith('http')));
          const unique = [...new Set(links)].slice(0, 30);
          for (const l of unique) {
            try {
              const r = await context.request.head(l, { timeout: 8000 });
              if (r.status() >= 400) findings.push({ severity: 3, layer: 'functional', page: pPath, finding: `broken link: ${l} (${r.status()})`, url });
            } catch {}
          }
        } catch {}
      }
    } catch (e) {
      findings.push({ severity: 1, layer: 'functional', page: pPath, finding: `navigation failed: ${e.message}`, url });
    }
    await page.close();
  }

  await browser.close();
  const finishedAt = new Date().toISOString();
  console.log(JSON.stringify({ project: cfg.name, test_url: cfg.test_url, startedAt, finishedAt, findings }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
