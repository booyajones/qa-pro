#!/usr/bin/env node
// /qa:report — open the latest report in the current project
// Usage: node open-report.js [project-dir]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
const opened = spawnSync(command, [indexPath], { encoding: 'utf8' });
if (opened.error || opened.status !== 0) {
  console.error(`could not auto-open: ${opened.error?.message || opened.stderr || opened.status}`);
  process.exitCode = 1;
}
