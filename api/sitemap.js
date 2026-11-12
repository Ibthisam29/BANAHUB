// /sitemap.xml — static pages + every published article and event, with lastmod.
const L = require('./_lib');

module.exports = async (req, res) => {
  let d = { articles: [], events: [] };
  try { d = await L.published(); } catch (_) {}
  const today = new Date().toISOString().slice(0, 10), day = (x) => (x ? new Date(x).toISOString().slice(0, 10) : today);
  const u = (loc, pr, cf, lm) => `  <url><loc>${L.esc(loc)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}<changefreq>${cf}</changefreq><priority>${pr.toFixed(1)}</priority></url>`;
  const latest = (arr, f) => arr.reduce((m, x) => (f(x) && f(x) > m ? f(x) : m), '');
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...L.PAGES.map(([p, pr, cf]) => u(L.SITE + p, pr, cf, p === '/insights' ? day(latest(d.articles, (a) => a.updated_at || a.publish_date)) || today : p === '/events' ? day(latest(d.events, (e) => e.created_at)) : undefined)),
    ...d.articles.map((a) => u(L.artUrl(a), 0.7, 'monthly', day(a.updated_at || a.publish_date || a.created_at))),
    ...d.events.map((e) => u(L.evUrl(e), e.event_date && new Date(e.event_date) > new Date() ? 0.7 : 0.4, 'weekly', day(e.created_at))),
    '</urlset>'].join('\n');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
  res.end(xml);
};
