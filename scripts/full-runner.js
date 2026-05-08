#!/usr/bin/env node
// /qa:full orchestrator — chains smoke + lighthouse + visual into one merged report
// Usage: node full-runner.js <project-dir>

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = process.argv[2] || process.cwd();
const skillDir = path.join(__dirname, '..');

function step(label, fn) {
  process.stderr.write(`[qa-pro:full] ${label}... `);
  const t0 = Date.now();
  try {
    const result = fn();
    process.stderr.write(`${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    return result;
  } catch (e) {
    process.stderr.write(`FAIL (${e.message})\n`);
    return { findings: [{ severity: 3, layer: 'tooling', finding: `${label} failed: ${e.message}` }] };
  }
}

// Validate config
const cfgPath = path.join(projectDir, '.qa', 'config.yml');
if (!fs.existsSync(cfgPath)) { console.error(`No .qa/config.yml in ${projectDir}. Run /qa:init first.`); process.exit(1); }

const validate = spawnSync('node', [path.join(__dirname, 'validate-config.js'), cfgPath], { encoding: 'utf8' });
if (validate.status !== 0) { console.error(`Config invalid: ${validate.stderr}`); process.exit(1); }

const cfgJsonPath = path.join(projectDir, '.qa', 'config.json');
fs.writeFileSync(cfgJsonPath, validate.stdout);
const cfg = JSON.parse(validate.stdout);

// Check oracle stop-flag
const stopFlag = path.join(projectDir, '.qa', 'oracle_failed.flag');
if (fs.existsSync(stopFlag)) {
  console.error(`Oracle is in failed state. Inspect last report and run /qa:learn --regression or fix the issue.`);
  process.exit(2);
}

const allFindings = [];
const startedAt = new Date().toISOString();

// Smoke phase
const smoke = step('smoke (Playwright + axe + links)', () => {
  const r = spawnSync('node', [path.join(__dirname, 'smoke-runner.js'), cfgJsonPath], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.split('\n')[0] || 'unknown');
  return JSON.parse(r.stdout);
});
allFindings.push(...(smoke.findings || []));

// Visual phase
const visual = step('visual (pixel diff vs baseline)', () => {
  const r = spawnSync('node', [path.join(__dirname, 'visual-runner.js'), projectDir, cfgJsonPath], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.split('\n')[0] || 'unknown');
  return JSON.parse(r.stdout);
});
allFindings.push(...(visual.findings || []));

// Lighthouse phase
const lighthouse = step('lighthouse (perf + a11y + best-practices + SEO)', () => {
  const r = spawnSync('node', [path.join(__dirname, 'lighthouse-runner.js'), cfg.test_url, JSON.stringify(cfg.pages)], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.split('\n')[0] || 'unknown');
  return JSON.parse(r.stdout);
});
allFindings.push(...(lighthouse.findings || []));

const finishedAt = new Date().toISOString();

// Merge findings, dedupe identical ones
const seen = new Set();
const dedup = [];
for (const f of allFindings) {
  const k = `${f.severity}-${f.layer}-${f.page || ''}-${f.viewport || ''}-${(f.finding || '').slice(0, 80)}`;
  if (seen.has(k)) continue;
  seen.add(k);
  dedup.push(f);
}

let merged = {
  project: cfg.name,
  test_url: cfg.test_url,
  startedAt,
  finishedAt,
  data_adapter: cfg.data_adapter || 'none',
  findings: dedup,
};

const findingsFile = path.join(projectDir, '.qa', 'last-findings.json');
fs.writeFileSync(findingsFile, JSON.stringify(merged, null, 2));

// Oracle phase — runs AFTER smoke/visual/lighthouse, before report build
const oracle = step('oracle (verify suite still catches known fixtures)', () => {
  const r = spawnSync('node', [path.join(__dirname, 'oracle-runner.js'), projectDir, findingsFile], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.split('\n')[0] || 'unknown');
  return JSON.parse(r.stdout);
});
merged.findings = [...merged.findings, ...(oracle.findings || [])];
merged.oracle_unmatched_critical = oracle.unmatched_critical || 0;
merged.oracle_total_fixtures = oracle.total_fixtures_checked || 0;
fs.writeFileSync(findingsFile, JSON.stringify(merged, null, 2));

// Build report
const report = spawnSync('node', [path.join(__dirname, 'build-report.js'), findingsFile, projectDir, '--open'], { encoding: 'utf8' });
console.log(report.stdout);
if (report.stderr) console.error(report.stderr);

// Inline summary
const sev = dedup.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a; }, {});
console.log(`\n[qa-pro:full] Complete. Findings: Sev1=${sev[1] || 0} Sev2=${sev[2] || 0} Sev3=${sev[3] || 0} Sev4=${sev[4] || 0}. Report opened.`);
process.exit(0);
