#!/usr/bin/env node
// jsonfile data-correctness adapter
// Verifies displayed numbers against a git-HEAD-pinned JSON file.
// Usage: node jsonfile.js <project-dir> <kpi-config-json> [--allow-dirty]

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const projectDir = process.argv[2];
const kpiConfigJson = process.argv[3];
const allowDirty = process.argv.includes('--allow-dirty');

if (!projectDir || !kpiConfigJson) { console.error('usage: jsonfile.js <project-dir> <kpi-config-json> [--allow-dirty]'); process.exit(1); }
const kpi = JSON.parse(kpiConfigJson);

// Verify git pinning + run-ID ledger
const sourceFile = path.resolve(projectDir, kpi.source_path || 'data/expected_values.json');
const gitCheck = spawnSync('node', [path.join(__dirname, '..', 'git-source-check.js'), sourceFile, ...(allowDirty ? ['--allow-dirty'] : [])], { encoding: 'utf8' });

if (gitCheck.status !== 0) {
  console.error(`jsonfile adapter: source-of-truth check failed`);
  console.error(gitCheck.stderr);
  process.exit(2);
}

// Read pinned value (git HEAD, not working tree)
let pinnedContent;
try {
  const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: projectDir, encoding: 'utf8' }).trim();
  const rel = path.relative(repoRoot, sourceFile).replace(/\\/g, '/');
  pinnedContent = execSync(`git show HEAD:"${rel}"`, { cwd: repoRoot, encoding: 'utf8' });
} catch (e) {
  console.error(`failed to read git HEAD version of ${sourceFile}: ${e.message}`);
  process.exit(3);
}

let data;
try { data = JSON.parse(pinnedContent); } catch (e) { console.error(`source file is not valid JSON: ${e.message}`); process.exit(4); }

// JSONPath-lite: support $.path.to.value
function jsonPath(obj, expr) {
  if (!expr.startsWith('$')) return undefined;
  const parts = expr.slice(1).split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const m = p.match(/^(\w+)(?:\[(\d+)\])?$/);
    if (!m) return undefined;
    cur = cur[m[1]];
    if (m[2] !== undefined && cur != null) cur = cur[parseInt(m[2], 10)];
  }
  return cur;
}

const expected = jsonPath(data, kpi.expected_path || '$');
if (expected === undefined) { console.error(`jsonpath ${kpi.expected_path} returned undefined`); process.exit(5); }

console.log(JSON.stringify({ kpi: kpi.name, expected, source_path: kpi.source_path, source_pinned_to: 'git_HEAD' }, null, 2));
process.exit(0);
