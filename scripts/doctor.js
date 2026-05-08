#!/usr/bin/env node
// /qa:doctor — diagnose qa-pro health
// Usage: node doctor.js [project-dir]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const projectDir = process.argv[2] || process.cwd();
const skillDir = path.join(__dirname, '..');

function row(label, status, detail, fix) {
  const color = status === 'GREEN' ? '\x1b[32m' : status === 'YELLOW' ? '\x1b[33m' : '\x1b[31m';
  const reset = '\x1b[0m';
  return { label, status, color, detail, fix, line: `${color}● ${status.padEnd(6)}${reset}  ${label.padEnd(28)} ${detail || ''}` };
}

function tryVer(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

const rows = [];

// 1. Skill version
const skillMd = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const ver = (skillMd.match(/^version:\s*(\S+)/m) || [])[1];
rows.push(row('skill version', ver ? 'GREEN' : 'RED', ver || 'missing'));

// 2. Node
const nodeVer = tryVer('node --version');
rows.push(row('node', nodeVer ? 'GREEN' : 'RED', nodeVer || 'not found',
  !nodeVer ? 'install Node 20+ from nodejs.org' : null));

// 3. Playwright
const pwVer = (() => {
  try { return require(path.join(skillDir, 'node_modules', 'playwright', 'package.json')).version; }
  catch { return null; }
})();
rows.push(row('playwright', pwVer ? 'GREEN' : 'RED', pwVer || 'not installed',
  !pwVer ? `cd ${skillDir} && npm install` : null));

// 4. axe-core
const axeVer = (() => {
  try { return require(path.join(skillDir, 'node_modules', '@axe-core/playwright', 'package.json')).version; }
  catch { return null; }
})();
rows.push(row('@axe-core/playwright', axeVer ? 'GREEN' : 'RED', axeVer || 'not installed'));

// 5. Token ledger
const tokenLedger = path.join(skillDir, '.token-ledger.json');
let tokenStatus = 'GREEN', tokenDetail = '';
try {
  const t = JSON.parse(fs.readFileSync(tokenLedger, 'utf8'));
  const pct = (t.used / t.cap) * 100;
  tokenStatus = pct >= 100 ? 'RED' : pct >= 90 ? 'YELLOW' : 'GREEN';
  tokenDetail = `${Math.round(t.used / 1000)}K / ${Math.round(t.cap / 1000)}K (${Math.round(pct)}%)`;
} catch { tokenDetail = 'not initialized (will create on first run)'; }
rows.push(row('token ledger', tokenStatus, tokenDetail));

// 6. Run-ID ledger
const runLedger = path.join(skillDir, '.run-id-ledger.json');
let runStatus = 'GREEN', runDetail = '';
try {
  const entries = JSON.parse(fs.readFileSync(runLedger, 'utf8'));
  const stale = entries.filter(e => e.status === 'open' && (Date.now() - new Date(e.issued_at).getTime()) > 24 * 3600 * 1000);
  runStatus = stale.length > 5 ? 'YELLOW' : 'GREEN';
  runDetail = `${entries.length} total, ${stale.length} stale-open >24h`;
} catch { runDetail = 'not initialized'; }
rows.push(row('run-ID ledger', runStatus, runDetail));

// 7. Allow-dirty ledger
const dirtyLedger = path.join(skillDir, '.allow-dirty-ledger.json');
let dirtyDetail = '0 uses this month';
try {
  const d = JSON.parse(fs.readFileSync(dirtyLedger, 'utf8'));
  if (d.month === new Date().toISOString().slice(0, 7)) dirtyDetail = `${d.uses.length} uses this month`;
} catch {}
rows.push(row('--allow-dirty usage', 'GREEN', dirtyDetail));

// 8. Project config
if (projectDir && projectDir !== skillDir) {
  const cfgPath = path.join(projectDir, '.qa', 'config.yml');
  if (!fs.existsSync(cfgPath)) {
    rows.push(row(`project config (${path.basename(projectDir)})`, 'YELLOW', 'no .qa/config.yml',
      `cd ${projectDir} && /qa:init`));
  } else {
    const validate = spawnSync('node', [path.join(__dirname, 'validate-config.js'), cfgPath], { encoding: 'utf8' });
    rows.push(row(`project config (${path.basename(projectDir)})`, validate.status === 0 ? 'GREEN' : 'RED',
      validate.status === 0 ? 'valid' : (validate.stderr || 'invalid').trim().split('\n')[0]));
  }

  // Oracle stop-flag
  const flag = path.join(projectDir, '.qa', 'oracle_failed.flag');
  if (fs.existsSync(flag)) {
    rows.push(row('oracle status', 'RED', `failed flag exists at ${flag}`,
      'inspect last report; run /qa:learn --regression to capture, or fix UI'));
  } else {
    rows.push(row('oracle status', 'GREEN', 'no failed flag'));
  }
}

console.log('qa-pro doctor\n');
for (const r of rows) console.log(r.line);

// Print fixes section
const reds = rows.filter(r => r.status === 'RED' || r.status === 'YELLOW');
if (reds.length) {
  console.log('\nFixes:');
  for (const r of reds) if (r.fix) console.log(`  ${r.label}: ${r.fix}`);
}

const exitCode = rows.some(r => r.status === 'RED') ? 2 : (rows.some(r => r.status === 'YELLOW') ? 1 : 0);
process.exit(exitCode);
