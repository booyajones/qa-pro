#!/usr/bin/env node
// Oracle classification — verify suite still catches known-broken fixtures
// Usage: node oracle-runner.js <project-dir> <findings-json-path>
//
// Reads .qa/fixtures/broken/*.json (each describes a previously-captured Sev 1+2 finding).
// For each broken fixture, checks whether the current run's findings contain a matching one.
// If a known-broken fixture is NOT matched in current findings, it's "oracle drift":
// either the bug was fixed (good - retire via /qa:learn --confirm) OR the suite went blind (bad).
//
// Writes .qa/oracle_failed.flag if any oracle-critical fixture is unmatched AND >0 broken fixtures exist.
// Returns findings array describing oracle state per fixture.

const fs = require('fs');
const path = require('path');

const projectDir = process.argv[2];
const findingsPath = process.argv[3];
if (!projectDir || !findingsPath) { console.error('usage: oracle-runner.js <project-dir> <findings-json>'); process.exit(1); }
if (!fs.existsSync(findingsPath)) { console.error(`findings json not found: ${findingsPath}`); process.exit(1); }

const findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
const currentFindings = findings.findings || [];

const brokenDir = path.join(projectDir, '.qa', 'fixtures', 'broken');
const goodDir = path.join(projectDir, '.qa', 'fixtures', 'good');

const oracleFindings = [];
let unmatchedCriticalCount = 0;

// Helper: does the current findings list contain a finding matching this fixture's signature?
function fingerprintMatch(fixture, currentList) {
  const fxFinding = fixture.finding || {};
  return currentList.some(c => {
    if (fixture.fingerprint && c.fingerprint === fixture.fingerprint) return true;
    // Match on layer + page + severity + finding-text-prefix
    if ((c.severity === fxFinding.severity) &&
        (c.layer === fxFinding.layer) &&
        ((c.page || '') === (fxFinding.page || ''))) {
      const fxText = String(fxFinding.finding || '').slice(0, 60);
      const cText = String(c.finding || '').slice(0, 60);
      // Allow loose match on finding text (handles minor wording shifts in axe descriptions)
      if (fxText && cText && (cText.includes(fxText.slice(0, 30)) || fxText.includes(cText.slice(0, 30)))) return true;
    }
    return false;
  });
}

// Process broken fixtures
if (fs.existsSync(brokenDir)) {
  const fixtureFiles = fs.readdirSync(brokenDir).filter(f => f.endsWith('.json'));
  for (const fxName of fixtureFiles) {
    let fx;
    try { fx = JSON.parse(fs.readFileSync(path.join(brokenDir, fxName), 'utf8')); }
    catch (e) { oracleFindings.push({ severity: 3, layer: 'oracle', finding: `unparseable fixture: ${fxName}`, detail: { error: e.message } }); continue; }

    // Sanity: refuse fixtures with claude_inspection provenance
    if (fx.source_type === 'claude_inspection' || fx.claude_inspection_allowed === true) {
      oracleFindings.push({ severity: 2, layer: 'oracle', finding: `fixture ${fxName} has invalid provenance (claude_inspection)`, detail: { fixture: fxName } });
      continue;
    }

    const matched = fingerprintMatch(fx, currentFindings);
    const sev = (fx.finding && (fx.finding.severity === 1 || fx.finding.severity === 2)) ? fx.finding.severity : 3;

    if (matched) {
      // Suite still catches it. Good. Sev 4 informational.
      oracleFindings.push({
        severity: 4,
        layer: 'oracle',
        finding: `oracle hit: ${fx.fingerprint || fxName} still detected (Sev ${sev})`,
        detail: { fixture: fxName, source_type: fx.source_type, source_ref: fx.source_ref },
      });
    } else {
      // Suite did NOT catch a known-broken fixture. Oracle drift.
      // If fixture was originally Sev 1+2, this is critical drift.
      const isCritical = sev <= 2;
      if (isCritical) unmatchedCriticalCount++;
      oracleFindings.push({
        severity: isCritical ? 1 : 3,
        layer: 'oracle',
        finding: `oracle drift: known-broken fixture ${fx.fingerprint || fxName} was NOT detected this run`,
        detail: {
          fixture: fxName,
          original_severity: sev,
          source_type: fx.source_type,
          source_ref: fx.source_ref,
          captured_at: fx.captured_at,
          remediation: 'either the underlying bug was fixed (run /qa:learn --confirm to retire fixture), or the suite has stopped detecting it (investigate suite drift).',
        },
      });
    }
  }
}

// Process good fixtures: any current finding on a known-good page is suspect
if (fs.existsSync(goodDir)) {
  const slugDirs = fs.readdirSync(goodDir).filter(d => fs.statSync(path.join(goodDir, d)).isDirectory());
  for (const slug of slugDirs) {
    // Find any meta.json (per-viewport or top-level)
    const viewportDirs = fs.readdirSync(path.join(goodDir, slug)).filter(d => {
      try { return fs.statSync(path.join(goodDir, slug, d)).isDirectory(); } catch { return false; }
    });
    for (const vp of viewportDirs) {
      const metaPath = path.join(goodDir, slug, vp, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      let meta;
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { continue; }
      if (meta.source_type === 'claude_inspection') {
        oracleFindings.push({ severity: 2, layer: 'oracle', finding: `good fixture ${slug}/${vp} has invalid provenance (claude_inspection)` });
        continue;
      }
      // Check if any Sev 1+2 finding fired on this page
      const pageStr = meta.page || `/${slug === 'home' ? '' : slug}`;
      const sev12OnGoodPage = currentFindings.filter(c =>
        (c.severity === 1 || c.severity === 2) &&
        (c.page === pageStr) &&
        c.layer !== 'oracle'
      );
      if (sev12OnGoodPage.length > 0) {
        unmatchedCriticalCount++;
        oracleFindings.push({
          severity: 1,
          layer: 'oracle',
          finding: `oracle conflict: known-good page ${pageStr} produced ${sev12OnGoodPage.length} Sev 1+2 finding(s)`,
          detail: {
            fixture: `${slug}/${vp}`,
            page: pageStr,
            findings: sev12OnGoodPage.map(c => ({ severity: c.severity, layer: c.layer, finding: c.finding })),
            remediation: 'either the page broke (real bug) or the good fixture is stale. Inspect and either fix the page, or run /qa:learn --confirm <fixture-id> to rotate the good fixture.',
          },
        });
      }
    }
  }
}

// If any critical oracle drift, write stop-flag
if (unmatchedCriticalCount > 0) {
  const flag = path.join(projectDir, '.qa', 'oracle_failed.flag');
  fs.mkdirSync(path.dirname(flag), { recursive: true });
  fs.writeFileSync(flag, JSON.stringify({
    timestamp: new Date().toISOString(),
    critical_drift_count: unmatchedCriticalCount,
    note: 'Oracle drift detected. Suite will refuse to run until /qa:learn --regression OR --confirm clears this.',
  }, null, 2));
}

console.log(JSON.stringify({
  layer: 'oracle',
  unmatched_critical: unmatchedCriticalCount,
  total_fixtures_checked: oracleFindings.length,
  findings: oracleFindings,
}, null, 2));
process.exit(0);
