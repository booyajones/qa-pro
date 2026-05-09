#!/usr/bin/env node
// qa-pro install-gate — generate CI workflow file for the deploy gate
// Usage: node install-gate.js [project-dir]

const fs = require('fs');
const path = require('path');

const projectDir = process.argv[2] || process.cwd();

function detectPlatform() {
  const has = (p) => fs.existsSync(path.join(projectDir, p));
  if (has('.github')) return 'github-actions';
  if (has('vercel.json') || has('.vercel')) return 'vercel';
  if (has('netlify.toml') || has('.netlify')) return 'netlify';
  return 'generic';
}

const platform = detectPlatform();

if (platform === 'github-actions' || (!fs.existsSync(path.join(projectDir, '.github')) && process.argv.includes('--github'))) {
  const wfDir = path.join(projectDir, '.github', 'workflows');
  const wfPath = path.join(wfDir, 'qa-gate.yml');
  if (fs.existsSync(wfPath)) {
    console.error(`refusing to overwrite existing ${wfPath}. Remove it first or rename.`);
    process.exit(1);
  }
  fs.mkdirSync(wfDir, { recursive: true });
  const yaml = `name: qa-pro deploy gate

on:
  pull_request:
    branches: [main, master]
  workflow_dispatch:

jobs:
  qa-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install qa-pro
        run: |
          git clone https://github.com/booyajones/qa-pro.git ~/.claude/skills/qa-pro
          cd ~/.claude/skills/qa-pro && npm install
          npx playwright install chromium --with-deps

      - name: Run qa-pro gate
        run: |
          cd ~/.claude/skills/qa-pro/scripts
          node validate-config.js \${{ github.workspace }}/.qa/config.yml > \${{ github.workspace }}/.qa/config.json
          node smoke-runner.js \${{ github.workspace }}/.qa/config.json > \${{ github.workspace }}/.qa/last-findings.json
          node gate.js \${{ github.workspace }}/.qa/last-findings.json \${{ github.workspace }}

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-pro-report
          path: \${{ github.workspace }}/.qa/reports/
          retention-days: 14
`;
  fs.writeFileSync(wfPath, yaml);
  console.log(`Generated ${wfPath}`);
  console.log(`Commit and push. Gate runs on every PR to main/master.`);
  console.log(`Exit code 0 = green; 1 = NEW Sev 2; 2 = NEW Sev 1.`);
  process.exit(0);
}

if (platform === 'vercel') {
  console.log(`Vercel detected. There is no native pre-deploy gate; instead:`);
  console.log(``);
  console.log(`Option A (recommended): use Vercel Build Command pre-script.`);
  console.log(`  Add to vercel.json:`);
  console.log(`    "buildCommand": "node ~/.claude/skills/qa-pro/scripts/smoke-runner.js .qa/config.json > .qa/last-findings.json && node ~/.claude/skills/qa-pro/scripts/gate.js .qa/last-findings.json . && <your existing build cmd>"`);
  console.log(``);
  console.log(`Option B: GitHub Actions pre-merge gate (run again with --github to write that workflow).`);
  process.exit(0);
}

if (platform === 'netlify') {
  console.log(`Netlify detected. Add to netlify.toml:`);
  console.log(`[build]`);
  console.log(`  command = "node ~/.claude/skills/qa-pro/scripts/smoke-runner.js .qa/config.json > .qa/last-findings.json && node ~/.claude/skills/qa-pro/scripts/gate.js .qa/last-findings.json . && <your existing build cmd>"`);
  process.exit(0);
}

// Generic fallback
console.log(`Generic platform — paste the following into your CI:`);
console.log(``);
console.log(`  node ~/.claude/skills/qa-pro/scripts/smoke-runner.js .qa/config.json > .qa/last-findings.json`);
console.log(`  node ~/.claude/skills/qa-pro/scripts/gate.js .qa/last-findings.json .`);
console.log(`  # exit 0 = green, 1 = NEW Sev 2, 2 = NEW Sev 1`);
process.exit(0);
