#!/usr/bin/env node
// Compare independent source values with the actual rendered KPI text.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('../node_modules/playwright');
const [projectDir, cfgPath] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

function displayedNumber(text) {
  // shortcut: US currency/grouping only; add an explicit locale parser when a project needs another format.
  const value = text.trim().replace(/^[$£€]\s*/, '');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) throw new Error('displayed KPI is not an unambiguous numeric value');
  return Number(value.replace(/,/g, ''));
}

(async () => {
  const findings = [];
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ storageState: cfg.storage_state });
    for (const kpi of cfg.kpis) {
      try {
        if (!kpi.selector || !kpi.page) throw new Error('KPI selector and page are required');
        const adapter = path.join(__dirname, 'adapters', `${cfg.data_adapter}.js`);
        const result = spawnSync(process.execPath, [adapter, projectDir, JSON.stringify(kpi),
          ...(process.argv.includes('--allow-dirty') ? ['--allow-dirty'] : [])], { encoding: 'utf8', timeout: 30000 });
        if (result.status !== 0) throw new Error((result.stderr || 'data adapter failed').slice(0, 300));
        const expected = JSON.parse(result.stdout).expected;
        const page = await context.newPage();
        try {
          const url = new URL(kpi.page, cfg.test_url).toString();
          const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          if (!response || !response.ok() || new URL(page.url()).origin !== new URL(url).origin || new URL(page.url()).pathname.replace(/\/$/, '') !== new URL(url).pathname.replace(/\/$/, '')) {
            throw new Error('KPI page did not load at its requested destination');
          }
          const text = (await page.locator(kpi.selector).innerText()).trim();
          const actual = typeof expected === 'number' ? displayedNumber(text) : text;
          const tolerance = kpi.tolerance ?? 0;
          if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('KPI tolerance must be a non-negative number');
          const matches = typeof expected === 'number'
            ? Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected))
            : typeof expected === 'string' && actual === expected;
          findings.push({ severity: matches ? 4 : 1, layer: 'data', page: kpi.page,
            finding: `${kpi.name}: ${matches ? 'display matches source' : 'display differs from source'}`,
            detail: { expected, actual, tolerance }, url });
        } finally { await page.close(); }
      } catch (e) {
        findings.push({ severity: 1, layer: 'data', page: kpi.page, finding: `${kpi.name}: comparison unavailable: ${e.message}` });
      }
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ findings, coverage: 'completed' }));
})().catch(e => { console.error(e.message); process.exit(1); });
