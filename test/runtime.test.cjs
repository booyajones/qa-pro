const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-pro-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.qa/fixtures/broken'), { recursive: true });
  return dir;
}

test('a required phase crash blocks the full gate instead of becoming a backlog item', t => {
  const dir = project(t);
  fs.writeFileSync(path.join(dir, '.qa/config.yml'), 'name: test\nproject_type: static-site\ntest_url: http://127.0.0.1:1\n');
  const preload = path.join(dir, 'fail-smoke.cjs');
  fs.writeFileSync(preload, `const cp=require('node:child_process');const original=cp.spawnSync;cp.spawnSync=(cmd,args,opts)=>{
    const name=require('node:path').basename(args[0]);
    if(name==='smoke-runner.js')return {status:1,stdout:'',stderr:'synthetic browser failure'};
    if(['visual-runner.js','lighthouse-runner.js','oracle-runner.js','flows-runner.js','data-runner.js'].includes(name))return {status:0,stdout:'{"findings":[]}',stderr:''};
    return original(cmd,args,opts);
  };`);
  const r = spawnSync(process.execPath, ['--require', preload, path.join(root, 'scripts/full-runner.js'), dir, '--gate'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 2, r.stderr);
  const findings = JSON.parse(fs.readFileSync(path.join(dir, '.qa/last-findings.json'))).findings;
  assert.ok(findings.some(f => f.severity === 1 && /synthetic browser failure/.test(f.finding)));
  const error = findings.find(f => f.layer === 'tooling');
  const fingerprint = `${error.severity}-${error.layer}-${error.page || ''}-${error.finding.slice(0,40).replace(/[^a-z0-9]/gi,'-').toLowerCase()}`;
  fs.writeFileSync(path.join(dir, '.qa/accepted.json'), JSON.stringify([{ fingerprint, source_type: 'human_authored', source_ref: 'synthetic test' }]));
  const blocked = spawnSync(process.execPath, [path.join(root, 'scripts/gate.js'), path.join(dir, '.qa/last-findings.json'), dir], { encoding: 'utf8' });
  assert.equal(blocked.status, 2, 'a stale acceptance cannot waive a missing required check');
});

test('an unreadable oracle fixture blocks instead of silently removing a control', t => {
  const dir = project(t);
  fs.writeFileSync(path.join(dir, '.qa/fixtures/broken/control.json'), '{broken');
  const input = path.join(dir, 'findings.json');
  fs.writeFileSync(input, '{"findings":[]}');
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/oracle-runner.js'), dir, input], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.some(f => f.severity === 1 && /unparseable fixture/.test(f.finding)));
  assert.ok(fs.existsSync(path.join(dir, '.qa/oracle_failed.flag')));
});

test('the generated gate invokes every configured layer and uploads findings', t => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, '.github'));
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/install-gate.js'), dir, '--ref', 'a'.repeat(40)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const workflow = fs.readFileSync(path.join(dir, '.github/workflows/qa-gate.yml'), 'utf8');
  assert.match(workflow, /full-runner\.js.*--gate/);
  assert.match(workflow, /last-findings\.json/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, new RegExp('a'.repeat(40)));
  assert.match(workflow, /chromium firefox webkit/);
});

test('both report JSON and uploaded findings are redacted and the coverage table makes no unrun claim', t => {
  const dir = project(t);
  const input = path.join(dir, '.qa/last-findings.json');
  fs.writeFileSync(input, JSON.stringify({ project: '<script>unsafe</script>', test_url: 'https://example.invalid',
    coverage: { smoke_chromium: 'completed', data: 'not configured' },
    findings: [{ severity: 1, layer: 'data', finding: 'Synthetic recipient user@example.invalid', url: 'javascript:alert(1)' }] }));
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/build-report.js'), input, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const output = JSON.parse(r.stdout);
  const html = fs.readFileSync(output.report, 'utf8');
  assert.doesNotMatch(html, /<script>unsafe/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /visual: <strong>not run/);
  for (const file of [input, path.join(path.dirname(output.report), 'findings.json')]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /user@example/);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
  }
});

test('missing Lighthouse category evidence blocks rather than reporting a clean performance phase', t => {
  const dir = project(t);
  const preload = path.join(dir, 'empty-lighthouse.cjs');
  fs.writeFileSync(preload, `require('node:child_process').spawnSync=()=>({status:0,stdout:'{"categories":{}}',stderr:''});`);
  const r = spawnSync(process.execPath, ['--require', preload, path.join(root, 'scripts/lighthouse-runner.js'), 'http://127.0.0.1:1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).findings[0].severity, 1);
});
