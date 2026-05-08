#!/usr/bin/env node
// Pre-report secret + PII scan with redaction
// Usage: node secret-scan.js <input-html-or-json> [--redact-in-place]

const fs = require('fs');

const PATTERNS = [
  { name: 'OpenAI/Anthropic key', re: /\b(sk-(ant-)?[A-Za-z0-9_-]{20,})/g, redact: '[REDACTED-API-KEY]' },
  { name: 'Bearer token', re: /\b(Bearer\s+[A-Za-z0-9_-]{20,})/g, redact: '[REDACTED-BEARER]' },
  { name: 'AWS access key', re: /\b(AKIA[0-9A-Z]{16})\b/g, redact: '[REDACTED-AWS-KEY]' },
  { name: 'GitHub PAT', re: /\b(ghp_[A-Za-z0-9]{30,})\b/g, redact: '[REDACTED-GH-PAT]' },
  { name: 'Email (potential PII)', re: /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, redact: '[REDACTED-EMAIL]' },
  { name: 'SSN-shaped', re: /\b(\d{3}-\d{2}-\d{4})\b/g, redact: '[REDACTED-SSN-SHAPE]' },
  { name: 'Salesforce ID', re: /\b([0-9a-zA-Z]{15}|[0-9a-zA-Z]{18})\b/g, redact: null }, // too noisy by default; off
  { name: 'Currency >$1M', re: /\$[\d,]{7,}(\.\d{2})?/g, redact: '[REDACTED-LARGE-CURRENCY]' },
];

const file = process.argv[2];
const redact = process.argv.includes('--redact-in-place');
if (!file || !fs.existsSync(file)) { console.error('file not found'); process.exit(1); }

let content = fs.readFileSync(file, 'utf8');
const findings = [];
for (const p of PATTERNS) {
  if (!p.redact) continue;
  const matches = [...content.matchAll(p.re)];
  if (matches.length) findings.push({ pattern: p.name, count: matches.length });
  if (redact) content = content.replace(p.re, p.redact);
}

if (redact) fs.writeFileSync(file, content);
console.log(JSON.stringify({ findings, redacted: redact }, null, 2));
process.exit(findings.length > 0 ? 2 : 0); // exit 2 = redactions made; exit 0 = clean
