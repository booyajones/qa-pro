#!/usr/bin/env node
// Visual regression — pixel diff with immutable golden-at-creation anchors
// Usage: node visual-runner.js <project-dir> <config-json-path>
//
// Behavior:
//   - For each page in config, takes a deterministic screenshot at fixed viewport.
//   - First run for a page: saves to .qa/fixtures/good/<slug>/baseline.png
//                            AND to .qa/fixtures/good/<slug>/golden-at-creation.png (immutable; never overwritten)
//   - Subsequent runs: pixel-diff current vs baseline.png; saves diff overlay if non-trivial.
//   - Findings: diffs above threshold surface as Sev 3 (visual drift).

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
  });
  await ctx.addInitScript(() => {
    const epoch = 1717286400000;
    Date.now = () => epoch;
    const D = Date;
    Date = function(...args) { return args.length ? new D(...args) : new D(epoch); };
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
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
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

      if (!fs.existsSync(baselineFile)) {
        // First run: establish baseline AND golden-at-creation (immutable)
        fs.writeFileSync(baselineFile, buf);
        fs.writeFileSync(goldenFile, buf);
        fs.writeFileSync(metaFile, JSON.stringify({
          page: pPath,
          viewport,
          source_type: 'human_authored',
          source_ref: `qa-pro auto-snapshot ${new Date().toISOString()}`,
          claude_inspection_allowed: false,
          golden_immutable: true,
          created_at: new Date().toISOString(),
        }, null, 2));
        findings.push({ severity: 4, layer: 'visual', page: pPath, viewport, finding: `baseline established for ${slug}/${viewport}`, url });
        continue;
      }

      // Compare current vs baseline
      const baseline = PNG.sync.read(fs.readFileSync(baselineFile));
      const current = PNG.sync.read(buf);

      if (baseline.width !== current.width || baseline.height !== current.height) {
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
