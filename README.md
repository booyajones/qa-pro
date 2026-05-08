# qa-pro

Universal QA, UAT, accessibility, performance, visual, and data-correctness testing for any web project. A Claude Code skill that runs entirely under your existing Claude Code subscription.

[![Council-approved](https://img.shields.io/badge/council-8%2F8-brightgreen)]()
[![Skill version](https://img.shields.io/badge/version-1.0.4-blue)]()

## What it does

| Layer | What |
|---|---|
| Functional smoke | Page loads, no console errors, no failed network requests, all links resolve (with smart bot-blocker domain skip) |
| Visual regression | Pixel-diff with deterministic config (animations off, time frozen, fonts bundled, fixed viewports). Immutable `golden-at-creation` anchor catches lockstep drift |
| Accessibility | axe-core, WCAG 2.2 AA per page |
| Performance | Lighthouse v12: perf + a11y + best-practices + SEO + Core Web Vitals (LCP, CLS, TBT) |
| Data correctness | Optional adapters: `jsonfile` (git-HEAD-pinned) and `rest` (JSONPath + optional SHA-256 integrity). BigQuery / Postgres / GraphQL coming. |
| Oracle classification | Verifies the suite still catches known-broken fixtures and that known-good pages stay clean. Halts on drift. |

## Install

The skill lives at `~/.claude/skills/qa-pro/` and is auto-discovered by Claude Code. To set up on a fresh machine:

```bash
git clone https://github.com/booyajones/qa-pro.git ~/.claude/skills/qa-pro
cd ~/.claude/skills/qa-pro && npm install
```

Playwright + axe-core + Lighthouse + pixelmatch all install via `npm install`. Chromium downloads on first `/qa:smoke` run if not cached.

## Use

In any project directory, in any Claude Code session:

```bash
# First time setup for a project
/qa:init

# Fast suite (~5 min): smoke + visual + a11y
/qa:smoke

# Full suite (~50 sec + Lighthouse 30-60 sec): adds perf + Lighthouse + oracle
/qa:full

# Open the latest report
/qa:report

# Diagnose health
/qa:doctor

# Capture a finding as known-broken (additive, immediate)
/qa:learn --regression <finding-id> "human-readable reason"

# Queue a fixture rotation (24h delay + cross-session re-derivation required)
/qa:learn --approve <finding-id>

# Apply queued rotation after 24h from a different session
/qa:learn --confirm <run-id>
```

You can also just say "QA my site at https://example.com" and Claude Code's auto-invoke will reach for qa-pro.

## Project types

Drop one of these into `.qa/config.yml` (or run `/qa:init`):

- `static-site` — marketing, blog, portfolio. URL-only.
- `spa-dashboard` — SPA with KPIs/charts. Optional data-correctness module.
- `webapp-with-auth` — auth flow templates (cookie/magic-link/OAuth/basic).
- `ecommerce` — purchase flow tests, payment a11y. (v1.2)
- `custom` — anything else. Warns if you have no flows or adapter.

## Architecture

```
~/.claude/skills/qa-pro/
├── SKILL.md                    # Dispatcher (Claude reads this)
├── package.json                # Pinned deps (playwright, axe, lighthouse@12, pixelmatch, pngjs)
├── scripts/
│   ├── runner.ts → not used; mode dispatch lives in SKILL.md and dedicated scripts
│   ├── validate-config.js      # zod-like config validation
│   ├── smoke-runner.js         # Playwright + axe + console/network + smart link checker
│   ├── visual-runner.js        # pixel-diff + golden-at-creation
│   ├── lighthouse-runner.js    # Lighthouse v12
│   ├── oracle-runner.js        # broken-fixture matching + good-fixture protection
│   ├── full-runner.js          # orchestrator: smoke → visual → lighthouse → oracle → report
│   ├── learn.js                # /qa:learn --approve/--confirm/--regression
│   ├── doctor.js               # /qa:doctor health check
│   ├── open-report.js          # /qa:report
│   ├── build-report.js         # static HTML + secret scan + auto-open
│   ├── secret-scan.js          # API keys, emails, SSN, large currency, GH PAT
│   ├── token-ledger.js         # 2M tokens/mo cap, code-enforced
│   ├── run-id-ledger.js        # issue/verify/consume/audit run IDs
│   ├── git-source-check.js     # HEAD pinning, dirty-tree, run-ID prefix verification
│   └── adapters/
│       ├── jsonfile.js         # git-HEAD-pinned JSON file source-of-truth
│       └── rest.js             # HTTP endpoint with JSONPath + SHA integrity
├── templates/
│   ├── init-static-site.yml
│   ├── init-spa-dashboard.yml
│   └── init-custom.yml
└── references/
    └── (Rule 1 learning loop populates this over time)
```

Per-project assets live in each project's repo:

```
<project>/.qa/
├── config.yml                  # zod-validated; what to test
├── fixtures/
│   ├── good/<page>/<viewport>/{baseline,golden-at-creation,meta}.png|json
│   └── broken/<id>.json        # human-authored or commit-sha-sourced known bugs
├── flows/                      # Playwright spec files for critical user paths
├── queries/                    # SQL files for data-correctness adapters
├── reports/<timestamp>/        # generated HTML reports (auto-opens)
├── pending_rotations/          # /qa:learn --approve queue
└── oracle_failed.flag          # written by oracle on drift; halts subsequent runs
```

## Closed-loop design (what makes the suite credible)

The suite cannot grade itself green. Defenses:

1. **Provenance schema:** every fixture declares `source_type` (`human_authored`, `commit_sha`, `bug_ticket`, etc). Fixtures with `source_type: claude_inspection` are refused at load time.
2. **Run-ID ledger:** every `/qa:learn` invocation issues a run ID persisted to `~/.claude/skills/qa-pro/.run-id-ledger.json`. The jsonfile adapter refuses to use a commit as source-of-truth unless its message starts with a real ledger-backed `qa-learn-run-<id>:` prefix. Forging requires writing to the ledger AND the commit AND surviving quarterly audit.
3. **24h + cross-session `--confirm`:** `/qa:learn --approve` queues a rotation; `--confirm` requires elapsed 24h from a different Claude Code session.
4. **Re-derivation:** at confirm time, the runner reproduces the value from source-of-truth (BQ rerun / pixel re-snap / commit diff) and asserts match. Autopilot impossible.
5. **Three-way diff for visual:** re-snap compared to pending baseline AND immutable `golden-at-creation` anchor. Catches lockstep drift.
6. **Oracle classification:** every run verifies the suite still catches known-broken fixtures. Drift writes a stop-flag; subsequent runs refuse to start until cleared via `/qa:learn`.

## Cost

- ~$0 marginal under existing Claude Code subscription.
- BigQuery: pennies/run if cached.
- Hard caps: 2M tokens/mo default, 500K/run, 30 vision calls per `/qa:full`. Code-enforced.

## License

Private. Owned by Chris Wyatt.
