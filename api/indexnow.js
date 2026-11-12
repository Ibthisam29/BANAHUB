// POST /api/indexnow  (Admin OS only) — tells Bing, Yandex, Seznam, Naver (and via Bing: ChatGPT search, Copilot, DuckDuckGo) to recrawl URLs now.
const L = require('./_lib');

module.exports = async (req, res) => {
  const out = (s, b) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); };
  if (req.method !== 'POST') return out(405, { error: 'POST only' });
  try {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!tok) return out(401, { error: 'Sign in to Admin OS' });
    const ur = await fetch(`${L.SB_URL}/auth/v1/user`, { headers: { apikey: L.SB_KEY, Authorization: `Bearer ${tok}` } });
    const user = ur.ok ? await ur.json() : null;
    if (!user?.id) return out(401, { error: 'Session expired' });
    const pr = await fetch(`${L.SB_URL}/rest/v1/users?select=role&id=eq.${user.id}`, { headers: { apikey: L.SB_KEY, Authorization: `Bearer ${tok}` } });
    const row = pr.ok ? (await pr.json())[0] : null;
    if (row?.role !== 'admin') return out(403, { error: 'Admins only' });

    let body = req.body; if (typeof body === 'string') body = JSON.parse(body || '{}'); body = body || {};
    let urls = Array.isArray(body.urls) ? body.urls : [];
    if (body.all || !urls.length) {
      const d = await L.published().catch(() => ({ articles: [], events: [] }));
      urls = [...L.PAGES.map(([p]) => L.SITE + p), ...d.articles.map(L.artUrl), ...d.events.map(L.evUrl), L.SITE + '/llms.txt', L.SITE + '/llms-full.txt'];
    }
    urls = [...new Set(urls.filter((u) => typeof u === 'string' && u.startsWith(L.SITE)))].slice(0, 10000);
    if (!urls.length) return out(400, { error: 'No banahub.com URLs' });
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'www.banahub.com', key: L.INDEXNOW_KEY, keyLocation: `${L.SITE}/${L.INDEXNOW_KEY}.txt`, urlList: urls }),
    });
    const msg = { 200: 'Accepted', 202: 'Accepted — key being verified', 400: 'Bad request', 403: 'Key not valid', 422: 'URLs not on this host', 429: 'Too many requests — try later' }[r.status] || `Status ${r.status}`;
    return out(r.status < 300 ? 200 : 502, { ok: r.status < 300, status: r.status, message: msg, submitted: urls.length, urls });
  } catch (e) {
    return out(500, { error: 'IndexNow failed — ' + String(e.message || e).slice(0, 160) });
  }
};
