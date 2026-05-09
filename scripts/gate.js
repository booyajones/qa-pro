#!/usr/bin/env node
// /qa:smoke --gate and /qa:full --gate
// Compares findings against .qa/accepted.yml; exits 0/1/2 based on NEW Sev 1+2 findings.
// Usage: node gate.js <findings-json-path> <project-dir>
//
// Exit codes:
//   0 — all Sev 1+2 are in accepted set (or there are none)
//   1 — at least one NEW Sev 2 finding (and no new Sev 1)
//   2 — at least one NEW Sev 1 finding

const fs = require('fs');
const path = require('path');

const findingsPath = process.argv[2];
const projectDir = process.argv[3] || process.cwd();
if (!findingsPath || !fs.existsSync(findingsPath)) { console.error('findings json required'); process.exit(3); }

const data = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
const findings = data.findings || [];

// Load .qa/accepted.yml (YAML or JSON; we accept both)
const acceptedPath = path.join(projectDir, '.qa', 'accepted.yml');
const acceptedJsonPath = path.join(projectDir, '.qa', 'accepted.json');
let accepted = [];
const skillNodeMod = path.join(__dirname, '..', 'node_modules');

function loadAccepted() {
  if (fs.existsSync(acceptedPath)) {
    try {
      const yaml = require(path.join(skillNodeMod, 'js-yaml'));
      const parsed = yaml.load(fs.readFileSync(acceptedPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : (parsed && parsed.accepted) || [];
    } catch (e) { console.error(`could not read accepted.yml: ${e.message}`); }
  }
  if (fs.existsSync(acceptedJsonPath)) {
    try { return JSON.parse(fs.readFileSync(acceptedJsonPath, 'utf8')); } catch {}
  }
  return [];
}
accepted = loadAccepted();

// Provenance enforcement: refuse claude_inspection-sourced acceptances
const claudeInspected = accepted.filter(a => a.source_type === 'claude_inspection');
if (claudeInspected.length) {
  console.error(`accepted.yml has ${claudeInspected.length} entries with source_type: claude_inspection — refused.`);
  process.exit(3);
}

const acceptedFingerprints = new Set(accepted.map(a => a.fingerprint).filter(Boolean));

function fingerprint(f) {
  return `${f.severity}-${f.layer}-${f.page || ''}-${(f.finding || '').slice(0, 40).replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
}

const newSev1 = [];
const newSev2 = [];
for (const f of findings) {
  if (f.severity > 2) continue;
  const fp = fingerprint(f);
  if (!acceptedFingerprints.has(fp)) {
    if (f.severity === 1) newSev1.push({ ...f, fingerprint: fp });
    else if (f.severity === 2) newSev2.push({ ...f, fingerprint: fp });
  }
}

const summary = {
  total_findings: findings.length,
  total_accepted: accepted.length,
  new_sev1: newSev1.length,
  new_sev2: newSev2.length,
  verdict: newSev1.length > 0 ? 'BLOCK' : (newSev2.length > 0 ? 'WARN' : 'PASS'),
};

console.log(JSON.stringify({ summary, new_sev1: newSev1, new_sev2: newSev2 }, null, 2));

if (newSev1.length > 0) process.exit(2);
if (newSev2.length > 0) process.exit(1);
process.exit(0);
