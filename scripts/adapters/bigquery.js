#!/usr/bin/env node
// BigQuery data-correctness adapter
// Runs a query via `bq query` (Google Cloud SDK) and extracts the expected value.
// Caches results for 24h by default to avoid query cost on every run.
//
// Usage: node bigquery.js <project-dir> <kpi-config-json>

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const projectDir = process.argv[2];
const kpiConfigJson = process.argv[3];
if (!projectDir || !kpiConfigJson) { console.error('usage: bigquery.js <project-dir> <kpi-config-json>'); process.exit(1); }
const kpi = JSON.parse(kpiConfigJson);

if (!kpi.query && !kpi.query_file) { console.error('bigquery adapter requires kpi.query (inline SQL) or kpi.query_file (path relative to project)'); process.exit(1); }

let sql;
if (kpi.query_file) {
  const qfPath = path.resolve(projectDir, kpi.query_file);
  if (!fs.existsSync(qfPath)) { console.error(`query file not found: ${qfPath}`); process.exit(1); }
  sql = fs.readFileSync(qfPath, 'utf8');
} else {
  sql = kpi.query;
}

// JSONPath-lite (matches jsonfile/rest adapters)
function jsonPath(obj, expr) {
  if (!expr || !expr.startsWith('$')) return undefined;
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

// Cache key = hash of SQL + project-id
const projectId = kpi.gcp_project || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
const cacheKey = crypto.createHash('sha256').update(`${projectId}::${sql}`).digest('hex').slice(0, 16);
const cacheDir = path.join(projectDir, '.qa', 'bq_cache');
fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, `${cacheKey}.json`);
const ttlMs = (kpi.cache_ttl_hours || 24) * 3600 * 1000;

let result;
const useCache = !process.argv.includes('--no-cache');
if (useCache && fs.existsSync(cacheFile)) {
  const stat = fs.statSync(cacheFile);
  if (Date.now() - stat.mtimeMs < ttlMs) {
    try {
      result = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      result.from_cache = true;
    } catch {}
  }
}

if (!result) {
  // Run via bq CLI
  // Requires gcloud auth + bq CLI on PATH (or BQ_CLI_PATH env)
  const bqCli = process.env.BQ_CLI_PATH || 'bq';
  const cmd = [
    bqCli, 'query',
    '--use_legacy_sql=false',
    '--format=json',
    '--max_rows=10',
  ];
  if (projectId) cmd.push(`--project_id=${projectId}`);
  cmd.push(JSON.stringify(sql));

  try {
    const out = execSync(cmd.join(' '), { encoding: 'utf8', timeout: kpi.timeout_ms || 60000 });
    const rows = JSON.parse(out);
    if (!Array.isArray(rows) || !rows.length) { console.error('bq query returned no rows'); process.exit(2); }
    result = { rows, queried_at: new Date().toISOString(), from_cache: false };
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString();
    console.error(`bq query failed: ${msg.split('\n')[0]}`);
    process.exit(3);
  }
}

// Extract value
const valueSource = kpi.expected_path ? jsonPath(result.rows[0], kpi.expected_path) : Object.values(result.rows[0])[0];
if (valueSource === undefined) {
  console.error(`could not extract value at path ${kpi.expected_path || '<first column>'}`);
  process.exit(4);
}

console.log(JSON.stringify({
  kpi: kpi.name,
  expected: valueSource,
  rows_returned: result.rows.length,
  cache: result.from_cache ? 'HIT' : 'MISS',
  cache_file: cacheFile,
  queried_at: result.queried_at,
}, null, 2));
process.exit(0);
