const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const root = path.resolve(__dirname, '..');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = http.createServer((req, res) => {
    if (req.url === '/source') { res.setHeader('Content-Type', 'application/json'); res.end('{"balance":100}'); return; }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/good' }); res.end(); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="en"><head><title>QA fixture</title></head><body><main><h1>Balance</h1><p id="balance">' +
      (req.url === '/wrong' ? '999' : '100') + '</p><button onclick="document.getElementById(\'count\').textContent=\'1\'">Count</button><p id="count">0</p></main></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { name: 'synthetic', project_type: 'custom', test_url: `http://127.0.0.1:${server.address().port}`,
    pages: ['/good'], viewports: ['desktop'], data_adapter: 'rest' };
  const configPath = path.join(dir, 'config.json');
  const write = () => fs.writeFileSync(configPath, JSON.stringify(config));
  write();
  return { dir, config, configPath, write };
}
async function run(script, args, timeout = 45000) {
  const r = await exec(process.execPath, [path.join(root, 'scripts', script), ...args], { timeout, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(r.stdout);
}

test('rendered KPI mismatch is caught, matching value passes, redirected page fails closed', async t => {
  const f = await fixture(t);
  f.config.kpis = [{ name: 'balance', page: '/wrong', selector: '#balance', endpoint: f.config.test_url + '/source', expected_path: '$.balance', tolerance: 0 }];
  f.write();
  const wrong = await run('data-runner.js', [f.dir, f.configPath]);
  assert.equal(wrong.findings[0].severity, 1);
  assert.equal(wrong.findings[0].detail.actual, 999);
  f.config.kpis[0].page = '/good'; f.write();
  const good = await run('data-runner.js', [f.dir, f.configPath]);
  assert.equal(good.findings[0].severity, 4);
  f.config.kpis[0].page = '/redirect'; f.write();
  assert.equal((await run('data-runner.js', [f.dir, f.configPath])).findings[0].severity, 1);
});

test('critical user flows actually click the page, and skipped or broken assertions block', async t => {
  const f = await fixture(t);
  const flowDir = path.join(f.dir, '.qa/flows/critical');
  fs.mkdirSync(flowDir, { recursive: true });
  const flow = path.join(flowDir, 'counter.spec.cjs');
  const imports = `const {test,expect}=require(${JSON.stringify(path.join(root, 'node_modules/playwright/test'))});\n`;
  fs.writeFileSync(flow, imports + "test('click updates count',async({page})=>{await page.goto('/good');await page.getByRole('button',{name:'Count'}).click();await expect(page.locator('#count')).toHaveText('1');});");
  assert.equal((await run('flows-runner.js', [f.dir, f.configPath])).findings[0].severity, 4);
  fs.writeFileSync(flow, imports + "test('wrong count blocks',async({page})=>{await page.goto('/good');await expect(page.locator('#count')).toHaveText('999',{timeout:100});});");
  assert.equal((await run('flows-runner.js', [f.dir, f.configPath])).findings[0].severity, 1);
  fs.writeFileSync(flow, imports + "test.skip('cannot silently skip',()=>{});");
  assert.equal((await run('flows-runner.js', [f.dir, f.configPath])).findings[0].severity, 1);
});

test('missing baseline cannot overwrite the immutable golden or claim human approval', async t => {
  const f = await fixture(t);
  const fixtureDir = path.join(f.dir, '.qa/fixtures/good/good/desktop');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const golden = path.join(fixtureDir, 'golden-at-creation.png');
  fs.writeFileSync(golden, 'immutable synthetic sentinel');
  const output = await run('visual-runner.js', [f.dir, f.configPath]);
  assert.ok(output.findings.some(f => f.severity === 1 && /approved baseline/.test(f.finding)));
  assert.equal(fs.readFileSync(golden, 'utf8'), 'immutable synthetic sentinel');
  assert.equal(fs.existsSync(path.join(fixtureDir, 'baseline.png')), false);
  assert.equal(fs.existsSync(path.join(fixtureDir, 'meta.json')), false);
});

test('an approved synthetic golden passes and a corrupted golden blocks without being rewritten', async t => {
  const f = await fixture(t);
  const fixtureDir = path.join(f.dir, '.qa/fixtures/good/good/desktop');
  await run('visual-runner.js', [f.dir, f.configPath]);
  const current = fs.readFileSync(path.join(fixtureDir, 'current.png'));
  for (const name of ['baseline.png', 'golden-at-creation.png']) fs.writeFileSync(path.join(fixtureDir, name), current);
  fs.writeFileSync(path.join(fixtureDir, 'meta.json'), JSON.stringify({ source_type: 'bug_ticket',
    source_ref: 'synthetic regression control; not a human baseline approval', page: '/good', claude_inspection_allowed: false }));
  assert.deepEqual((await run('visual-runner.js', [f.dir, f.configPath])).findings, []);
  const { PNG } = require(path.join(root, 'node_modules/pngjs'));
  const corrupt = PNG.sync.read(current); corrupt.data.fill(200);
  const bytes = PNG.sync.write(corrupt);
  const golden = path.join(fixtureDir, 'golden-at-creation.png');
  fs.writeFileSync(golden, bytes);
  assert.ok((await run('visual-runner.js', [f.dir, f.configPath])).findings.some(f => f.severity === 1 && /immutable golden/.test(f.finding)));
  assert.deepEqual(fs.readFileSync(golden), bytes);
});


test('smoke, visual and Lighthouse restore cookie plus localStorage auth and reject a login redirect', async t => {
  const f = await fixture(t);
  let signedInHits = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/private' && !/qa_session=synthetic/.test(req.headers.cookie || '')) {
      res.writeHead(302, { Location: '/login' }); res.end(); return;
    }
    if (req.url === '/signed-in') { signedInHits++; res.end('ok'); return; }
    res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed in fixture</title></head><body><main><h1>' +
      (req.url === '/private' ? 'Private dashboard' : 'Login') + '</h1></main>' +
      (req.url === '/private' ? '<script>if(localStorage.getItem("qa_token")!=="synthetic"){location.replace("/login")}else{fetch("/signed-in")}</script>' : '') + '</body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  f.config.test_url = `http://127.0.0.1:${server.address().port}`;
  f.config.pages = ['/private']; f.write();
  const anonymousSmoke = await run('smoke-runner.js', [f.configPath]);
  assert.ok(anonymousSmoke.findings.some(f => f.severity === 1 && /landed on .*login/.test(f.finding)));
  const anonymousVisual = await run('visual-runner.js', [f.dir, f.configPath]);
  assert.ok(anonymousVisual.findings.some(f => f.severity === 1 && /page was not tested/.test(f.finding)));
  const anonymousPerf = await run('lighthouse-runner.js', [f.config.test_url, JSON.stringify(f.config.pages)], 120000);
  assert.ok(anonymousPerf.findings.some(f => f.severity === 1 && /page was not tested/.test(f.finding)));
  const state = { cookies: [{ name: 'qa_session', value: 'synthetic', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
    origins: [{ origin: f.config.test_url, localStorage: [{ name: 'qa_token', value: 'synthetic' }] }] };
  f.config.storage_state = path.join(f.dir, 'synthetic-state.json');
  fs.writeFileSync(f.config.storage_state, JSON.stringify(state)); f.write();
  const smoke = await run('smoke-runner.js', [f.configPath]);
  assert.ok(!smoke.findings.some(f => /landed on|navigation failed/.test(f.finding)));
  assert.ok(signedInHits > 0);
  await run('visual-runner.js', [f.dir, f.configPath]);
  const fixtures = path.join(f.dir, '.qa/fixtures/good/private/desktop');
  const current = fs.readFileSync(path.join(fixtures, 'current.png'));
  for (const name of ['baseline.png', 'golden-at-creation.png']) fs.writeFileSync(path.join(fixtures, name), current);
  fs.writeFileSync(path.join(fixtures, 'meta.json'), JSON.stringify({ source_type: 'bug_ticket', source_ref: 'temporary synthetic auth regression control' }));
  assert.deepEqual((await run('visual-runner.js', [f.dir, f.configPath])).findings, []);
  const before = signedInHits;
  const perf = await run('lighthouse-runner.js', [f.config.test_url, JSON.stringify(f.config.pages), f.configPath], 120000);
  assert.ok(!perf.findings.some(f => f.severity === 1), JSON.stringify(perf));
  assert.ok(signedInHits > before, 'actual Lighthouse navigation reached the cookie and localStorage protected page');
});
