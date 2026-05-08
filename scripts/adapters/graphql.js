#!/usr/bin/env node
// GraphQL data-correctness adapter
// POSTs a query (with optional variables) to a GraphQL endpoint, extracts via JSONPath.
//
// Usage: node graphql.js <project-dir> <kpi-config-json>

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectDir = process.argv[2];
const kpiConfigJson = process.argv[3];
if (!projectDir || !kpiConfigJson) { console.error('usage: graphql.js <project-dir> <kpi-config-json>'); process.exit(1); }
const kpi = JSON.parse(kpiConfigJson);

if (!kpi.endpoint) { console.error('graphql adapter requires kpi.endpoint'); process.exit(1); }
if (!kpi.query && !kpi.query_file) { console.error('requires kpi.query or kpi.query_file'); process.exit(1); }

let query;
if (kpi.query_file) {
  const qfPath = path.resolve(projectDir, kpi.query_file);
  if (!fs.existsSync(qfPath)) { console.error(`query file not found: ${qfPath}`); process.exit(1); }
  query = fs.readFileSync(qfPath, 'utf8');
} else {
  query = kpi.query;
}
const variables = kpi.variables || {};

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

// Cache
const cacheKey = crypto.createHash('sha256').update(`${kpi.endpoint}::${query}::${JSON.stringify(variables)}`).digest('hex').slice(0, 16);
const cacheDir = path.join(projectDir, '.qa', 'gql_cache');
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

(async () => {
  if (!result) {
    const headers = { 'Content-Type': 'application/json', ...(kpi.headers || {}) };
    if (kpi.auth_env) {
      const tok = process.env[kpi.auth_env];
      if (!tok) { console.error(`auth_env ${kpi.auth_env} not set`); process.exit(2); }
      headers['Authorization'] = `Bearer ${tok}`;
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), kpi.timeout_ms || 10000);
    try {
      const r = await fetch(kpi.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!r.ok) { console.error(`HTTP ${r.status} ${r.statusText}`); process.exit(3); }
      const body = await r.json();
      if (body.errors && body.errors.length) {
        console.error(`GraphQL errors: ${body.errors.map(e => e.message).join('; ')}`);
        process.exit(4);
      }
      result = { data: body.data, queried_at: new Date().toISOString(), from_cache: false };
      fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
    } catch (e) {
      clearTimeout(t);
      console.error(`graphql fetch failed: ${e.message}`);
      process.exit(5);
    }
  }

  const expected = jsonPath(result.data, kpi.expected_path || '$');
  if (expected === undefined) {
    console.error(`jsonpath ${kpi.expected_path || '$'} returned undefined`);
    process.exit(6);
  }

  console.log(JSON.stringify({
    kpi: kpi.name,
    endpoint: kpi.endpoint,
    expected,
    expected_path: kpi.expected_path,
    cache: result.from_cache ? 'HIT' : 'MISS',
    queried_at: result.queried_at,
  }, null, 2));
  process.exit(0);
})();
