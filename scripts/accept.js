#!/usr/bin/env node
// qa-pro accept / unaccept — manage .qa/accepted.yml
// Usage:
//   node accept.js add <fingerprint> "<reason>" [project-dir]
//   node accept.js remove <fingerprint> [project-dir]
//   node accept.js list [project-dir]
//   node accept.js baseline [project-dir]    -- snapshot current Sev 1+2 findings as baseline

const fs = require('fs');
const path = require('path');

const skillNodeMod = path.join(__dirname, '..', 'node_modules');
const yaml = require(path.join(skillNodeMod, 'js-yaml'));

const cmd = process.argv[2];
const projectDir = (() => {
  // Last arg if it looks like a path
  const last = process.argv[process.argv.length - 1];
  if (last && (last.startsWith('/') || /^[A-Za-z]:[\\/]/.test(last)) && fs.existsSync(last)) return last;
  return process.cwd();
})();

const acceptedPath = path.join(projectDir, '.qa', 'accepted.yml');

function load() {
  if (!fs.existsSync(acceptedPath)) return [];
  try {
    const parsed = yaml.load(fs.readFileSync(acceptedPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : (parsed && parsed.accepted) || [];
  } catch { return []; }
}
function save(entries) {
  fs.mkdirSync(path.dirname(acceptedPath), { recursive: true });
  fs.writeFileSync(acceptedPath, yaml.dump({ accepted: entries }, { lineWidth: 120 }));
}

if (cmd === 'add') {
  const fp = process.argv[3];
  const reason = process.argv[4];
  if (!fp || !reason) { console.error('usage: add <fingerprint> "<reason ≥10 chars>"'); process.exit(1); }
  if (reason.length < 10) { console.error('reason must be ≥10 chars'); process.exit(1); }
  const entries = load();
  if (entries.find(e => e.fingerprint === fp)) { console.error(`already accepted: ${fp}`); process.exit(1); }
  entries.push({
    fingerprint: fp,
    reason,
    source_type: 'human_authored',
    source_ref: `chris@finexio ${new Date().toISOString()}`,
    accepted_at: new Date().toISOString(),
  });
  save(entries);
  console.log(`accepted: ${fp}`);
  process.exit(0);
}

if (cmd === 'remove' || cmd === 'unaccept') {
  const fp = process.argv[3];
  if (!fp) { console.error('usage: remove <fingerprint>'); process.exit(1); }
  const entries = load();
  const before = entries.length;
  const remaining = entries.filter(e => e.fingerprint !== fp);
  if (remaining.length === before) { console.error(`not in accepted: ${fp}`); process.exit(1); }
  save(remaining);
  console.log(`removed: ${fp}`);
  process.exit(0);
}

if (cmd === 'list') {
  const entries = load();
  if (!entries.length) { console.log('(no acceptances)'); process.exit(0); }
  for (const e of entries) console.log(`${e.fingerprint}  ${e.source_type}  ${e.reason}`);
  process.exit(0);
}

if (cmd === 'baseline') {
  // Use latest findings to seed accepted.yml
  const findingsFile = path.join(projectDir, '.qa', 'last-findings.json');
  if (!fs.existsSync(findingsFile)) { console.error(`no last-findings.json — run /qa:smoke first`); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(findingsFile, 'utf8'));
  const findings = (data.findings || []).filter(f => f.severity === 1 || f.severity === 2);
  function fingerprint(f) {
    return `${f.severity}-${f.layer}-${f.page || ''}-${(f.finding || '').slice(0, 40).replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
  }
  const entries = load();
  let added = 0;
  const ts = new Date().toISOString();
  for (const f of findings) {
    const fp = fingerprint(f);
    if (entries.find(e => e.fingerprint === fp)) continue;
    entries.push({
      fingerprint: fp,
      reason: 'baseline accepted on init',
      source_type: 'human_authored',
      source_ref: `chris@finexio ${ts} (qa-pro baseline)`,
      accepted_at: ts,
      original_finding: { severity: f.severity, layer: f.layer, page: f.page, finding: f.finding },
    });
    added++;
  }
  save(entries);
  console.log(`baseline accepted ${added} new findings (${entries.length} total in .qa/accepted.yml)`);
  process.exit(0);
}

console.error('usage: add | remove | list | baseline');
process.exit(1);
