#!/usr/bin/env node
// Postgres data-correctness adapter
// Connects via libpq env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) or DATABASE_URL.
// Caches results for 24h by default to avoid query cost on every run.
//
// Usage: node postgres.js <project-dir> <kpi-config-json>

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectDir = process.argv[2];
const kpiConfigJson = process.argv[3];
if (!projectDir || !kpiConfigJson) { console.error('usage: postgres.js <project-dir> <kpi-config-json>'); process.exit(1); }
const kpi = JSON.parse(kpiConfigJson);

if (!kpi.query && !kpi.query_file) { console.error('postgres adapter requires kpi.query or kpi.query_file'); process.exit(1); }

let sql;
if (kpi.query_file) {
  const qfPath = path.resolve(projectDir, kpi.query_file);
  if (!fs.existsSync(qfPath)) { console.error(`query file not found: ${qfPath}`); process.exit(1); }
  sql = fs.readFileSync(qfPath, 'utf8');
} else {
  sql = kpi.query;
}

// JSONPath-lite (matches other adapters)
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

// Cache: hash of SQL + connection signature
const connStr = process.env.DATABASE_URL || `${process.env.PGHOST || ''}/${process.env.PGDATABASE || ''}`;
const cacheKey = crypto.createHash('sha256').update(`${connStr}::${sql}`).digest('hex').slice(0, 16);
const cacheDir = path.join(projectDir, '.qa', 'pg_cache');
fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, `${cacheKey}.json`);
const ttlMs = (kpi.cache_ttl_hours || 24) * 3600 * 1000;
const useCache = !process.argv.includes('--no-cache');

let result;
if (useCache && fs.existsSync(cacheFile)) {
  const stat = fs.statSync(cacheFile);
  if (Date.now() - stat.mtimeMs < ttlMs) {
    try { result = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); result.from_cache = true; } catch {}
  }
}

if (!result) {
  // Lazy-load pg from skill node_modules; auto-install if missing
  const skillDir = path.join(__dirname, '..', '..');
  let Client;
  try { Client = require(path.join(skillDir, 'node_modules', 'pg')).Client; }
  catch {
    console.error('(installing pg one-time...)');
    require('child_process').execSync(`npm install --prefix "${skillDir}" pg`, { stdio: 'inherit' });
    Client = require(path.join(skillDir, 'node_modules', 'pg')).Client;
  }

  (async () => {
    const client = new Client({ connectionTimeoutMillis: kpi.timeout_ms || 10000 });
    try { await client.connect(); }
    catch (e) { console.error(`postgres connect failed: ${e.message}`); process.exit(2); }

    let queryResult;
    try { queryResult = await client.query(sql); }
    catch (e) { await client.end(); console.error(`query failed: ${e.message}`); process.exit(3); }
    await client.end();

    if (!queryResult.rows || !queryResult.rows.length) { console.error('query returned no rows'); process.exit(4); }
    result = { rows: queryResult.rows.slice(0, 10), queried_at: new Date().toISOString(), from_cache: false };
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
    emit();
  })();
} else {
  emit();
}

function emit() {
  const valueSource = kpi.expected_path ? jsonPath(result.rows[0], kpi.expected_path) : Object.values(result.rows[0])[0];
  if (valueSource === undefined) { console.error(`could not extract value at ${kpi.expected_path || '<first column>'}`); process.exit(5); }
  console.log(JSON.stringify({
    kpi: kpi.name,
    expected: valueSource,
    rows_returned: result.rows.length,
    cache: result.from_cache ? 'HIT' : 'MISS',
    queried_at: result.queried_at,
  }, null, 2));
  process.exit(0);
}
