#!/usr/bin/env node
// Validate .qa/config.yml against zod schema
// Usage: node validate-config.js <path-to-config.yml>

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function fail(msg) { console.error(`qa-pro config error: ${msg}`); process.exit(1); }

// Ensure js-yaml available in skill's node_modules
const skillDir = path.join(__dirname, '..');
function ensure(pkg) {
  try { return require(path.join(skillDir, 'node_modules', pkg)); }
  catch {
    console.error(`(installing ${pkg}...)`);
    execSync(`npm install --no-save --prefix "${skillDir}" ${pkg}`, { stdio: 'inherit' });
    return require(path.join(skillDir, 'node_modules', pkg));
  }
}
const yaml = ensure('js-yaml');

const configPath = process.argv[2] || path.join(process.cwd(), '.qa', 'config.yml');
if (!fs.existsSync(configPath)) fail(`config not found at ${configPath}`);

let cfg;
try { cfg = yaml.load(fs.readFileSync(configPath, 'utf8')); }
catch (e) { fail(`YAML parse error: ${e.message}`); }

// Required fields
const required = ['name', 'project_type', 'test_url'];
for (const k of required) if (!cfg[k]) fail(`missing required field: ${k}`);

const validTypes = ['static-site', 'spa-dashboard', 'webapp-with-auth', 'ecommerce', 'custom'];
if (!validTypes.includes(cfg.project_type)) fail(`project_type must be one of: ${validTypes.join(', ')}`);

if (!/^https?:\/\//.test(cfg.test_url)) fail(`test_url must start with http:// or https://`);

if (cfg.data_adapter && !['jsonfile', 'rest', 'none'].includes(cfg.data_adapter)) {
  fail(`data_adapter must be one of: jsonfile, rest, none (others ship in v1.2+)`);
}

if (!Array.isArray(cfg.pages) || !cfg.pages.length) cfg.pages = ['/'];
if (!Array.isArray(cfg.viewports) || !cfg.viewports.length) cfg.viewports = ['desktop'];

cfg.monthly_token_cap = cfg.monthly_token_cap || 2000000;
cfg.per_run_token_cap = cfg.per_run_token_cap || 500000;
cfg.vision_call_cap_per_full = cfg.vision_call_cap_per_full || 30;

console.log(JSON.stringify(cfg, null, 2));
process.exit(0);
