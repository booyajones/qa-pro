#!/usr/bin/env node
// Run the project's configured Playwright user flows with the installed runner.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const [projectArg, cfgPath] = process.argv.slice(2);
const projectDir = path.resolve(projectArg);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const flows = path.join(projectDir, '.qa', 'flows');
if (!fs.existsSync(flows) || !fs.readdirSync(flows, { recursive: true }).some(f => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f))) {
  const required = ['webapp-with-auth', 'ecommerce'].includes(cfg.project_type);
  console.log(JSON.stringify({ coverage: 'not configured', findings: required
    ? [{ severity: 1, layer: 'flows', finding: 'no critical user flows configured for this application' }] : [] }));
  process.exit(0);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-pro-flows-'));
try {
  const config = path.join(temp, 'playwright.config.cjs');
  const resultFile = path.join(temp, 'results.json');
  const runner = path.join(__dirname, '../node_modules/playwright/cli.js');
  fs.writeFileSync(config, 'module.exports = ' + JSON.stringify({ testDir: flows,
    timeout: 30000, forbidOnly: true, retries: 0, workers: 1,
    use: { baseURL: cfg.test_url, storageState: cfg.storage_state },
    projects: (cfg.cross_browser ? ['chromium', 'firefox', 'webkit'] : ['chromium']).map(name => ({ name, use: { browserName: name } })),
    reporter: [['json', { outputFile: resultFile }]],
  }) + ';');
  const r = spawnSync(process.execPath, [runner, 'test', '--config', config], {
    cwd: projectDir, encoding: 'utf8', timeout: 300000, maxBuffer: 10 * 1024 * 1024,
  });
  if (!fs.existsSync(resultFile)) throw new Error((r.stderr || r.error?.message || 'flow report missing').slice(0, 300));
  const report = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const stats = report.stats || {};
  const ok = r.status === 0 && stats.expected > 0 && stats.unexpected === 0 && stats.skipped === 0;
  console.log(JSON.stringify({ coverage: 'completed', findings: [{ severity: ok ? 4 : 1, layer: 'flows',
    finding: ok ? `${stats.expected} critical flow test(s) passed` : 'critical flows failed, were skipped, or ran no tests',
    detail: { stats, errors: report.errors, stderr: (r.stderr || '').slice(0, 300) } }] }));
} catch (e) {
  console.error(e.message); process.exitCode = 1;
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
