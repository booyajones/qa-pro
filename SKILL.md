---
name: qa-pro
version: 1.3.0
description: Universal QA, UAT, accessibility, performance, visual, and data-correctness testing for any web project. Triggers on QA testing, regression check, visual diff, accessibility audit, before deploy verification, after frontend changes, dashboard testing, chart number reconciliation, broken UI check, marketing site smoke, lighthouse audit, axe-core, WCAG, "test this site", "is the dashboard right", "before I ship", "QA my app". Project-agnostic. Runs under existing Claude Code subscription, no external infra.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - WebFetch
---

# qa-pro: Universal QA Skill

You are running the qa-pro skill. The user wants to QA, UAT, or test a web project. Route their request to the right mode and execute.

## Mode dispatch

Parse the user's request to pick a mode. If ambiguous, ask one short question.

| Mode | Trigger phrases | What you do |
|---|---|---|
| `init` | "set up qa", "/qa:init", "init qa-pro for X" | Run §INIT |
| `smoke` | "/qa:smoke", "qa this", "test this", "smoke check", "before deploy" | Run §SMOKE |
| `full` | "/qa:full", "deep qa", "full audit", "before big deploy" | Run §FULL |
| `learn` | "/qa:learn", "remember this", "this was wrong", "approve this" | Run §LEARN |
| `doctor` | "/qa:doctor", "qa is broken", "diagnose qa-pro" | Run §DOCTOR |
| `report` | "/qa:report", "show last qa report", "open qa report" | Run §REPORT |

If the user invoked qa-pro but no mode is clear, default to `smoke` and tell them.

## Common preamble (every mode)

1. Read `.qa/config.yml` from cwd if present. If missing and mode != `init`, route to §INIT first with a one-line message: *"No qa-pro config found in this project. Running /qa:init first."*
2. Validate config against zod schema at `~/.claude/skills/qa-pro/scripts/validate-config.js`. Fail loud on errors.
3. Read run-ID ledger at `~/.claude/skills/qa-pro/.run-id-ledger.json` (create empty array if missing).
4. Read token ledger at `~/.claude/skills/qa-pro/.token-ledger.json` (create with `{month: <YYYY-MM>, used: 0, cap: 2000000}` if missing). If `used >= cap`, refuse to run with the explicit message in §COST.
5. Print session-start banner: *"qa-pro: <used>K / <cap>K tokens this month. <project>: <project_type>."*

---

## §INIT (interactive setup)

Goal: drop a working `.qa/config.yml` and oracle fixtures into the user's project in under 90 seconds, with at most 3 questions.

1. **Detect project type.** Check cwd for:
   - `package.json` → look for `next`, `react`, `vite`, `astro`, `sveltekit`, `vue`, `@webflow/*`
   - `requirements.txt` / `pyproject.toml` → `django`, `flask`, `fastapi`
   - `index.html` at root → plain static
   - Any `.webflow` indicator
   - If a URL was given (`--url <X>`), HEAD-fetch it: read `Server`, `<meta generator>`, scan for `[data-kpi]` or chart libs.
   - If nothing detected: default to `static-site` with note "stack not recognized; defaulting to URL-only mode."
2. **Print what you found.** *"Detected: Next.js + Tailwind. Looks like a dashboard."*
3. **Ask up to 3 questions:**
   - Q1: *"Project type? (1) static-site / marketing / blog  (2) spa-dashboard  (3) custom — pick number or describe"* (default = best guess from detection)
   - Q2: *"Does this page show numbers that come from somewhere you could re-query (a database, an API, a JSON file)? If yes, we'll set up a check that the displayed value matches the source. (yes / no / not sure → skip for now)"*
   - Q3 (only if Q2=yes): *"Where does the data come from? (1) BigQuery (2) Postgres (3) REST API (4) GraphQL (5) JSON file"* — but only `jsonfile` and `rest` adapters are wired in v1.x; if user picks 1/2/4, say *"That adapter ships in v1.2+; falling back to no data correctness for now."*
4. **Print coverage matrix and confirm:**
   ```
   qa-pro will run these checks for this project:
     ✓ Functional smoke (page loads, console errors, link integrity)
     ✓ Visual regression (deterministic, golden-anchored)
     ✓ Accessibility (axe-core, WCAG 2.2 AA)
     ✓ Performance (Lighthouse, default budgets)
     ✓ Critical flows (you've defined 0; add via .qa/flows/)
     <✓ or ✗> Data correctness (<adapter or "no adapter configured">)

   Confirm and write .qa/config.yml? [Y / change-something]
   ```
   For project_type=`custom` AND zero flows AND no adapter, also print: *"Warning: with no critical flows or data adapter, this suite only validates surface checks. Add at least one flow before relying on it. This warning will appear in every report."*
5. **Copy template** from `~/.claude/skills/qa-pro/templates/init-{static-site|spa-dashboard|custom}.yml` to `<cwd>/.qa/config.yml` with answers merged in.
6. **Create directories:** `<cwd>/.qa/{fixtures/{good,broken},flows,queries,reports,pending_rotations}`. Add `.qa/reports/` and `.qa/pending_rotations/` to `.gitignore` (append, don't replace).
7. **Snapshot known-good fixtures.** For each page in config:
   - Use Playwright (via `npx playwright`) to take a screenshot at the configured viewport.
   - Save to `.qa/fixtures/good/<page-slug>/golden-at-creation.png` (immutable) AND `.qa/fixtures/good/<page-slug>/baseline.png` (rolling).
   - Write `.qa/fixtures/good/<page-slug>/meta.json` with `source_type: "human_authored"`, `source_ref: "chris@<email> <ISO timestamp>"`, `claude_inspection_allowed: false`.
8. **Batch confirm:** *"Snapshotted N pages. Approve all as known-good? [Y / n / review-each]"*
9. **Scrape known-broken from git history.** If cwd has `.git`, run `git log --oneline -50 --grep='^fix:\|^bug:\|^regression:'`. Cap at 6 most recent. Propose each as a known-broken fixture with `source_type: "commit_sha"`, `source_ref: "<sha>"`. Batch confirm.
10. **Print success.** *"qa-pro initialized. Run /qa:smoke to validate. Coverage: <recap>."*

---

## §SMOKE (fast suite, ~5 min)

1. **Check oracle stop-flag.** If `<cwd>/.qa/oracle_failed.flag` exists, refuse to run. Print: *"Oracle is in failed state from <timestamp>. Inspect `.qa/reports/<latest>` then run /qa:learn --regression or fix the underlying issue. The suite will not run until the oracle passes."* Exit.
2. **Run oracle classification first.**
   - For each fixture in `.qa/fixtures/good/`: re-snapshot the page, compare to baseline.png. If diff > tolerance, ORACLE FAILURE: this should pass and didn't.
   - For each fixture in `.qa/fixtures/broken/`: run the suite against that page or state. If suite produces NO Sev 1+2 findings, ORACLE FAILURE: this should fail and didn't.
   - On any oracle failure: write `.qa/oracle_failed.flag` with timestamp + which fixture, halt the run, write a minimal report, open it. Tell user to triage before re-running.
3. **Run smoke checks** in this order, parallel where possible:
   - **Functional:** Playwright loads each page, captures console errors, checks all `<a href>` resolve to 2xx.
   - **Visual:** Playwright `toHaveScreenshot()` against rolling baselines, deterministic config (animations off, `Date.now()` frozen, fonts bundled).
   - **Accessibility:** `@axe-core/playwright` per page, WCAG 2.2 AA.
   - **Critical flows:** any `.qa/flows/*.spec.ts` files run as Playwright tests.
4. **Run data correctness IF adapter configured.** Call `~/.claude/skills/qa-pro/scripts/adapters/<adapter>.js` for each KPI in config. Adapter must verify git pinning + run-ID ledger entry before re-deriving. On any check failure, refuse with clear message.
5. **Build report.** Pass findings JSON to `~/.claude/skills/qa-pro/scripts/build-report.js` which:
   - Runs secret scan + redaction.
   - Generates static HTML at `.qa/reports/<ISO>/index.html`.
   - Includes coverage matrix in header (so user sees what was and wasn't checked).
6. **Open report** in default browser via `start "" "<path>"` (Windows) or appropriate per-OS.
7. **Print inline summary:** *"Oracle: N/N PASS. Suite: <pages> tested. <findings> findings (Sev1: X, Sev2: Y, Sev3: Z, Sev4: W). Report: <path>. Tokens used this run: ~K."*
8. **Update token ledger** with run cost.

---

## §FULL (deep suite, ~10 min)

Same as §SMOKE plus:
- Lighthouse CI per page with budgets from config.
- Cross-browser if `cross_browser: true` in config (Firefox + WebKit).
- Email-rendering checks if `email_module: true`.

Vision-call hard cap: 30 per /qa:full run, code-enforced. Track in `~/.claude/skills/qa-pro/.token-ledger.json`. If exceeded, fail closed with: *"Vision call cap reached for this run. Halting. Raise cap in config or split run."*

---

## §LEARN (feedback + fixture rotation)

Three sub-commands:

### `--approve <finding-id>` (queue a rotation)
1. Read the finding from latest report's findings.json.
2. Generate run-id: `qa-learn-run-<ISO>-<random4>`.
3. Append entry to `~/.claude/skills/qa-pro/.run-id-ledger.json`:
   ```json
   {"run_id": "...", "issued_at": "...", "issued_by": "qa:learn --approve",
    "project": "<cwd>", "fixture_id": "<id>", "status": "open"}
   ```
4. Write `<cwd>/.qa/pending_rotations/<run-id>.json` with full pending fixture state.
5. Print VERBATIM the message in §LEARN-APPROVE-MESSAGE below.
6. Do NOT modify any fixture file. Nothing applied yet.

### `--confirm <run-id>` (apply a queued rotation)
1. Read pending entry from ledger. Verify:
   - 24h+ since `issued_at`.
   - Current Claude Code session ID != session that issued (if available; otherwise warn but proceed).
   - Status is `open`.
2. **Re-derive the expected value from source-of-truth** based on fixture type:
   - `bq_query`: re-run query (or read daily cache); assert pending value within tolerance.
   - `snapshot`: re-take live snapshot; three-way diff against pending AND `golden-at-creation.png`. BOTH must match within tolerance.
   - `commit_sha`: re-read commit diff; assert fixture references still resolve.
   - `human_authored`: prompt user to open the fixture file and retype the `source_ref` value. Assert byte-equal.
3. If re-derivation fails: refuse rotation, print diff, mark ledger entry `failed`.
4. If passes: apply rotation (rename pending file into place), mark ledger entry `consumed`.
5. Print success.

### `--regression <finding-id> "<human reason>"` (additive)
1. Generate run-id (issued_by: `qa:learn --regression`).
2. Add the finding's page/state as new fixture in `.qa/fixtures/broken/<page-slug>/`.
3. Write meta.json with `source_type: "human_authored"`, `source_ref: "<reason>"`, run_id reference.
4. Mark ledger entry `consumed` immediately (regressions are additive, no delay).
5. Clear `.qa/oracle_failed.flag` if it referenced a related fixture.
6. Print: *"Regression captured. Fixture <id> added. Suite will catch this from the next run."*

### §LEARN-APPROVE-MESSAGE (verbatim)
```
ROTATION QUEUED.

  Fixture: {id}
  Pending file: .qa/pending_rotations/{run-id}.json
  Earliest confirm time: {issued_at + 24h, ET}
  Source-of-truth: {source_type}

What --confirm will do:
  - bq_query:        re-run query, assert match within tolerance
  - snapshot:        re-snap, three-way compare (live, pending, golden-at-creation)
  - commit_sha:      re-read commit diff, assert fixture references still resolve
  - human_authored:  open the fixture file and retype the source_ref value

Next step: from a NEW Claude Code session opened after the time above,
run /qa:learn --confirm {run-id}.

Nothing has changed in your fixture set yet.
```

---

## §DOCTOR (diagnose breakage)

Run these checks and print a green/yellow/red status table:
- Skill version (read from this file's frontmatter)
- Node, npx, Playwright, axe versions (`npx playwright --version`, etc.)
- Run-ID ledger health: count entries by status (open/consumed/expired/failed); flag if >5 open >24h
- Token ledger: month, used, cap, remaining
- `.allow-dirty-ledger.json` if exists: count this month
- For cwd: does `.qa/config.yml` exist? Validates against schema?
- For cwd: oracle stop-flag present?
- Print copy-pasteable fix for any RED row.

---

## §REPORT (open last report)

`ls -t .qa/reports/*/index.html | head -1` then open in browser. If no reports, print *"No reports yet. Run /qa:smoke."*

---

## §COST (token cap exceeded)

Print VERBATIM:
```
qa-pro: monthly token cap reached.
  Used: {used} / {cap} tokens
  Reset: {first day of next month}
  Raise cap in <project>/.qa/config.yml under monthly_token_cap, or wait.
  /qa:smoke and /qa:full halted.
```

---

## Severity rules

- **Sev 1:** oracle failure, BQ/data reconciliation mismatch beyond tolerance, security finding (XSS/CSRF/secret leak), total page failure (5xx/never loads).
- **Sev 2:** functional bug (button broken, form fails), WCAG AA violation in critical path, perf regression >25%.
- **Sev 3:** visual drift not affecting comprehension, minor a11y outside critical paths, perf regression <25%.
- **Sev 4:** flakes, healer activity, baseline updates. Auto-quarantine after 2/10 fails. 14-day expiry.

No paging. Severity drives report ordering and color.

---

## Forbidden

- NEVER run tests against production data inputs.
- NEVER author oracle fixtures with `source_type: claude_inspection`. Refuse them at zod schema.
- NEVER let `/qa:learn --confirm` apply a rotation without successful re-derivation.
- NEVER bypass the run-ID ledger gate when accepting a commit as source-of-truth.
- NEVER delete `golden-at-creation.png` files programmatically. Only Jacob's PR (or the user's explicit manual delete) can rotate them.
- NEVER auto-merge healer patches to `main` (this skill doesn't autonomous-heal in v1.x; bounded healing is a v2 feature).
