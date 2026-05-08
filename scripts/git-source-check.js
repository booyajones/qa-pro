#!/usr/bin/env node
// git source-of-truth integrity check for jsonfile adapter
// Usage: node git-source-check.js <path-to-source-file> [--allow-dirty]

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const filePath = process.argv[2];
const allowDirty = process.argv.includes('--allow-dirty');

if (!filePath || !fs.existsSync(filePath)) { console.error(`file not found: ${filePath}`); process.exit(1); }

const repoRoot = (() => {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { console.error('not in a git repo; jsonfile adapter requires git tracking'); process.exit(1); }
})();

const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/');

// Check tracked
try { execSync(`git ls-files --error-unmatch "${rel}"`, { cwd: repoRoot, stdio: 'ignore' }); }
catch { console.error(`${rel} is not tracked by git; commit it first`); process.exit(1); }

// Check working tree clean for this file
const status = execSync(`git status --porcelain "${rel}"`, { cwd: repoRoot, encoding: 'utf8' }).trim();
if (status && !allowDirty) {
  console.error(`${rel} has uncommitted changes. Use --allow-dirty for iteration, or capture via /qa:learn --regression.`);
  process.exit(2);
}

// If --allow-dirty used, increment ledger
if (status && allowDirty) {
  const dirtyLedger = path.join(os.homedir(), '.claude', 'skills', 'qa-pro', '.allow-dirty-ledger.json');
  let d = { month: new Date().toISOString().slice(0, 7), uses: [] };
  if (fs.existsSync(dirtyLedger)) {
    try { d = JSON.parse(fs.readFileSync(dirtyLedger, 'utf8')); } catch {}
    if (d.month !== new Date().toISOString().slice(0, 7)) d = { month: new Date().toISOString().slice(0, 7), uses: [] };
  }
  d.uses.push({ at: new Date().toISOString(), file: rel });
  fs.mkdirSync(path.dirname(dirtyLedger), { recursive: true });
  fs.writeFileSync(dirtyLedger, JSON.stringify(d, null, 2));
}

// Verify last commit on this file is run-ID-prefixed
const lastCommit = execSync(`git log -1 --pretty=format:"%H|%s" -- "${rel}"`, { cwd: repoRoot, encoding: 'utf8' }).trim();
if (!lastCommit) { console.error(`no commit history for ${rel}`); process.exit(1); }

const [sha, subject] = lastCommit.split('|');
const project = repoRoot;

if (!subject.startsWith('qa-learn-run-')) {
  console.error(`last commit on ${rel} (${sha.slice(0, 7)}: "${subject}") is NOT tied to a /qa:learn run.`);
  console.error(`Adapter refuses to use this as source-of-truth.`);
  console.error(`Capture changes via /qa:learn --regression or --confirm <pending-id>.`);
  process.exit(3);
}

// Verify run-ID exists in ledger
const ledgerCheck = require('child_process').spawnSync('node', [
  path.join(__dirname, 'run-id-ledger.js'), 'verify-commit-prefix', subject, project
], { encoding: 'utf8' });

if (ledgerCheck.status !== 0) {
  console.error(`commit prefix not found in run-ID ledger: ${ledgerCheck.stderr}`);
  process.exit(4);
}

console.log(JSON.stringify({ file: rel, sha, subject, status: 'verified', dirty: !!status, allow_dirty: allowDirty }));
process.exit(0);
