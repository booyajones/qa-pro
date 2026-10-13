#!/usr/bin/env node
// qa-pro install-gate — generate CI workflow file for the deploy gate
// Usage: node install-gate.js [project-dir]

const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(process.argv[2] || process.cwd());
const refIndex = process.argv.indexOf('--ref');
const ref = refIndex >= 0 ? process.argv[refIndex + 1] : process.env.QA_PRO_REF;

function detectPlatform() {
  const has = (p) => fs.existsSync(path.join(projectDir, p));
  if (has('.github')) return 'github-actions';
  if (has('vercel.json') || has('.vercel')) return 'vercel';
  if (has('netlify.toml') || has('.netlify')) return 'netlify';
  return 'generic';
}

const platform = detectPlatform();

if (platform === 'github-actions' || (!fs.existsSync(path.join(projectDir, '.github')) && process.argv.includes('--github'))) {
  if (!/^[a-f0-9]{40}$/.test(ref || '')) {
    console.error('Pass --ref <reviewed 40-character qa-pro commit SHA> to pin the installed gate.');
    process.exit(1);
  }
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

permissions:
  contents: read

jobs:
  qa-gate:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install qa-pro
        run: |
          mkdir -p ~/.claude/skills/qa-pro
          cd ~/.claude/skills/qa-pro
          git init -q .
          git fetch -q --depth=1 https://github.com/booyajones/qa-pro.git "${ref}"
          git checkout -q --detach FETCH_HEAD
          npm ci
          npx playwright install chromium firefox webkit --with-deps

      - name: Run qa-pro gate
        run: |
          cd ~/.claude/skills/qa-pro/scripts
          node full-runner.js \${{ github.workspace }} --gate

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-pro-report
          path: |
            \${{ github.workspace }}/.qa/reports/
            \${{ github.workspace }}/.qa/last-findings.json
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
  console.log(`    "buildCommand": "node ~/.claude/skills/qa-pro/scripts/full-runner.js . --gate && <your existing build cmd>"`);
  console.log(``);
  console.log(`Option B: GitHub Actions pre-merge gate (run again with --github to write that workflow).`);
  process.exit(0);
}

if (platform === 'netlify') {
  console.log(`Netlify detected. Add to netlify.toml:`);
  console.log(`[build]`);
  console.log(`  command = "node ~/.claude/skills/qa-pro/scripts/full-runner.js . --gate && <your existing build cmd>"`);
  process.exit(0);
}

// Generic fallback
console.log(`Generic platform — paste the following into your CI:`);
console.log(``);
console.log(`  node ~/.claude/skills/qa-pro/scripts/full-runner.js . --gate`);
console.log(`  # exit 0 = green, 1 = NEW Sev 2, 2 = NEW Sev 1`);
process.exit(0);
