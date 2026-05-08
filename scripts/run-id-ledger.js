#!/usr/bin/env node
// Run-ID ledger management
// Usage:
//   node run-id-ledger.js issue <issued_by> <project> <fixture_id>     -> writes new entry, prints run_id
//   node run-id-ledger.js verify <run_id> <project>                    -> 0 if valid + open, 1 otherwise
//   node run-id-ledger.js consume <run_id>                             -> mark consumed
//   node run-id-ledger.js verify-commit-prefix <prefix> <project>      -> verify "qa-learn-run-<id>:" prefix maps to open ledger entry
//   node run-id-ledger.js audit                                        -> print health report

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const LEDGER = path.join(os.homedir(), '.claude', 'skills', 'qa-pro', '.run-id-ledger.json');

function load() {
  if (!fs.existsSync(LEDGER)) return [];
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return []; }
}
function save(entries) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(entries, null, 2));
}
function newId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const rand = crypto.randomBytes(2).toString('hex');
  return `qa-learn-run-${ts}-${rand}`;
}

const cmd = process.argv[2];
const entries = load();

if (cmd === 'issue') {
  const [issued_by, project, fixture_id] = process.argv.slice(3);
  if (!issued_by || !project) { console.error('usage: issue <issued_by> <project> [fixture_id]'); process.exit(1); }
  const entry = {
    run_id: newId(),
    issued_at: new Date().toISOString(),
    issued_by,
    project,
    fixture_id: fixture_id || null,
    status: 'open',
  };
  entries.push(entry);
  save(entries);
  console.log(entry.run_id);
  process.exit(0);
}

// Normalize paths for cross-platform comparison (forward vs backslash, casing on Windows)
function normPath(p) {
  if (!p) return p;
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

if (cmd === 'verify') {
  const [run_id, project] = process.argv.slice(3);
  const e = entries.find(x => x.run_id === run_id);
  if (!e) { console.error('not found'); process.exit(1); }
  if (e.status !== 'open') { console.error(`status=${e.status}, expected open`); process.exit(1); }
  if (project && normPath(e.project) !== normPath(project)) { console.error(`project mismatch: ledger=${e.project} got=${project}`); process.exit(1); }
  console.log(JSON.stringify(e));
  process.exit(0);
}

if (cmd === 'consume') {
  const [run_id] = process.argv.slice(3);
  const e = entries.find(x => x.run_id === run_id);
  if (!e) { console.error('not found'); process.exit(1); }
  e.status = 'consumed';
  e.consumed_at = new Date().toISOString();
  save(entries);
  console.log('consumed');
  process.exit(0);
}

if (cmd === 'verify-commit-prefix') {
  const [prefix, project] = process.argv.slice(3);
  const m = prefix.match(/^qa-learn-run-([\w-]+):/);
  if (!m) { console.error('commit message does not start with qa-learn-run-<id>:'); process.exit(1); }
  const fullId = `qa-learn-run-${m[1]}`;
  const e = entries.find(x => x.run_id === fullId);
  if (!e) { console.error(`run_id ${fullId} not found in ledger; commit is untrusted`); process.exit(1); }
  if (normPath(e.project) !== normPath(project)) { console.error(`project mismatch`); process.exit(1); }
  if (e.status !== 'open' && e.status !== 'consumed') { console.error(`status=${e.status}`); process.exit(1); }
  console.log(JSON.stringify(e));
  process.exit(0);
}

if (cmd === 'audit') {
  const byStatus = entries.reduce((a, e) => { a[e.status] = (a[e.status] || 0) + 1; return a; }, {});
  const stale = entries.filter(e => e.status === 'open' && (Date.now() - new Date(e.issued_at).getTime()) > 24 * 3600 * 1000);
  console.log(JSON.stringify({ total: entries.length, by_status: byStatus, stale_open_over_24h: stale.length }, null, 2));
  process.exit(0);
}

console.error('unknown command. usage: issue|verify|consume|verify-commit-prefix|audit');
process.exit(1);
