#!/usr/bin/env node
// Visual regression — pixel diff with immutable golden-at-creation anchors
// Usage: node visual-runner.js <project-dir> <config-json-path>
//
// Approved baseline, immutable golden and provenance must already exist.
// Missing fixtures fail without overwriting either anchor.

const fs = require('fs');
const path = require('path');

const projectDir = process.argv[2];
const cfgPath = process.argv[3];
if (!projectDir || !cfgPath) { console.error('usage: visual-runner.js <project-dir> <config-json>'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const skillDir = path.join(__dirname, '..');
const { chromium } = require(path.join(skillDir, 'node_modules', 'playwright'));
const pixelmatch = require(path.join(skillDir, 'node_modules', 'pixelmatch'));
const { PNG } = require(path.join(skillDir, 'node_modules', 'pngjs'));

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

function slugify(p) { return (p === '/' ? 'home' : p).replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(); }

async function deterministicContext(browser, viewportName) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewportName] || VIEWPORTS.desktop,
    userAgent: 'qa-pro-visual/1.4',
    reducedMotion: 'reduce',
    storageState: cfg.storage_state,
  });
  await ctx.addInitScript(() => {
    const epoch = 1767225600000;
    Date.now = () => epoch;
    const D = Date;
    Date = function(...args) { return new.target ? (args.length ? new D(...args) : new D(epoch)) : new D(epoch).toString(); };
    Date.now = () => epoch;
    Object.setPrototypeOf(Date, D);
    Date.prototype = D.prototype;
    let s = 1; Math.random = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  });
  return ctx;
}

(async () => {
  const findings = [];
  const browser = await chromium.launch();
  const pages = (cfg.pages && cfg.pages.length) ? cfg.pages : ['/'];
  const viewports = (cfg.viewports && cfg.viewports.length) ? cfg.viewports : ['desktop'];
  const masking = cfg.masking || [];
  const fixturesRoot = path.join(projectDir, '.qa', 'fixtures', 'good');
  const threshold = cfg.visual_threshold || 0.001; // 0.1% of pixels different

  for (const viewport of viewports) {
    const ctx = await deterministicContext(browser, viewport);
    const page = await ctx.newPage();
    // Inject CSS to kill animations and pin time-like content
    await page.addStyleTag({ content: `
      *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }
      ${masking.map(m => `${m.selector} { visibility: hidden !important; }`).join('\n')}
    `}).catch(() => {});

    for (const pPath of pages) {
      const url = new URL(pPath, cfg.test_url).toString();
      const slug = slugify(pPath);
      const fxDir = path.join(fixturesRoot, slug, viewport);
      fs.mkdirSync(fxDir, { recursive: true });
      const baselineFile = path.join(fxDir, 'baseline.png');
      const goldenFile = path.join(fxDir, 'golden-at-creation.png');
      const currentFile = path.join(fxDir, 'current.png');
      const diffFile = path.join(fxDir, 'diff.png');
      const metaFile = path.join(fxDir, 'meta.json');

      try {
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(500);
        const landed = new URL(page.url()), asked = new URL(url);
        if (!response?.ok() || asked.origin !== landed.origin || asked.pathname.replace(/\/$/, '') !== landed.pathname.replace(/\/$/, '')) {
          findings.push({ severity: 1, layer: 'visual', page: pPath, viewport,
            finding: `visual page was not tested: returned ${response?.status()} at ${page.url()}`, url });
          continue;
        }
      } catch (e) {
        findings.push({ severity: 2, layer: 'visual', page: pPath, viewport, finding: `nav failed for visual check: ${e.message}`, url });
        continue;
      }

      // Re-apply masking after navigation (page CSS may have reset)
      await page.addStyleTag({ content: `
        *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
        ${masking.map(m => `${m.selector} { visibility: hidden !important; }`).join('\n')}
      `}).catch(() => {});

      const buf = await page.screenshot({ fullPage: false, type: 'png' });
      fs.writeFileSync(currentFile, buf);

      if (!fs.existsSync(baselineFile) || !fs.existsSync(goldenFile) || !fs.existsSync(metaFile)) {
        findings.push({ severity: 1, layer: 'visual', page: pPath, viewport,
          finding: `approved baseline or immutable golden missing for ${slug}/${viewport}; capture and approve fixtures before gating`, url });
        continue;
      }
      const provenance = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (!provenance.source_ref || /^qa-pro auto-snapshot/.test(provenance.source_ref) || provenance.source_type === 'claude_inspection' || provenance.claude_inspection_allowed === true) {
        findings.push({ severity: 1, layer: 'visual', page: pPath, viewport, finding: `baseline has no approved provenance for ${slug}/${viewport}`, url });
        continue;
      }

      // Compare current vs baseline
      const baseline = PNG.sync.read(fs.readFileSync(baselineFile));
      const golden = PNG.sync.read(fs.readFileSync(goldenFile));
      const current = PNG.sync.read(buf);

      if (baseline.width !== current.width || baseline.height !== current.height || golden.width !== current.width || golden.height !== current.height) {
        findings.push({
          severity: 2, layer: 'visual', page: pPath, viewport,
          finding: `viewport size changed: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}`,
          url,
        });
        continue;
      }

      const diff = new PNG({ width: baseline.width, height: baseline.height });
      const diffPixels = pixelmatch(baseline.data, current.data, diff.data, baseline.width, baseline.height, { threshold: 0.1, alpha: 0.4 });
      const totalPixels = baseline.width * baseline.height;
      const diffRatio = diffPixels / totalPixels;
      const goldenPixels = pixelmatch(golden.data, current.data, null, current.width, current.height, { threshold: 0.1 });
      if (goldenPixels / totalPixels > threshold) {
        findings.push({ severity: 1, layer: 'visual', page: pPath, viewport,
          finding: `rendered page drifted from its immutable golden on ${slug}`, detail: { diff_ratio: goldenPixels / totalPixels }, url });
      }

      if (diffRatio > threshold) {
        fs.writeFileSync(diffFile, PNG.sync.write(diff));
        const pct = (diffRatio * 100).toFixed(2);
        const sev = diffRatio > 0.05 ? 2 : 3; // 5% diff = Sev 2, less = Sev 3
        findings.push({
          severity: sev,
          layer: 'visual',
          page: pPath,
          viewport,
          finding: `visual drift ${pct}% (${diffPixels} px) on ${slug}`,
          detail: { diff_ratio: diffRatio, baseline: baselineFile, current: currentFile, diff: diffFile },
          url,
        });
      } else {
        // Clean — clean up current.png to keep .qa/ tidy
        try { fs.unlinkSync(currentFile); } catch {}
      }
    }
    await ctx.close();
  }

  await browser.close();
  console.log(JSON.stringify({ layer: 'visual', findings }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
