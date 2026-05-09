// Image quality check (Module 3)
// alt missing → Sev 2; broken (4xx/5xx) → Sev 2; oversized → Sev 3.
// Exports: async function run(page, ctx, cfg) → findings[]

async function run(page, ctx, cfg) {
  const findings = [];
  const url = page.url();
  const u = new URL(url);
  const maxKb = (cfg.images && cfg.images.max_kb) || 500;
  const maxImagesPerPage = (cfg.images && cfg.images.max_per_page) || 30;

  // Gather <img> data
  const imgs = await page.$$eval('img', (els) => els.map(el => ({
    src: el.currentSrc || el.src,
    alt: el.getAttribute('alt'),
    width: el.naturalWidth || el.width,
    height: el.naturalHeight || el.height,
  })));

  // Dedupe + cap
  const seen = new Set();
  const unique = imgs.filter(i => {
    if (!i.src || !i.src.startsWith('http')) return false;
    if (seen.has(i.src)) return false;
    seen.add(i.src);
    return true;
  }).slice(0, maxImagesPerPage);

  let altMissing = 0;
  for (const img of unique) {
    if (img.alt === null || img.alt === undefined) altMissing++;
  }
  if (altMissing > 0) {
    findings.push({ severity: 2, layer: 'a11y', page: u.pathname, finding: `${altMissing} <img> without alt attribute`, detail: { count: altMissing, max_checked: unique.length }, url });
  }

  // HEAD/GET to check status + size (sequential to avoid CDN rate-limit, capped)
  for (const img of unique) {
    try {
      const r = await ctx.request.get(img.src, { timeout: 8000, maxRedirects: 5 });
      const s = r.status();
      if (s >= 400) {
        findings.push({ severity: 2, layer: 'images', page: u.pathname, finding: `broken image: ${img.src} (${s})`, url });
        continue;
      }
      const cl = r.headers()['content-length'];
      if (cl) {
        const kb = parseInt(cl, 10) / 1024;
        if (kb > maxKb) {
          findings.push({ severity: 3, layer: 'images', page: u.pathname, finding: `oversized image: ${(kb / 1024).toFixed(1)}MB ${img.src.split('/').pop()}`, detail: { kb: Math.round(kb), max_kb: maxKb }, url });
        }
      }
    } catch { /* swallow transient image failures */ }
  }

  return findings;
}

module.exports = { run };
