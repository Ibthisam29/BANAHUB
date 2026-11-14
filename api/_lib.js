// Shared helpers for BANAHUB SEO functions (Vercel Node runtime). Public, read-only data only.
const SB_URL = process.env.SUPABASE_URL || 'https://mfqdqisbryoepdpqebkb.supabase.co';
// Publishable (anon) key — public by design, same one the website uses. RLS limits it to published content.
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_GfOFDZkHqJKEuKTIS_iU_A_9ttmG7HS';
const SITE = 'https://www.banahub.com';
const INDEXNOW_KEY = '5bb8a884a0a27c839c0bf4572bf2f6b5';

// Public, indexable pages (keep in sync with robots.txt / llms.txt)
const PAGES = [
  ['/', 1.0, 'weekly'], ['/market-entry', 0.9, 'monthly'], ['/capital-access', 0.9, 'monthly'], ['/investors', 0.9, 'monthly'],
  ['/capital-review', 0.9, 'monthly'], ['/readiness', 0.9, 'monthly'], ['/growth-plan', 0.9, 'monthly'], ['/investor-network', 0.8, 'monthly'],
  ['/partnerships', 0.8, 'monthly'], ['/membership', 0.8, 'monthly'], ['/insights', 0.8, 'weekly'], ['/events', 0.8, 'weekly'],
  ['/programs', 0.7, 'weekly'], ['/capital-growth-exchange', 0.7, 'weekly'], ['/about', 0.7, 'monthly'], ['/contact', 0.6, 'monthly'],
  ['/register', 0.5, 'monthly'], ['/disclosures', 0.3, 'yearly'], ['/privacy', 0.3, 'yearly'], ['/terms', 0.3, 'yearly'],
];

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const jsonld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

// Admin-authored article HTML → safe subset for server rendering
function safeBody(html) {
  html = String(html || '');
  if (!/<[a-z][\s\S]*>/i.test(html)) return html.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`).join('');
  return html
    .replace(/<(script|style|iframe|object|embed|form|input|button|link|meta|svg|math)[\s\S]*?(<\/\1>|\/?>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(style|class|id)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi, '$1="#"');
}
async function template(req, file) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const r = await fetch(`${proto}://${req.headers.host}/${file}`, { redirect: 'follow' });
  if (!r.ok) throw new Error('template ' + r.status);
  return r.text();
}
// Replace <title>, description, canonical, OG/Twitter in a static page's <head>
function setHead(html, { title, description, url, image, type = 'website', extra = '' }) {
  const d = esc(description), t = esc(title), img = image || `${SITE}/og-image.png`;
  html = html.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->\n?/, '').replace(/<meta\s+name="robots"[^>]*>/gi, '');
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${t}</title>`);
  html = html.replace(/<meta\s+name="description"[\s\S]*?\/?>/i, '');
  html = html.replace(/<link\s+rel="canonical"[^>]*>/gi, '').replace(/<meta\s+(property|name)="(og|twitter):[^"]+"[^>]*>/gi, '');
  const head = `<meta name="description" content="${d}"/>\n<link rel="canonical" href="${url}"/>\n<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1"/>\n` +
    `<meta property="og:type" content="${type}"/><meta property="og:site_name" content="BANAHUB"/><meta property="og:title" content="${t}"/><meta property="og:description" content="${d}"/><meta property="og:url" content="${url}"/><meta property="og:image" content="${esc(img)}"/>\n` +
    `<meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${t}"/><meta name="twitter:description" content="${d}"/><meta name="twitter:image" content="${esc(img)}"/>\n${extra}`;
  if (!/<base\s/i.test(html)) html = html.replace(/<head>/i, '<head>\n<base href="/"/>');
  return html.replace(/<\/head>/i, head + '</head>');
}
const ORG = { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'BANAHUB', legalName: 'Bana Private Limited', url: SITE + '/', logo: `${SITE}/logo-icon-512.png` };
// Organization node with official profiles (sameAs) from Admin OS → SEO & GEO → Brand entity
let _org = null, _orgAt = 0;
async function org() {
  if (_org && Date.now() - _orgAt < 300000) return _org;
  let same = [];
  try { const r = await sb('site_settings?select=value&key=eq.seo&limit=1'); same = Object.values(((r[0] || {}).value || {}).same_as || {}).filter((u) => /^https:\/\//.test(u)); } catch (_) {}
  _org = same.length ? { ...ORG, sameAs: same } : ORG; _orgAt = Date.now();
  return _org;
}
const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) });

async function published() {
  const [articles, events, programs] = await Promise.all([
    sb('articles?select=id,title,slug,meta_description,body,category,tags,author_name,publish_date,created_at,updated_at&published=eq.true&order=publish_date.desc.nullslast&limit=500').catch(() => []),
    sb('events?select=id,title,slug,type,format,event_date,end_date,location,description,cover_image,registration_url,luma_url,price_amount,currency,invite_only,created_at&published=eq.true&order=event_date.desc&limit=500').catch(() => []),
    sb('programs?select=id,title,type,status,start_date,end_date,region,description&published=eq.true&order=start_date.desc.nullslast&limit=200').catch(() => []),
  ]);
  return { articles: articles.filter((a) => a.slug || a.id), events: events.filter((e) => e.slug || e.id), programs };
}
const artUrl = (a) => `${SITE}/insights/${encodeURIComponent(a.slug || a.id)}`;
const evUrl = (e) => `${SITE}/events/${encodeURIComponent(e.slug || e.id)}`;

module.exports = { org, SB_URL, SB_KEY, SITE, INDEXNOW_KEY, PAGES, sb, esc, strip, clip, jsonld, safeBody, template, setHead, ORG, crumbs, published, artUrl, evUrl };
