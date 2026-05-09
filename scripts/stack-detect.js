// Stack auto-detection by response-header fingerprinting
// Used by security-headers and SEO checks to pick a sev profile.

function detectStack(headers) {
  if (!headers) return 'generic';
  const get = (k) => {
    if (typeof headers.get === 'function') return headers.get(k);
    if (typeof headers === 'object') return headers[k.toLowerCase()] || headers[k];
    return null;
  };
  const server = (get('server') || '').toLowerCase();
  if (get('x-vercel-id')) return 'vercel';
  if (get('cf-ray') || /cloudflare/i.test(server)) return 'cloudflare';
  if (/webflow/i.test(server)) return 'webflow';
  if (get('x-powered-by') && /next\.?js/i.test(get('x-powered-by'))) return 'nextjs';
  if (/netlify/i.test(server)) return 'netlify';
  return 'generic';
}

// Sev profile per stack: rule_id → severity for that stack
// Sev 1 always = mixed-content / HTTPS enforcement (universal)
// Sev 2 universal = X-Frame-Options or frame-ancestors
const STACK_PROFILES = {
  generic: { hsts: 2, xcto: 2, xfo: 2, csp: 3, referrer: 3, permissions: 4 },
  vercel: { hsts: 3, xcto: 3, xfo: 2, csp: 3, referrer: 3, permissions: 4 },
  cloudflare: { hsts: 3, xcto: 3, xfo: 2, csp: 3, referrer: 3, permissions: 4 },
  webflow: { hsts: 3, xcto: 3, xfo: 2, csp: 3, referrer: 3, permissions: 4 },
  nextjs: { hsts: 2, xcto: 2, xfo: 2, csp: 3, referrer: 3, permissions: 4 },
  netlify: { hsts: 3, xcto: 3, xfo: 2, csp: 3, referrer: 3, permissions: 4 },
};

function getProfile(stack, override) {
  const base = STACK_PROFILES[stack] || STACK_PROFILES.generic;
  return { ...base, ...(override || {}) };
}

module.exports = { detectStack, getProfile, STACK_PROFILES };
