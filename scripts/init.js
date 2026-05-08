#!/usr/bin/env node
// /qa:init — deterministic setup for a project
// Usage: node init.js [<project-dir>] [--url <test-url>] [--type static-site|spa-dashboard|custom] [--name <name>] [--non-interactive]
//
// Drops .qa/config.yml + .qa/fixtures/{good,broken}/ + .qa/{flows,queries,reports,pending_rotations}/
// Auto-detects project type from package.json if not specified.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const projectDir = (args[0] && !args[0].startsWith('--')) ? path.resolve(args[0]) : process.cwd();

function flag(name, hasValue = true) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  return hasValue ? args[i + 1] : true;
}

const cfgUrl = flag('url');
const cfgType = flag('type');
const cfgName = flag('name') || path.basename(projectDir);
const nonInteractive = !!flag('non-interactive', false);

const skillDir = path.join(__dirname, '..');

function detect() {
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.next) return { type: 'spa-dashboard', detected: 'Next.js' };
      if (deps['@sveltejs/kit']) return { type: 'spa-dashboard', detected: 'SvelteKit' };
      if (deps.vite || deps.astro) return { type: 'static-site', detected: deps.astro ? 'Astro' : 'Vite' };
      if (deps.react || deps.vue || deps.svelte) return { type: 'spa-dashboard', detected: deps.react ? 'React' : deps.vue ? 'Vue' : 'Svelte' };
    } catch {}
  }
  if (fs.existsSync(path.join(projectDir, 'index.html'))) return { type: 'static-site', detected: 'plain HTML' };
  if (fs.existsSync(path.join(projectDir, 'requirements.txt')) || fs.existsSync(path.join(projectDir, 'pyproject.toml'))) {
    return { type: 'custom', detected: 'Python web project (Django/Flask/FastAPI?)' };
  }
  return { type: 'custom', detected: 'unknown stack' };
}

const detection = detect();
const projectType = cfgType || detection.type;
const validTypes = ['static-site', 'spa-dashboard', 'custom'];
if (!validTypes.includes(projectType)) {
  console.error(`Invalid type ${projectType}. Valid: ${validTypes.join(', ')}`);
  process.exit(1);
}

if (!cfgUrl && nonInteractive) {
  console.error('--url required in non-interactive mode');
  process.exit(1);
}
const testUrl = cfgUrl || `http://localhost:3000`;
if (!/^https?:\/\//.test(testUrl)) {
  console.error(`test_url must start with http(s)://: got ${testUrl}`);
  process.exit(1);
}

// Read template
const tplPath = path.join(skillDir, 'templates', `init-${projectType}.yml`);
if (!fs.existsSync(tplPath)) { console.error(`template not found: ${tplPath}`); process.exit(1); }
let tpl = fs.readFileSync(tplPath, 'utf8');
tpl = tpl.replace(/^name: REPLACE_ME/m, `name: ${cfgName}`);
tpl = tpl.replace(/^test_url: REPLACE_ME/m, `test_url: ${testUrl}`);

// Create directory tree
const qaRoot = path.join(projectDir, '.qa');
const subdirs = ['fixtures/good', 'fixtures/broken', 'fixtures/applied', 'flows', 'queries', 'reports', 'pending_rotations'];
for (const sub of subdirs) fs.mkdirSync(path.join(qaRoot, sub), { recursive: true });

// Write config (don't overwrite if exists)
const cfgPath = path.join(qaRoot, 'config.yml');
let cfgWritten = false;
if (fs.existsSync(cfgPath)) {
  console.log(`Existing .qa/config.yml at ${cfgPath} — leaving in place. Inspect manually if you want to reset.`);
} else {
  fs.writeFileSync(cfgPath, tpl);
  cfgWritten = true;
}

// Append to .gitignore (if it exists)
const gitignorePath = path.join(projectDir, '.gitignore');
const ignoreLines = ['.qa/reports/', '.qa/pending_rotations/', '.qa/config.json'];
if (fs.existsSync(gitignorePath)) {
  const existing = fs.readFileSync(gitignorePath, 'utf8');
  const newLines = ignoreLines.filter(l => !existing.includes(l));
  if (newLines.length) {
    fs.appendFileSync(gitignorePath, '\n# qa-pro\n' + newLines.join('\n') + '\n');
  }
} else {
  fs.writeFileSync(gitignorePath, '# qa-pro\n' + ignoreLines.join('\n') + '\n');
}

console.log(`qa-pro init complete.

  Project:        ${cfgName}
  Type:           ${projectType} (detected: ${detection.detected})
  Test URL:       ${testUrl}
  Config:         ${cfgWritten ? cfgPath + ' (written)' : cfgPath + ' (already existed)'}
  Fixtures dir:   ${path.join(qaRoot, 'fixtures')}
  Reports dir:    ${path.join(qaRoot, 'reports')} (gitignored)

Next:
  /qa:smoke      → fast suite, ~5 min
  /qa:full       → full suite with Lighthouse + oracle, ~1 min

Coverage matrix for ${projectType}:
  ✓ Functional smoke (page loads, console, network, links)
  ✓ Visual regression (deterministic, golden-anchored)
  ✓ Accessibility (axe-core, WCAG 2.2 AA)
  ✓ Performance (Lighthouse — runs in /qa:full)
  ${projectType === 'spa-dashboard' ? '○' : '✗'} Data correctness (set data_adapter in config.yml: jsonfile or rest)
  ✗ Critical user flows (drop Playwright spec files in .qa/flows/)
`);
process.exit(0);
