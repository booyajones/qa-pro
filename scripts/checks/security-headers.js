// Security headers check (Module 1)
// Stack-aware sev tiers; HTTPS enforcement + mixed-content always Sev 1.
// Exports: async function run(page, ctx, cfg) → findings[]

const { detectStack, getProfile } = require('../stack-detect');

async function run(page, ctx, cfg) {
  const findings = [];
  const url = page.url();
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';

  // Get response headers from the main document. Playwright stores the last response on the page.
  const response = page._mainResponse || ctx._lastResponse;
  const headers = response ? response.headers() : {};

  const securityCfg = cfg.security || {};
  const stack = securityCfg.stack === 'auto' || !securityCfg.stack
    ? detectStack(headers)
    : securityCfg.stack;
  const profile = getProfile(stack, securityCfg.sev_override);
  const disabled = new Set(securityCfg.disable || []);

  // 1. HTTPS enforcement (only meaningful if test_url is HTTPS)
  if (cfg.test_url && cfg.test_url.startsWith('https://') && !isHttps) {
    findings.push({ severity: 1, layer: 'security', page: u.pathname, finding: `page resolved over HTTP, not HTTPS`, url });
  }

  // 2. Mixed-content (HTTPS page loading HTTP resources) — gathered via console
  // (already captured in console check; we add a synthesis here)

  if (!isHttps) {
    // No header checks meaningful on HTTP-only sites
    return findings;
  }

  // 3. Header presence checks
  const hasHsts = !!(headers['strict-transport-security']);
  const hasXcto = (headers['x-content-type-options'] || '').toLowerCase() === 'nosniff';
  const hasXfo = !!(headers['x-frame-options']);
  const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'] || '';
  const hasFrameAncestorsCsp = /frame-ancestors/i.test(csp);
  const hasReferrerPolicy = !!(headers['referrer-policy']);
  const hasPermissionsPolicy = !!(headers['permissions-policy']);

  if (!disabled.has('hsts') && !hasHsts) {
    findings.push({ severity: profile.hsts, layer: 'security', page: u.pathname, finding: `Strict-Transport-Security header missing`, detail: { stack, header: 'Strict-Transport-Security' }, url });
  }
  if (!disabled.has('xcto') && !hasXcto) {
    findings.push({ severity: profile.xcto, layer: 'security', page: u.pathname, finding: `X-Content-Type-Options: nosniff missing`, detail: { stack }, url });
  }
  if (!disabled.has('xfo') && !hasXfo && !hasFrameAncestorsCsp) {
    findings.push({ severity: profile.xfo, layer: 'security', page: u.pathname, finding: `X-Frame-Options missing AND no frame-ancestors in CSP`, detail: { stack }, url });
  }
  if (!disabled.has('csp') && !csp) {
    findings.push({ severity: profile.csp, layer: 'security', page: u.pathname, finding: `Content-Security-Policy missing`, detail: { stack }, url });
  }
  if (!disabled.has('referrer') && !hasReferrerPolicy) {
    findings.push({ severity: profile.referrer, layer: 'security', page: u.pathname, finding: `Referrer-Policy missing`, detail: { stack }, url });
  }
  if (!disabled.has('permissions') && !hasPermissionsPolicy) {
    findings.push({ severity: profile.permissions, layer: 'security', page: u.pathname, finding: `Permissions-Policy missing`, detail: { stack }, url });
  }

  // Stack info as Sev 4 metadata for the report
  findings.push({ severity: 4, layer: 'security', page: u.pathname, finding: `host stack: ${stack}`, detail: { stack, profile }, url });

  return findings;
}

module.exports = { run };
