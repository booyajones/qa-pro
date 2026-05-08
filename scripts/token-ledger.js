#!/usr/bin/env node
// Token ledger: track monthly token usage
// Usage:
//   node token-ledger.js status                        -> JSON status
//   node token-ledger.js add <count>                   -> add to current month
//   node token-ledger.js banner                        -> human readable banner

const fs = require('fs');
const path = require('path');
const os = require('os');

const LEDGER = path.join(os.homedir(), '.claude', 'skills', 'qa-pro', '.token-ledger.json');
const DEFAULT_CAP = 2000000;

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function load() {
  const month = currentMonth();
  if (!fs.existsSync(LEDGER)) return { month, used: 0, cap: DEFAULT_CAP };
  try {
    const d = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    if (d.month !== month) return { month, used: 0, cap: d.cap || DEFAULT_CAP }; // monthly reset
    return d;
  } catch { return { month, used: 0, cap: DEFAULT_CAP }; }
}
function save(d) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(d, null, 2));
}

const cmd = process.argv[2] || 'status';
let d = load();

if (cmd === 'status') {
  console.log(JSON.stringify(d, null, 2));
  process.exit(d.used >= d.cap ? 1 : 0);
}
if (cmd === 'add') {
  d.used += parseInt(process.argv[3] || '0', 10);
  save(d);
  console.log(JSON.stringify(d, null, 2));
  process.exit(d.used >= d.cap ? 1 : 0);
}
if (cmd === 'banner') {
  const usedK = Math.round(d.used / 1000);
  const capK = Math.round(d.cap / 1000);
  const pct = Math.round((d.used / d.cap) * 100);
  const status = pct >= 100 ? 'CAP REACHED' : pct >= 90 ? 'WARN' : 'OK';
  console.log(`qa-pro: ${usedK}K / ${capK}K tokens this month. ${status}.`);
  process.exit(d.used >= d.cap ? 1 : 0);
}
console.error('unknown command. usage: status|add|banner');
process.exit(1);
