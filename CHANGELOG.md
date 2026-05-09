# Changelog

All notable changes to qa-pro.

## [1.1.0] - 2026-05-08 — Pre-Deploy Gate
- **Gate machinery (`gate.js`)**: `/qa:smoke --gate` and `/qa:full --gate` exit 0/1/2 based on **NEW** Sev 1+2 findings vs `.qa/accepted.yml` baseline. Eliminates day-1 wall of red on existing projects.
- **`accept.js`**: `qa-pro accept add|remove|list|baseline` commands manage the accepted set. `baseline` snapshots all current Sev 1+2 findings as accepted with provenance (`source_type: human_authored`, ISO timestamp).
- **Stack auto-detection (`stack-detect.js`)**: response-header fingerprinting detects vercel/cloudflare/webflow/nextjs/netlify/generic. Each stack gets a sev profile (e.g., HSTS is Sev 2 on generic, Sev 3 on managed hosts). Configurable via `.qa/config.yml` `security.stack` and `security.disable`.
- **`checks/security-headers.js`**: HTTPS enforcement (universal Sev 1), HSTS, X-Content-Type-Options, X-Frame-Options/CSP frame-ancestors, CSP, Referrer-Policy, Permissions-Policy. CSP `report-uri` redacted by secret scan.
- **`checks/seo.js`**: title length (10-65), meta description (50-160), canonical (absolute), og:title/description/image, twitter:card, html lang, JSON-LD parse-validity. Once-per-run: sitemap.xml + robots.txt reachable. Skipped on localhost.
- **`checks/images.js`**: alt missing → Sev 2, broken (4xx/5xx) → Sev 2, oversized (>500KB configurable) → Sev 3.
- **`checks/404.js`**: redirect-aware probe at random path. Login-redirect or login-form-on-200 → skipped (auth-walled). Real 200 with non-login content → Sev 2 broken-routing finding.
- **Console warnings tier (in smoke-runner)**: deprecations, mixed-content, CSP violations captured as Sev 3.
- **`install-gate.js`**: detects platform (GitHub Actions, Vercel, Netlify, generic), generates `.github/workflows/qa-gate.yml` for GitHub. Refuses to overwrite existing workflows.
- **smoke-runner refactored**: lazy-requires v1.1 check modules so v1.0 install paths still work. Console-warn capture extension.
- **Validated**: chriswyatt.dev → 3 findings (1 Sev 3 CSP-missing, 1 Sev 4 stack=vercel, 1 Sev 4 404-routing-OK). Stack auto-detection correctly identified Vercel and applied lenient profile (no day-1 wall of red).

Council: SHIP, all 3 reviewers ≥8 across all 8 dimensions on v1.1 plan v2.0.

Deferred to v1.2: cross-browser smoke, `--changed-only` (with deploy SHA resolution), trend tracking + run-history retention, `/qa:trend` command.

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
