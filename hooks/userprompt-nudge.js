#!/usr/bin/env node
// UserPromptSubmit hook for qa-pro
// Reads the user's prompt from stdin (Claude Code passes it). If the prompt mentions
// QA / regression / test / before deploy / etc, injects a one-line nudge so Claude
// Code reaches for qa-pro reliably.
//
// To register: see .claude/settings.json instructions in README. Hook is idempotent
// and ~10ms; never blocks; never fails the user's prompt.

const fs = require('fs');
const path = require('path');

let stdin = '';
try {
  stdin = fs.readFileSync(0, 'utf8');
} catch { /* no stdin */ }

let payload = {};
try { payload = JSON.parse(stdin); } catch { payload = { prompt: stdin || '' }; }

const prompt = (payload.prompt || payload.userMessage || '').toString().toLowerCase();

const TRIGGERS = [
  /\b(qa|q\.a\.)\b/i,
  /\b(regression)\b/i,
  /\b(before (i|we) (ship|deploy|push))\b/i,
  /\b(is (the|this) (site|page|dashboard|app) broken)\b/i,
  /\b(test (this|the|my) (site|page|dashboard|app|frontend|ui))\b/i,
  /\b(check (the|my)? ?accessibility|a11y|wcag)\b/i,
  /\b(visual diff|visual regression|screenshot diff)\b/i,
  /\b(lighthouse|core web vitals|cwv|page perf)\b/i,
  /\b(broken|drift) (link|page|chart|number|kpi)\b/i,
];

const hit = TRIGGERS.some(re => re.test(prompt));
if (!hit) process.exit(0);

// Inject nudge as additional context (Claude Code reads this hook's stdout as supplemental context)
const nudge = `[qa-pro available] The qa-pro skill at ~/.claude/skills/qa-pro/ handles QA/UAT/regression/visual/a11y/perf for any web project. Consider invoking it for this turn if it fits. Commands: /qa:init, /qa:smoke, /qa:full, /qa:learn, /qa:doctor, /qa:report.`;
console.log(JSON.stringify({ additionalContext: nudge }));
process.exit(0);
