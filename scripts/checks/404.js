// 404 page check (Module 7) — redirect-aware
// Once per run. Hits a random non-existent path. Auth-walled redirects skipped.
// Exports: async function runOnce(ctx, cfg) → findings[]

const crypto = require('crypto');

async function runOnce(ctx, cfg) {
  const findings = [];
  const base = new URL(cfg.test_url);
  if (/localhost|127\.0\.0\.1/.test(base.hostname)) return findings;

  const random = crypto.randomBytes(16).toString('hex');
  const probeUrl = new URL(`/__qa_pro_404_${random}`, base).toString();

  try {
    const r = await ctx.request.get(probeUrl, { timeout: 10000, maxRedirects: 5 });
    const finalUrl = r.url();
    const finalPath = new URL(finalUrl).pathname;
    const status = r.status();

    if (status === 404) {
      // Pass — proper 404. Sev 4 info only.
      findings.push({ severity: 4, layer: '404-check', page: '/', finding: `404 routing OK (terminal status 404)`, detail: { probe: probeUrl, terminal: finalUrl }, url: probeUrl });
      return findings;
    }

    // Auth-wall heuristic: redirect to login URL or login form on the page
    const isLoginPath = /\/(login|signin|sign-in|auth|sso)/i.test(finalPath);
    if (isLoginPath) {
      findings.push({ severity: 4, layer: '404-check', page: '/', finding: `404 probe redirected to auth gate (skipped)`, detail: { terminal: finalUrl, status }, url: probeUrl });
      return findings;
    }

    if (status === 200) {
      // Check for password input (login form heuristic)
      const body = await r.text();
      const hasPasswordInput = /<input[^>]+type=["']password["']/i.test(body);
      if (hasPasswordInput) {
        findings.push({ severity: 4, layer: '404-check', page: '/', finding: `404 probe served login form (skipped)`, detail: { terminal: finalUrl }, url: probeUrl });
        return findings;
      }
      // Real 200 with non-login content: routing footgun
      findings.push({
        severity: 2,
        layer: '404-check',
        page: '/',
        finding: `non-existent path returned 200 with content (broken routing)`,
        detail: { probe: probeUrl, terminal: finalUrl, status, body_length: body.length },
        url: probeUrl,
      });
      return findings;
    }

    // Other status (5xx, 410, etc)
    if (status >= 500) {
      findings.push({ severity: 1, layer: '404-check', page: '/', finding: `non-existent path returned ${status} (server error)`, detail: { probe: probeUrl, terminal: finalUrl }, url: probeUrl });
    } else if (status === 410) {
      findings.push({ severity: 4, layer: '404-check', page: '/', finding: `non-existent path returned 410 (gone) — acceptable`, url: probeUrl });
    } else {
      findings.push({ severity: 3, layer: '404-check', page: '/', finding: `non-existent path returned ${status} (unexpected)`, detail: { probe: probeUrl, terminal: finalUrl }, url: probeUrl });
    }
  } catch (e) {
    findings.push({ severity: 3, layer: '404-check', page: '/', finding: `404 probe failed: ${e.message.slice(0, 80)}`, url: probeUrl });
  }

  return findings;
}

module.exports = { runOnce };
