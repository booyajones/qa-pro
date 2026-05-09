// SEO baseline check (Module 2)
// Skipped on localhost.
// Exports: async function run(page, ctx, cfg) → findings[]

async function run(page, ctx, cfg) {
  const findings = [];
  const url = page.url();
  const u = new URL(url);

  if (/localhost|127\.0\.0\.1|\.local$/.test(u.hostname)) {
    return findings; // skip on local
  }

  // Title
  const title = await page.title();
  if (!title || !title.trim()) {
    findings.push({ severity: 2, layer: 'seo', page: u.pathname, finding: '<title> missing or empty', url });
  } else if (title.length < 10) {
    findings.push({ severity: 3, layer: 'seo', page: u.pathname, finding: `<title> too short (${title.length} chars; recommend 10-65)`, detail: { title }, url });
  } else if (title.length > 65) {
    findings.push({ severity: 3, layer: 'seo', page: u.pathname, finding: `<title> too long (${title.length} chars; recommend 10-65)`, detail: { title }, url });
  }

  // Meta description
  const desc = await page.locator('meta[name="description"]').first().getAttribute('content').catch(() => null);
  if (!desc) {
    findings.push({ severity: 3, layer: 'seo', page: u.pathname, finding: 'meta description missing', url });
  } else if (desc.length < 50) {
    findings.push({ severity: 4, layer: 'seo', page: u.pathname, finding: `meta description short (${desc.length} chars; 50-160 ideal)`, url });
  } else if (desc.length > 160) {
    findings.push({ severity: 4, layer: 'seo', page: u.pathname, finding: `meta description long (${desc.length} chars)`, url });
  }

  // Canonical
  const canonical = await page.locator('link[rel="canonical"]').first().getAttribute('href').catch(() => null);
  if (!canonical) {
    findings.push({ severity: 3, layer: 'seo', page: u.pathname, finding: 'canonical link missing', url });
  } else if (!/^https?:\/\//.test(canonical)) {
    findings.push({ severity: 3, layer: 'seo', page: u.pathname, finding: `canonical not absolute: ${canonical.slice(0, 80)}`, url });
  }

  // OpenGraph
  for (const og of ['og:title', 'og:description', 'og:image']) {
    const v = await page.locator(`meta[property="${og}"]`).first().getAttribute('content').catch(() => null);
    if (!v) findings.push({ severity: 3, layer: 'seo', page: u.pathname, finding: `${og} missing`, url });
  }

  // html lang
  const lang = await page.locator('html').first().getAttribute('lang').catch(() => null);
  if (!lang) {
    findings.push({ severity: 3, layer: 'seo', page: u.pathname, finding: '<html lang> missing', url });
  }

  // JSON-LD parse-validity (only check that any present <script type="application/ld+json"> parses)
  const ldBlocks = await page.locator('script[type="application/ld+json"]').allTextContents().catch(() => []);
  for (const [idx, block] of ldBlocks.entries()) {
    try { JSON.parse(block); }
    catch (e) { findings.push({ severity: 2, layer: 'seo', page: u.pathname, finding: `JSON-LD block ${idx + 1} is invalid JSON`, detail: { error: e.message.slice(0, 100) }, url }); }
  }

  return findings;
}

// Once-per-run check: sitemap.xml and robots.txt
async function runOnce(ctx, cfg) {
  const findings = [];
  const base = new URL(cfg.test_url);
  if (/localhost|127\.0\.0\.1|\.local$/.test(base.hostname)) return findings;

  for (const fname of ['sitemap.xml', 'robots.txt']) {
    const fUrl = new URL(`/${fname}`, base).toString();
    try {
      const r = await ctx.request.get(fUrl, { timeout: 8000 });
      if (r.status() >= 400) {
        const sev = fname === 'robots.txt' ? 3 : 3;
        findings.push({ severity: sev, layer: 'seo', page: '/', finding: `${fname} returned ${r.status()}`, url: fUrl });
      }
    } catch (e) {
      findings.push({ severity: 3, layer: 'seo', page: '/', finding: `${fname} fetch error`, detail: { error: e.message.slice(0, 100) }, url: fUrl });
    }
  }
  return findings;
}

module.exports = { run, runOnce };
