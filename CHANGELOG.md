# Changelog

All notable changes to qa-pro.

## [1.0.4] - 2026-05-08
- `learn.js`: snapshot source_type `--confirm` now does a real three-way pixel diff at confirm time. Re-snaps live page, compares to pending baseline AND immutable golden-at-creation. Both must match within tolerance (`visual_threshold` for live↔pending, 50× tolerance for live↔golden). Catches lockstep drift.
- `adapters/rest.js`: REST data-correctness adapter. JSONPath-lite extraction, optional bearer-token auth via env-var reference, optional SHA-256 integrity check.

## [1.0.3] - 2026-05-08
- `oracle-runner.js`: oracle classification phase. Verifies suite still catches known-broken fixtures and that known-good pages stay clean. Refuses fixtures with `claude_inspection` provenance. Writes `.qa/oracle_failed.flag` on critical drift.
- `full-runner.js`: oracle phase wired after smoke+visual+lighthouse. Stop-flag check at start.
- Validated: caught a real chriswyatt.dev transient (`net::ERR_CONNECTION_RESET`) on the known-good home page, fired Sev 1 oracle conflict, halted subsequent run.

## [1.0.2] - 2026-05-08
- `visual-runner.js`: pixel-diff with immutable golden-at-creation anchors. First run establishes baseline + golden + meta.json (`source_type: human_authored`, `claude_inspection_allowed: false`). >0.1% diff → Sev 3, >5% → Sev 2.
- `full-runner.js`: orchestrator chaining smoke + visual + lighthouse with merged findings, dedupe, oracle stop-flag check.
- Pinned `lighthouse@^12.6.1` (avoids Node 22.19 requirement of v13). Added `pixelmatch` and `pngjs`.

## [1.0.1] - 2026-05-08
- `/qa:doctor`: 9-row health check (skill version, deps, ledgers, project config, oracle status).
- `/qa:report`: opens latest `.qa/reports/<ts>/index.html`.
- `/qa:learn` scaffolded with run-ID ledger and re-derivation dispatch.
- `adapters/jsonfile.js`: git-HEAD-pinned, refuses dirty working tree without `--allow-dirty`, run-ID-prefix verified via ledger.
- `lighthouse-runner.js`: perf + a11y + best-practices + SEO scoring with Core Web Vitals.
- `smoke-runner.js`: skip bot-blocking domains (linkedin.com, amazon.com, etc) that 404/503 non-browser requests regardless of method. Switched HEAD→GET for link checks.

## [1.0.0] - 2026-05-08
- Initial release. Council-approved 8/8 dimensions across 4 iterations (v1.0 → v1.3 of the agnostic plan).
- `SKILL.md` dispatcher with mode routing (init / smoke / full / learn / doctor / report).
- `smoke-runner.js`: Playwright + axe-core + console capture + network capture + link checker.
- `validate-config.js`: zod-like config validation.
- `secret-scan.js`: API keys, emails, SSN-shape, large currency, GitHub PATs, AWS keys.
- `token-ledger.js`: monthly cap (2M tokens default), code-enforced.
- `run-id-ledger.js`: issue/verify/consume/audit, ledger-backed prefix verification.
- `git-source-check.js`: git HEAD pinning, dirty-tree detection, `--allow-dirty` ledger.
- 3 templates: static-site, spa-dashboard, custom.
- Validated end-to-end against `chriswyatt.dev`: 0 findings, 5.7s runtime.
