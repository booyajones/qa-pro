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

// Missing locked dependencies are a setup failure, not an implicit network install.
for (const pkg of ['playwright', '@axe-core/playwright']) {
  try { require.resolve(pkg, { paths: [path.join(__dirname, '..')] }); }
  catch { console.error(`missing ${pkg}; install this reviewed skill with npm ci`); process.exit(1); }
}

const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));
const AxeBuilder = require(path.join(__dirname, '..', 'node_modules', '@axe-core/playwright')).default;

// Landed-URL check: a page that redirects was never tested, and its findings would be the landing
// page's filed under the page asked for. Same origin and path; one trailing slash either way is the same page.
function landedElsewhere(askedUrl, landedUrl) {
  const asked = new URL(askedUrl), landed = new URL(landedUrl);
  const bare = u => u.pathname.replace(/\/$/, '');
  return asked.origin !== landed.origin || bare(asked) !== bare(landed);
}
// networkidle's own 500 ms quiet window absorbs a client-side redirect fired on load or after a fetch. For one
// fired later, this settle and the re-check after the checks work together (measured 2026-09-23 on 15 redirect
// fixtures: 8 caught without either, 10 with the settle only, 11 with the re-check only, 14 with both, as many as
// a 1000 ms settle; a 1 s timer and a 1 s meta refresh needed both; a timer 2 s after load got through).
const LANDED_SETTLE_MS = 500;

(async () => {
  const findings = [];
  const startedAt = new Date().toISOString();

  const requestedBrowser = process.argv[process.argv.indexOf("--browser") + 1];
  const engine = process.argv.includes("--browser") ? requestedBrowser : "chromium";
  if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error("unsupported browser engine");
  const browser = await require(path.join(__dirname, "..", "node_modules", "playwright"))[engine].launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'qa-pro-smoke/1.4',
    reducedMotion: 'reduce',
    storageState: cfg.storage_state,
  });

  // Determinism: freeze Date.now and Math.random
  await context.addInitScript(() => {
    const epoch = 1767225600000; // 2026-01-01 UTC
    const orig = Date.now;
    Date.now = () => epoch;
    const D = Date;
    // @ts-ignore
    Date = function(...args) { return new.target ? (args.length ? new D(...args) : new D(epoch)) : new D(epoch).toString(); };
    Date.now = () => epoch;
    Object.setPrototypeOf(Date, D);
    Date.prototype = D.prototype;
    let s = 1; Math.random = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  });

  // Load v1.1 check modules (lazy require so missing files don't break v1.0 install paths)
  const securityCheck = (() => { try { return require('./checks/security-headers'); } catch { return null; } })();
  const seoCheck = (() => { try { return require('./checks/seo'); } catch { return null; } })();
  const imagesCheck = (() => { try { return require('./checks/images'); } catch { return null; } })();
  const fourOhFourCheck = (() => { try { return require('./checks/404'); } catch { return null; } })();

  // The 404 probe's auth-wall test, so the two checks agree on what a sign-in gate looks like.
  const isAuthWallPath = fourOhFourCheck && fourOhFourCheck.isAuthWallPath;
  const landedFinding = (pPath, url, landedUrl) => ({
    severity: 1, layer: 'functional', page: pPath,
    finding: `landed on ${landedUrl}: the page itself was not tested`,
    detail: { landed: landedUrl, auth_wall: isAuthWallPath ? isAuthWallPath(new URL(landedUrl).pathname) : undefined },
    url,
  });

  const pages = (cfg.pages && cfg.pages.length) ? cfg.pages : ['/'];

  for (const pPath of pages) {
    const url = new URL(pPath, cfg.test_url).toString();
    const page = await context.newPage();
    const consoleErrors = [];
    const consoleWarnings = []; // v1.1 Module 5: deprecations + CSP + mixed-content
    const networkErrors = [];

    page.on('console', m => {
      const t = m.type();
      const text = m.text();
      if (t === 'error') consoleErrors.push(text);
      else if (t === 'warning' || t === 'warn') {
        // Match deprecation / CSP / mixed-content patterns
        if (/deprecated|will be removed|\[Deprecation\]|Mixed Content:|Content Security Policy:/i.test(text)) {
          consoleWarnings.push(text);
        }
      }
    });
    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', r => networkErrors.push(`${r.url()} :: ${r.failure()?.errorText}`));

    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      // Stash main response for security-headers check
      page._mainResponse = resp;
      context._lastResponse = resp;
      if (resp && resp.ok()) await page.waitForTimeout(LANDED_SETTLE_MS);
      const pageFindingsFrom = findings.length;
      if (!resp || !resp.ok()) {
        findings.push({ severity: 1, layer: 'functional', page: pPath, finding: `page returned ${resp?.status()}`, url });
      } else if (landedElsewhere(url, page.url())) {
        findings.push(landedFinding(pPath, url, page.url()));
      } else {
        if (consoleErrors.length) findings.push({ severity: 2, layer: 'functional', page: pPath, finding: 'console errors', detail: consoleErrors.slice(0, 5), url });
        if (networkErrors.length) findings.push({ severity: 2, layer: 'functional', page: pPath, finding: 'network failures', detail: networkErrors.slice(0, 5), url });
        if (consoleWarnings.length) findings.push({ severity: 3, layer: 'console-warn', page: pPath, finding: `${consoleWarnings.length} deprecation/CSP/mixed-content warning(s)`, detail: consoleWarnings.slice(0, 5), url });

        // v1.1 check modules
        if (securityCheck) try { findings.push(...await securityCheck.run(page, context, cfg)); } catch (e) { findings.push({ severity: 1, layer: 'security', page: pPath, finding: `security check failed: ${e.message}`, url }); }
        if (seoCheck) try { findings.push(...await seoCheck.run(page, context, cfg)); } catch (e) { findings.push({ severity: 3, layer: 'seo', page: pPath, finding: `seo check failed: ${e.message}`, url }); }
        if (imagesCheck) try { findings.push(...await imagesCheck.run(page, context, cfg)); } catch (e) { findings.push({ severity: 3, layer: 'images', page: pPath, finding: `image check failed: ${e.message}`, url }); }

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
            findings.push({ severity: 1, layer: 'a11y', page: pPath, finding: v.help, detail: { id: v.id, nodes: v.nodes.length }, url });
          }
        } catch (e) { findings.push({ severity: 1, layer: 'a11y', page: pPath, finding: `axe failed: ${e.message}`, url }); }

        // Functional: verify all <a> resolve. Skip known bot-blocking domains (LinkedIn, Amazon, etc)
        // which 404/503 non-browser requests regardless of method. Use GET, allow 405 (HEAD-rejected),
        // allow 403 on social domains (often bot-detection).
        const SKIP_DOMAINS = /(?:linkedin\.com|amazon\.[a-z.]+|instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|youtube\.com|reddit\.com|medium\.com)$/i;
        try {
          const linkData = await page.$$eval('a[href]', as => as.map(a => ({ href: a.href, text: a.textContent?.slice(0, 40) || '' })).filter(d => d.href.startsWith('http')));
          const seen = new Set();
          const unique = linkData.filter(d => { if (seen.has(d.href)) return false; seen.add(d.href); return true; }).slice(0, 30);
          for (const { href: l } of unique) {
            try {
              const u = new URL(l);
              if (SKIP_DOMAINS.test(u.hostname)) continue; // bot-blocked, can't verify externally
              const r = await context.request.get(l, { timeout: 10000, maxRedirects: 5 });
              const s = r.status();
              if (s >= 400 && s !== 405) {
                findings.push({ severity: 3, layer: 'functional', page: pPath, finding: `broken link: ${l} (${s})`, url });
              }
            } catch (e) {
              const msg = e.message || '';
              if (!/timeout|ECONNRESET|ENOTFOUND/i.test(msg)) {
                findings.push({ severity: 3, layer: 'functional', page: pPath, finding: `link error: ${l} :: ${msg.slice(0, 80)}`, url });
              }
            }
          }
        } catch {}

        // A redirect that fired while the checks ran means they tested the page it went to: drop them.
        if (landedElsewhere(url, page.url())) {
          findings.length = pageFindingsFrom;
          findings.push(landedFinding(pPath, url, page.url()));
        }
      }
    } catch (e) {
      findings.push({ severity: 1, layer: 'functional', page: pPath, finding: `navigation failed: ${e.message}`, url });
    }
    await page.close();
  }

  // Once-per-run checks
  if (seoCheck && seoCheck.runOnce) {
    try { findings.push(...await seoCheck.runOnce(context, cfg)); } catch (e) { findings.push({ severity: 3, layer: 'seo', finding: `sitemap/robots check failed: ${e.message}` }); }
  }
  if (fourOhFourCheck && fourOhFourCheck.runOnce) {
    try { findings.push(...await fourOhFourCheck.runOnce(context, cfg)); } catch (e) { findings.push({ severity: 3, layer: '404-check', finding: `404 check failed: ${e.message}` }); }
  }

  await browser.close();
  const finishedAt = new Date().toISOString();
  console.log(JSON.stringify({ project: cfg.name, test_url: cfg.test_url, startedAt, finishedAt, findings }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
