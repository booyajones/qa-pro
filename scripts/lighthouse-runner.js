#!/usr/bin/env node
// Lighthouse perf module for /qa:full
// Usage: node lighthouse-runner.js <test-url> [<page-paths-json>]
// Outputs JSON findings with severity per perf budget.

const { spawnSync } = require('child_process');
const path = require('path');

const testUrl = process.argv[2];
const pagesJson = process.argv[3] || '["/"]';
if (!testUrl) { console.error('usage: lighthouse-runner.js <test-url> [<pages-json>]'); process.exit(1); }
const pages = JSON.parse(pagesJson);

const skillDir = path.join(__dirname, '..');
const findings = [];

for (const p of pages) {
  const url = new URL(p, testUrl).toString();
  console.error(`Lighthouse: ${url}`);

  // Use lighthouse via npx; fall back gracefully if not installed
  const result = spawnSync('npx', ['--yes', 'lighthouse@latest', url, '--output=json', '--chrome-flags=--headless --no-sandbox', '--quiet', '--only-categories=performance,accessibility,best-practices,seo'], {
    encoding: 'utf8',
    cwd: skillDir,
    timeout: 90000,
    shell: true,
  });

  if (result.status !== 0) {
    findings.push({ severity: 3, layer: 'perf', page: p, finding: `lighthouse failed: ${(result.stderr || '').slice(0, 200)}`, url });
    continue;
  }

  let lh;
  try { lh = JSON.parse(result.stdout); } catch { findings.push({ severity: 3, layer: 'perf', page: p, finding: 'lighthouse output unparseable', url }); continue; }

  const cats = lh.categories || {};
  const perf = cats.performance?.score;
  const a11y = cats.accessibility?.score;
  const bp = cats['best-practices']?.score;
  const seo = cats.seo?.score;

  if (perf !== undefined) {
    const sev = perf < 0.5 ? 1 : perf < 0.75 ? 2 : perf < 0.9 ? 3 : 4;
    if (sev <= 3) findings.push({ severity: sev, layer: 'perf', page: p, finding: `Lighthouse Performance ${Math.round(perf * 100)}/100`, url });
  }
  if (a11y !== undefined && a11y < 0.9) {
    findings.push({ severity: a11y < 0.7 ? 2 : 3, layer: 'a11y', page: p, finding: `Lighthouse a11y ${Math.round(a11y * 100)}/100`, url });
  }
  if (bp !== undefined && bp < 0.9) {
    findings.push({ severity: 3, layer: 'security', page: p, finding: `Lighthouse best-practices ${Math.round(bp * 100)}/100`, url });
  }
  if (seo !== undefined && seo < 0.9) {
    findings.push({ severity: 3, layer: 'seo', page: p, finding: `Lighthouse SEO ${Math.round(seo * 100)}/100`, url });
  }

  // Core Web Vitals
  const audits = lh.audits || {};
  const lcp = audits['largest-contentful-paint']?.numericValue;
  const cls = audits['cumulative-layout-shift']?.numericValue;
  const tbt = audits['total-blocking-time']?.numericValue;

  if (lcp && lcp > 2500) findings.push({ severity: lcp > 4000 ? 2 : 3, layer: 'perf', page: p, finding: `LCP ${(lcp / 1000).toFixed(1)}s (>2.5s)`, url });
  if (cls && cls > 0.1) findings.push({ severity: cls > 0.25 ? 2 : 3, layer: 'perf', page: p, finding: `CLS ${cls.toFixed(2)} (>0.1)`, url });
  if (tbt && tbt > 200) findings.push({ severity: tbt > 600 ? 2 : 3, layer: 'perf', page: p, finding: `TBT ${tbt.toFixed(0)}ms (>200ms)`, url });
}

console.log(JSON.stringify({ layer: 'lighthouse', findings }, null, 2));
process.exit(0);
