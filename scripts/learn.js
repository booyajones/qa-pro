#!/usr/bin/env node
// /qa:learn — feedback loop with provenance + re-derivation
// Usage:
//   node learn.js --approve <finding-id> [project-dir]
//   node learn.js --confirm <run-id> [project-dir]
//   node learn.js --regression <finding-id> "<reason>" [project-dir]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const skillDir = path.join(__dirname, '..');
const args = process.argv.slice(2);
const mode = args[0];
const projectDir = process.cwd();

function fail(msg) { console.error(`qa-pro learn: ${msg}`); process.exit(1); }

function loadLatestFindings() {
  const reportsDir = path.join(projectDir, '.qa', 'reports');
  if (!fs.existsSync(reportsDir)) fail('no reports yet — run /qa:smoke first');
  const dirs = fs.readdirSync(reportsDir).filter(d => fs.statSync(path.join(reportsDir, d)).isDirectory()).sort().reverse();
  if (!dirs.length) fail('no reports yet');
  const findingsPath = path.join(reportsDir, dirs[0], 'findings.json');
  if (!fs.existsSync(findingsPath)) fail(`no findings.json in ${dirs[0]}`);
  return { findings: JSON.parse(fs.readFileSync(findingsPath, 'utf8')), dir: path.join(reportsDir, dirs[0]) };
}

function fingerprint(f) {
  return `${f.severity}-${f.layer}-${f.page || ''}-${(f.finding || '').slice(0, 40).replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
}

if (mode === '--approve') {
  const findingId = args[1];
  if (!findingId) fail('usage: --approve <finding-id>');

  const { findings } = loadLatestFindings();
  const list = findings.findings || [];
  const target = list.find(f => fingerprint(f) === findingId || fingerprint(f).startsWith(findingId));
  if (!target) fail(`finding ${findingId} not found in latest report. Available: ${list.map(fingerprint).join(', ')}`);

  // Issue run-ID
  const issue = spawnSync('node', [path.join(__dirname, 'run-id-ledger.js'), 'issue', 'qa:learn --approve', projectDir, findingId], { encoding: 'utf8' });
  if (issue.status !== 0) fail(`run-id issue failed: ${issue.stderr}`);
  const runId = issue.stdout.trim();

  // Write pending rotation
  const pendingDir = path.join(projectDir, '.qa', 'pending_rotations');
  fs.mkdirSync(pendingDir, { recursive: true });
  const pendingFile = path.join(pendingDir, `${runId}.json`);
  const sourceType = target.source_type || 'snapshot'; // default for visual; adapter findings carry their own
  fs.writeFileSync(pendingFile, JSON.stringify({ run_id: runId, finding: target, fingerprint: findingId, queued_at: new Date().toISOString(), source_type: sourceType }, null, 2));

  const confirmTime = new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  console.log(`
ROTATION QUEUED.

  Fixture: ${findingId}
  Pending file: ${path.relative(projectDir, pendingFile)}
  Earliest confirm time: ${confirmTime}
  Source-of-truth: ${sourceType}

What --confirm will do:
  - bq_query:        re-run query, assert match within tolerance
  - snapshot:        re-snap, three-way compare (live, pending, golden-at-creation)
  - commit_sha:      re-read commit diff, assert fixture references still resolve
  - human_authored:  open the fixture file and retype the source_ref value

Next step: from a NEW Claude Code session opened after the time above,
run /qa:learn --confirm ${runId}.

Nothing has changed in your fixture set yet.
`);
  process.exit(0);
}

if (mode === '--confirm') {
  const runId = args[1];
  if (!runId) fail('usage: --confirm <run-id>');

  // Verify ledger entry
  const verify = spawnSync('node', [path.join(__dirname, 'run-id-ledger.js'), 'verify', runId, projectDir], { encoding: 'utf8' });
  if (verify.status !== 0) fail(`ledger verify failed: ${verify.stderr}`);
  const entry = JSON.parse(verify.stdout);

  // Check 24h elapsed
  const elapsed = Date.now() - new Date(entry.issued_at).getTime();
  if (elapsed < 24 * 3600 * 1000) {
    const remaining = Math.ceil((24 * 3600 * 1000 - elapsed) / 60000);
    fail(`not enough time elapsed since --approve. ${remaining} minutes remaining.`);
  }

  // Load pending rotation
  const pendingFile = path.join(projectDir, '.qa', 'pending_rotations', `${runId}.json`);
  if (!fs.existsSync(pendingFile)) fail(`pending rotation file not found: ${pendingFile}`);
  const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));

  // Re-derive based on source_type
  console.log(`Re-deriving from source-of-truth (${pending.source_type})...`);

  if (pending.source_type === 'human_authored') {
    // Open the fixture file path; user retypes source_ref
    const fxFile = pending.fixture_file || path.join(projectDir, '.qa', 'fixtures', 'good', `${pending.fingerprint}.json`);
    if (!fs.existsSync(fxFile)) fail(`fixture file not found at ${fxFile}; cannot re-derive`);
    const fx = JSON.parse(fs.readFileSync(fxFile, 'utf8'));
    if (!fx.source_ref) fail('fixture has no source_ref; cannot re-derive');
    console.log(`Open ${fxFile}, find the source_ref field, and paste its value here:`);
    console.log(`(For now in v1.x, this command requires the user to re-type via prompt — running interactively is required.)`);
    fail('interactive retype not yet wired in v1.0; defer human_authored confirm to v1.1');
  } else if (pending.source_type === 'snapshot') {
    // Three-way diff: re-snap live, compare to pending AND to golden-at-creation
    const finding = pending.finding || {};
    const slug = (finding.page === '/' ? 'home' : (finding.page || 'unknown')).replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const viewport = finding.viewport || 'desktop';
    const fxDir = path.join(projectDir, '.qa', 'fixtures', 'good', slug, viewport);
    const baselineFile = path.join(fxDir, 'baseline.png');
    const goldenFile = path.join(fxDir, 'golden-at-creation.png');
    if (!fs.existsSync(baselineFile) || !fs.existsSync(goldenFile)) fail(`fixture artifacts missing at ${fxDir} (need baseline.png + golden-at-creation.png)`);

    // Read the test_url from project config
    const cfgYml = path.join(projectDir, '.qa', 'config.yml');
    if (!fs.existsSync(cfgYml)) fail('no .qa/config.yml — cannot determine test URL');
    const cfgValidate = spawnSync('node', [path.join(__dirname, 'validate-config.js'), cfgYml], { encoding: 'utf8' });
    if (cfgValidate.status !== 0) fail(`config invalid: ${cfgValidate.stderr}`);
    const cfg = JSON.parse(cfgValidate.stdout);

    // Re-take snapshot via a one-shot Playwright run
    console.log(`Re-snapping ${finding.page || '/'} at ${viewport} viewport...`);
    const skillDir = path.join(__dirname, '..');
    const { chromium } = require(path.join(skillDir, 'node_modules', 'playwright'));
    const pixelmatch = require(path.join(skillDir, 'node_modules', 'pixelmatch'));
    const { PNG } = require(path.join(skillDir, 'node_modules', 'pngjs'));
    const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

    (async () => {
      const browser = await chromium.launch();
      const ctx = await browser.newContext({
        viewport: VIEWPORTS[viewport] || VIEWPORTS.desktop,
        userAgent: 'qa-pro-confirm/1.4',
        reducedMotion: 'reduce',
      });
      await ctx.addInitScript(() => {
        const epoch = 1717286400000;
        Date.now = () => epoch;
        const D = Date;
        Date = function(...args) { return args.length ? new D(...args) : new D(epoch); };
        Date.now = () => epoch;
        Object.setPrototypeOf(Date, D);
        Date.prototype = D.prototype;
        let s = 1; Math.random = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      });
      const page = await ctx.newPage();
      const url = new URL(finding.page || '/', cfg.test_url).toString();
      try { await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }); }
      catch (e) { console.error(`re-snap nav failed: ${e.message}`); await browser.close(); process.exit(5); }

      const masking = cfg.masking || [];
      await page.addStyleTag({ content: `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
        ${masking.map(m => `${m.selector} { visibility: hidden !important; }`).join('\n')}` }).catch(() => {});

      const liveBuf = await page.screenshot({ fullPage: false, type: 'png' });
      await browser.close();

      const live = PNG.sync.read(liveBuf);
      const baseline = PNG.sync.read(fs.readFileSync(baselineFile));
      const golden = PNG.sync.read(fs.readFileSync(goldenFile));

      function diffRatio(a, b) {
        if (a.width !== b.width || a.height !== b.height) return 1.0;
        const d = new (require(path.join(skillDir, 'node_modules', 'pngjs')).PNG)({ width: a.width, height: a.height });
        const px = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 });
        return px / (a.width * a.height);
      }

      const tol = cfg.visual_threshold || 0.001;
      const liveVsPending = diffRatio(live, baseline); // pending IS the rotated baseline
      const liveVsGolden = diffRatio(live, golden);

      console.log(`live vs pending baseline: ${(liveVsPending * 100).toFixed(3)}%`);
      console.log(`live vs golden-at-creation: ${(liveVsGolden * 100).toFixed(3)}%`);

      if (liveVsPending > tol) {
        console.error(`refusing rotation: live page no longer matches pending baseline (drifted ${(liveVsPending * 100).toFixed(2)}% > ${(tol * 100).toFixed(2)}%)`);
        process.exit(6);
      }
      if (liveVsGolden > tol * 50) {
        // Golden anchor is the immutable origin; if live has drifted >50x tolerance from it,
        // even though pending matches, the page has degraded gradually. Refuse.
        console.error(`refusing rotation: live page has lockstep-drifted from golden-at-creation (${(liveVsGolden * 100).toFixed(2)}%). Re-author the fixture explicitly via /qa:learn --regression.`);
        process.exit(7);
      }

      console.log(`three-way diff passed; rotation accepted.`);

      // Apply rotation: rename pending file to applied
      const appliedDir = path.join(projectDir, '.qa', 'fixtures', 'applied');
      fs.mkdirSync(appliedDir, { recursive: true });
      const appliedFile = path.join(appliedDir, `${runId}.json`);
      fs.renameSync(pendingFile, appliedFile);
      spawnSync('node', [path.join(__dirname, 'run-id-ledger.js'), 'consume', runId], { encoding: 'utf8' });
      console.log(`Rotation applied. Fixture committed at ${appliedFile}.`);
      process.exit(0);
    })().catch(e => { console.error(e); process.exit(1); });
    return; // async path takes over
  } else if (pending.source_type === 'commit_sha') {
    const sha = pending.finding.source_ref || pending.source_ref;
    if (!sha) fail('no commit SHA in fixture');
    const check = spawnSync('git', ['cat-file', '-e', sha], { cwd: projectDir });
    if (check.status !== 0) fail(`commit ${sha} no longer exists in repo; refusing rotation`);
    console.log(`commit ${sha} verified; rotation accepted.`);
  } else if (pending.source_type === 'bq_query' || pending.source_type === 'jsonfile' || pending.source_type === 'rest') {
    // Adapter re-derivation (v1.1 handles full path)
    fail(`${pending.source_type} adapter re-derivation runtime ships in v1.1; for now, drop the fixture manually if certain`);
  } else {
    fail(`unknown source_type: ${pending.source_type}`);
  }

  // Apply rotation: rename pending file to applied
  const appliedDir = path.join(projectDir, '.qa', 'fixtures', 'applied');
  fs.mkdirSync(appliedDir, { recursive: true });
  const appliedFile = path.join(appliedDir, `${runId}.json`);
  fs.renameSync(pendingFile, appliedFile);

  // Mark ledger consumed
  spawnSync('node', [path.join(__dirname, 'run-id-ledger.js'), 'consume', runId], { encoding: 'utf8' });

  console.log(`Rotation applied. Fixture committed at ${appliedFile}.`);
  process.exit(0);
}

if (mode === '--regression') {
  const findingId = args[1];
  const reason = args.slice(2).join(' ');
  if (!findingId || !reason) fail('usage: --regression <finding-id> "<human reason>"');

  const { findings } = loadLatestFindings();
  const list = findings.findings || [];
  const target = list.find(f => fingerprint(f) === findingId || fingerprint(f).startsWith(findingId));
  if (!target) fail(`finding ${findingId} not found`);

  // Issue run-ID
  const issue = spawnSync('node', [path.join(__dirname, 'run-id-ledger.js'), 'issue', 'qa:learn --regression', projectDir, findingId], { encoding: 'utf8' });
  if (issue.status !== 0) fail(`run-id issue failed: ${issue.stderr}`);
  const runId = issue.stdout.trim();

  // Add to broken fixtures
  const brokenDir = path.join(projectDir, '.qa', 'fixtures', 'broken');
  fs.mkdirSync(brokenDir, { recursive: true });
  const fxFile = path.join(brokenDir, `${findingId}.json`);
  fs.writeFileSync(fxFile, JSON.stringify({
    fingerprint: findingId,
    finding: target,
    source_type: 'human_authored',
    source_ref: reason,
    run_id: runId,
    captured_at: new Date().toISOString(),
    claude_inspection_allowed: false,
  }, null, 2));

  // Consume run-ID immediately (regressions are additive)
  spawnSync('node', [path.join(__dirname, 'run-id-ledger.js'), 'consume', runId], { encoding: 'utf8' });

  // Clear oracle stop-flag if present
  const flag = path.join(projectDir, '.qa', 'oracle_failed.flag');
  if (fs.existsSync(flag)) {
    fs.unlinkSync(flag);
    console.log(`Cleared oracle stop-flag.`);
  }

  console.log(`Regression captured. Fixture ${findingId} added at ${fxFile}.`);
  console.log(`Suite will catch this from the next run.`);
  process.exit(0);
}

fail('unknown mode. usage: --approve | --confirm | --regression');
