#!/usr/bin/env node
// REST data-correctness adapter
// Hits an HTTP endpoint, parses JSON response, extracts the expected value via JSONPath-lite.
// Source-of-truth integrity comes from a checksum committed under run-ID-prefixed git history,
// OR from a fully-trusted endpoint URL (e.g., your own internal API).
//
// Usage: node rest.js <project-dir> <kpi-config-json>

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const projectDir = process.argv[2];
const kpiConfigJson = process.argv[3];
if (!projectDir || !kpiConfigJson) { console.error('usage: rest.js <project-dir> <kpi-config-json>'); process.exit(1); }
const kpi = JSON.parse(kpiConfigJson);

if (!kpi.endpoint) { console.error('rest adapter requires kpi.endpoint URL'); process.exit(1); }
if (!/^https?:\/\//.test(kpi.endpoint)) { console.error('endpoint must start with http(s)://'); process.exit(1); }

// JSONPath-lite (matches the jsonfile adapter)
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

// Fetch endpoint with timeout. Use Node fetch (Node 18+).
async function fetchJson(url, headers, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: headers || {}, signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const ct = r.headers.get('content-type') || '';
    if (!/json/i.test(ct)) {
      // Try to parse anyway
      const txt = await r.text();
      try { return JSON.parse(txt); } catch { throw new Error(`expected JSON, got content-type ${ct}`); }
    }
    return await r.json();
  } finally { clearTimeout(t); }
}

(async () => {
  const headers = kpi.headers || {};
  // Optional auth via env var reference
  if (kpi.auth_env) {
    const tok = process.env[kpi.auth_env];
    if (!tok) { console.error(`auth_env ${kpi.auth_env} not set in environment`); process.exit(2); }
    headers['Authorization'] = `Bearer ${tok}`;
  }

  let data;
  try {
    data = await fetchJson(kpi.endpoint, headers, kpi.timeout_ms || 10000);
  } catch (e) {
    console.error(`rest adapter fetch failed: ${e.message}`);
    process.exit(3);
  }

  const expected = jsonPath(data, kpi.expected_path || '$');
  if (expected === undefined) {
    console.error(`jsonpath ${kpi.expected_path || '$'} returned undefined from response`);
    process.exit(4);
  }

  // Optional: integrity-check the response against a git-tracked checksum
  // (mirrors jsonfile adapter's git-HEAD pinning model for endpoints that should be deterministic)
  if (kpi.expected_sha256) {
    const crypto = require('crypto');
    const valStr = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
    const sha = crypto.createHash('sha256').update(valStr).digest('hex');
    if (sha !== kpi.expected_sha256) {
      console.error(`response value SHA mismatch: expected ${kpi.expected_sha256}, got ${sha}`);
      console.error(`If the endpoint legitimately changed, update kpi.expected_sha256 via /qa:learn --regression`);
      process.exit(5);
    }
  }

  console.log(JSON.stringify({
    kpi: kpi.name,
    endpoint: kpi.endpoint,
    expected,
    expected_path: kpi.expected_path,
    integrity_checked: !!kpi.expected_sha256,
  }, null, 2));
  process.exit(0);
})();
