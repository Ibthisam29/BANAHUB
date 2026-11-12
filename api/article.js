// /insights/:slug — server-rendered article so search engines and AI crawlers (which don't run JS) can read it.
const L = require('./_lib');

module.exports = async (req, res) => {
  const key = String(req.query.slug || '').slice(0, 200);
  try {
    const col = /^[0-9a-f-]{36}$/i.test(key) ? 'id' : 'slug';
    const rows = key ? await L.sb(`articles?select=*&published=eq.true&${col}=eq.${encodeURIComponent(key)}&limit=1`) : [];
    const a = rows[0] && (!rows[0].status || rows[0].status === 'published') ? rows[0] : null;
    let html = await L.template(req, 'insights.html');
    if (!a) {
      res.statusCode = 404;
      html = L.setHead(html, { title: 'Article not found | BANAHUB', description: 'This article is not available.', url: `${L.SITE}/insights` }).replace(/<meta name="robots"[^>]*>/g, '').replace('<head>', '<head>\n<meta name="robots" content="noindex"/>');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }
    const url = L.artUrl(a), text = L.strip(a.body), desc = L.clip(a.meta_description || text, 158);
    const date = a.publish_date || a.created_at, mod = a.updated_at || date;
    const fmt = (d) => new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' });
    const O = await L.org();
    const ld = L.jsonld({
      '@context': 'https://schema.org', '@type': 'Article', headline: L.clip(a.title, 110), description: desc, url, mainEntityOfPage: url,
      datePublished: date, dateModified: mod, articleSection: a.category || 'Insights', keywords: (a.tags || []).join(', ') || undefined,
      wordCount: text.split(' ').length, inLanguage: 'en-SG', image: `${L.SITE}/og-image.png`,
      author: a.author_name ? { '@type': 'Person', name: a.author_name } : O, publisher: O,
    }) + L.jsonld(L.crumbs([['Home', L.SITE + '/'], ['Insights', L.SITE + '/insights'], [a.title, url]]));
    html = L.setHead(html, { title: `${a.title} | BANAHUB Insights`, description: desc, url, type: 'article',
      extra: `<meta property="article:published_time" content="${L.esc(date)}"/><meta property="article:modified_time" content="${L.esc(mod)}"/>\n${ld}\n` });
    const body = `<article class="bh-article"><a class="bh-link" href="/insights" style="margin-bottom:22px"><span class="material-symbols-outlined" aria-hidden="true" style="transform:rotate(180deg)">arrow_forward</span> All insights</a>` +
      `<span class="bh-eyebrow" style="display:flex">${L.esc(a.category || 'Insight')}</span><h1 class="bh-h1">${L.esc(a.title)}</h1>` +
      `<p class="bh-small">${[fmt(date), a.author_name].filter(Boolean).map(L.esc).join(' · ')}</p><div class="body">${L.safeBody(a.body)}</div></article>`;
    html = html.replace('<div id="article-view" hidden></div>', `<div id="article-view" data-ssr="1">${body}</div>`)
      .replace('<div id="feed-view">', '<div id="feed-view" hidden>')
      .replace(/<h1 class="bh-h1"([^>]*)>Perspectives and sessions on cross-border growth<\/h1>/, '<p class="bh-h1"$1>Perspectives and sessions on cross-border growth</p>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.end(html);
  } catch (e) {
    res.statusCode = 302; res.setHeader('Location', `/insights?article=${encodeURIComponent(key)}`); res.end();
  }
};
