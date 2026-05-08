#!/usr/bin/env node
// /qa:report — open the latest report in the current project
// Usage: node open-report.js [project-dir]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectDir = process.argv[2] || process.cwd();
const reportsDir = path.join(projectDir, '.qa', 'reports');

if (!fs.existsSync(reportsDir)) {
  console.error('No reports yet. Run /qa:smoke first.');
  process.exit(1);
}

const dirs = fs.readdirSync(reportsDir)
  .map(d => ({ name: d, full: path.join(reportsDir, d) }))
  .filter(d => fs.statSync(d.full).isDirectory())
  .sort((a, b) => b.name.localeCompare(a.name));

if (!dirs.length) {
  console.error('No reports yet. Run /qa:smoke first.');
  process.exit(1);
}

const indexPath = path.join(dirs[0].full, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error(`Latest report has no index.html: ${dirs[0].full}`);
  process.exit(1);
}

console.log(`Opening: ${indexPath}`);
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
try {
  if (isWin) execSync(`start "" "${indexPath}"`, { shell: true });
  else if (isMac) execSync(`open "${indexPath}"`);
  else execSync(`xdg-open "${indexPath}"`);
} catch (e) { console.error(`could not auto-open: ${e.message}`); process.exit(1); }
