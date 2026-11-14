/* BANAHUB Admin OS — SEO & GEO (generative engine optimisation).
 * Live audit of public pages, AI-crawler access, llms.txt / sitemap health, IndexNow instant indexing,
 * AI visibility tracker (ChatGPT, Claude, Perplexity, Gemini, Copilot, Google), entity profiles (sameAs),
 * GEO content plan and an off-site authority checklist. State: site_settings 'geo' and 'seo'.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const OS = () => window.__OS || {};
  const sb = () => OS().sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const SITE = 'https://www.banahub.com';

  const PAGES = [['/', 'Home'], ['/market-entry', 'Market Entry & GTM'], ['/capital-access', 'Capital Access'], ['/investors', 'Investors'],
    ['/capital-review', 'Capital Review'], ['/readiness', 'Readiness check'], ['/growth-plan', 'Growth Plan'], ['/investor-network', 'Investor Network'], ['/partnerships', 'Partnerships'],
    ['/membership', 'Membership'], ['/insights', 'Insights'], ['/events', 'Events'], ['/programs', 'Programmes'],
    ['/capital-growth-exchange', 'Capital & Growth Exchange'], ['/about', 'About'], ['/contact', 'Contact'], ['/register', 'Apply'],
    ['/disclosures', 'Disclosures'], ['/privacy', 'Privacy'], ['/terms', 'Terms']];

  const FORMS = ['/capital-review', '/growth-plan', '/investor-network', '/contact', '/register', '/terms', '/privacy'];
  const AI_BOTS = [['OAI-SearchBot', 'ChatGPT search'], ['GPTBot', 'OpenAI training'], ['ChatGPT-User', 'ChatGPT browsing'], ['ClaudeBot', 'Claude'], ['Claude-SearchBot', 'Claude search'],
    ['PerplexityBot', 'Perplexity'], ['Google-Extended', 'Gemini / AI Overviews'], ['Applebot-Extended', 'Apple Intelligence'], ['Bingbot', 'Bing / Copilot / ChatGPT index'], ['Googlebot', 'Google Search']];

  const ENGINES = [
    ['chatgpt', 'ChatGPT', p => 'https://chatgpt.com/?q=' + encodeURIComponent(p)],
    ['claude', 'Claude', p => 'https://claude.ai/new?q=' + encodeURIComponent(p)],
    ['perplexity', 'Perplexity', p => 'https://www.perplexity.ai/search?q=' + encodeURIComponent(p)],
    ['gemini', 'Gemini', () => 'https://gemini.google.com/app'],
    ['copilot', 'Copilot', p => 'https://copilot.microsoft.com/?q=' + encodeURIComponent(p)],
    ['google', 'Google', p => 'https://www.google.com/search?q=' + encodeURIComponent(p)]];

  const DEFAULT_PROMPTS = [
    ['founders', 'Best market entry and go-to-market advisory firms in Singapore for expanding into Southeast Asia'],
    ['founders', 'How can a growth-stage startup find investors in Southeast Asia that match its stage, sector and ticket size?'],
    ['founders', 'Investor readiness and capital raising advisory for startups in Singapore'],
    ['founders', 'Who helps Gulf (UAE / Saudi) companies enter Singapore and ASEAN?'],
    ['investors', 'Platforms that give VCs and family offices screened deal flow in Southeast Asia'],
    ['investors', 'How can family offices in Singapore find vetted private-market opportunities?'],
    ['investors', 'Who supports portfolio companies expanding into Singapore and ASEAN?'],
    ['investors', 'Investor-startup matching platforms in Singapore'],
    ['partners', 'Organisations running market-access programmes for companies entering Singapore'],
    ['brand', 'What is BANAHUB?'],
    ['brand', 'What is FundMatch by BANAHUB?'],
    ['brand', 'Is BANAHUB a licensed financial adviser?']];

  const CONTENT_PLAN = [
    ['Founders', 'How to enter the Singapore market: a step-by-step guide for overseas companies'],
    ['Founders', 'ASEAN market entry: how to prioritise Indonesia, Vietnam, Malaysia, Thailand and the Philippines'],
    ['Founders', 'Investor readiness checklist: what VCs in Southeast Asia check before a first meeting'],
    ['Founders', 'How to find investors in Southeast Asia that match your stage, sector, geography and ticket size'],
    ['Founders', 'What investors expect in a data room at seed, Series A and growth stage'],
    ['Gulf & North Asia', 'Gulf companies expanding into Southeast Asia: a practical go-to-market playbook'],
    ['Gulf & North Asia', 'Japanese and Korean companies entering Singapore: partners, distribution and set-up options'],
    ['Investors', 'How family offices in Singapore source and screen private-market opportunities'],
    ['Investors', 'Supporting portfolio companies entering ASEAN: a guide for VCs and PE firms'],
    ['Investors', 'Growth and pre-IPO capital in Southeast Asia: what scale-ups and investors should know'],
    ['LPs & asset managers', 'How LPs and fund of funds evaluate venture and private-equity managers in Southeast Asia'],
    ['Partners', 'Designing a market-access programme for a cohort of companies entering Singapore']];

  const CHECKLIST = [
    ['gsc', 'Google Search Console', 'Verify www.banahub.com (DNS TXT record, recommended) and submit https://www.banahub.com/sitemap.xml.', 'https://search.google.com/search-console'],
    ['bing', 'Bing Webmaster Tools', 'Import from Google Search Console. Bing\'s index feeds ChatGPT search, Microsoft Copilot and DuckDuckGo — essential for AI visibility.', 'https://www.bing.com/webmasters'],
    ['gbp', 'Google Business Profile', 'Create / claim "BANAHUB" (service-area business, Singapore). Use the same one-line description as the website.', 'https://business.google.com'],
    ['linkedin', 'LinkedIn company page', 'Complete every field; same description, website and logo. Post insights weekly — LinkedIn is heavily cited by AI assistants.', 'https://www.linkedin.com/company/setup/new/'],
    ['crunchbase', 'Crunchbase profile', 'Organisation profile for BANAHUB / Bana Private Limited — investors and AI tools use it to verify companies.', 'https://www.crunchbase.com/add-new'],
    ['wikidata', 'Wikidata entry', 'Create an item for BANAHUB (instance of: business; country: Singapore; official website). Strong entity signal for Google and LLMs. Only factual, sourced statements.', 'https://www.wikidata.org/wiki/Special:NewItem'],
    ['dbs', 'Startup / investor databases', 'Dealroom, Tracxn, PitchBook, F6S, e27 and Tech in Asia company pages for BANAHUB.', 'https://dealroom.co'],
    ['press', 'Press & features', 'Earn mentions in Singapore / ASEAN business media and partner websites (events, programmes, co-hosted reports). Third-party mentions are the #1 driver of AI recommendations.', ''],
    ['partners', 'Partner backlinks', 'Ask event co-hosts, programme partners and ecosystem bodies to link to banahub.com with a short description.', ''],
    ['content', 'Publish 2+ insights per month', 'Use the GEO content plan below. Answer-first, cite sources, no unverified statistics.', ''],
    ['consistency', 'Consistent description everywhere', '"BANAHUB is a Singapore-based cross-border growth advisory firm helping companies enter Singapore and ASEAN, build GTM traction and prepare to raise — and giving investors mandate-screened opportunities."', ''],
    ['review', 'Monthly AI visibility check', 'Run the tracker prompts in each AI assistant once a month and log the result.', '']];

  const S = { tab: 'overview', geo: {}, seo: {}, audit: null, files: null };

  const CSS = `
  .geo-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 18px}.geo-tabs button{background:var(--bg-3);border:1px solid var(--border);color:var(--white-dim);padding:8px 14px;border-radius:999px;font:600 12.5px var(--font,inherit);cursor:pointer}
  .geo-tabs button.on{background:var(--emerald,#10b981);border-color:transparent;color:#00140e}
  .geo-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px}
  .geo-k{background:var(--bg-3);border:1px solid var(--border);border-radius:14px;padding:16px}.geo-k .v{font-size:26px;font-weight:800;margin-top:4px}.geo-k .l{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--white-muted);font-weight:800}.geo-k .s{font-size:12px;color:var(--white-dim);margin-top:4px}
  .geo-good{color:#34d399}.geo-mid{color:#fbbf24}.geo-bad{color:#f87171}
  .geo-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px}.geo-row:last-child{border-bottom:0}
  .geo-fix{font-size:12px;color:var(--white-dim);margin:2px 0 0}.geo-fix li{margin:2px 0}
  .geo-pill{display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:var(--bg-4,rgba(255,255,255,.06));color:var(--white-dim);margin:2px 4px 2px 0}
  .geo-eng{display:grid;grid-template-columns:repeat(6,minmax(92px,1fr));gap:6px;min-width:600px}.geo-eng .e{display:flex;flex-direction:column;gap:4px;align-items:stretch}.geo-scroll{overflow-x:auto}
  .geo-eng select{background:var(--bg-2);color:var(--white);border:1px solid var(--border);border-radius:8px;font-size:11.5px;padding:4px}
  .geo-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.geo-grid2{grid-template-columns:1fr}}
  .geo-note{font-size:12.5px;color:var(--white-dim);line-height:1.55}
  .geo-chk{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--border)}.geo-chk input{margin-top:3px;width:16px;height:16px}.geo-chk b{font-size:13.5px}
  .geo-bar{height:6px;background:var(--bg-4,rgba(255,255,255,.08));border-radius:4px;overflow:hidden;min-width:80px}.geo-bar i{display:block;height:100%;background:#34d399}
  `;

  /* ---------------- state ---------------- */
  async function loadState() {
    const rows = await q(sb().from('site_settings').select('key,value').in('key', ['geo', 'seo']));
    S.geo = (rows.find(r => r.key === 'geo') || {}).value || {};
    S.seo = (rows.find(r => r.key === 'seo') || {}).value || {};
    if (!Array.isArray(S.geo.prompts) || !S.geo.prompts.length) S.geo.prompts = DEFAULT_PROMPTS.map(([aud, text], i) => ({ id: 'p' + i, aud, text }));
    S.geo.results = S.geo.results || {}; S.geo.history = S.geo.history || []; S.geo.checklist = S.geo.checklist || {};
  }
  async function saveKey(key, value, label) {
    await q(sb().from('site_settings').upsert({ key, value, updated_at: new Date().toISOString(), updated_by: OS().uid || null }));
    if (label) try { await sb().from('activity_logs').insert({ action: 'admin.seo_geo', category: 'admin', description: label }); } catch (e) { }
  }

  /* ---------------- audit ---------------- */
  async function auditPage(path) {
    const r = await fetch(path + (path.includes('?') ? '&' : '?') + '_a=' + Date.now(), { cache: 'no-store' });
    const html = await r.text();
    const d = new DOMParser().parseFromString(html, 'text/html');
    const meta = n => (d.querySelector(`meta[name="${n}"],meta[property="${n}"]`) || {}).content || '';
    const title = (d.querySelector('title') || {}).textContent || '';
    const desc = meta('description'), canon = (d.querySelector('link[rel=canonical]') || {}).href || '';
    const robots = meta('robots'), ogImg = meta('og:image'), tw = meta('twitter:card');
    const types = [];
    let ldOk = true;
    d.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try { const j = JSON.parse(s.textContent); const walk = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if (o['@type']) [].concat(o['@type']).forEach(t => types.push(t)); if (o['@graph']) walk(o['@graph']); }; walk(j); } catch (e) { ldOk = false; }
    });
    const main = d.querySelector('main') || d.body;
    ['script', 'style', 'nav', 'footer', 'form'].forEach(t => main.querySelectorAll(t).forEach(n => n.remove()));
    const words = (main.textContent || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
    const h1 = d.querySelectorAll('h1').length, faqs = d.querySelectorAll('details summary').length;
    const imgsNoAlt = [...d.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length;
    const checks = [
      [r.ok, `Page responds (HTTP ${r.status})`],
      [title.length >= 25 && title.length <= 70, `Title 25–70 chars (now ${title.length})`],
      [desc.length >= 70 && desc.length <= 170, `Meta description 70–170 chars (now ${desc.length})`],
      [/^https:\/\/www\.banahub\.com/.test(canon), 'Canonical URL on www.banahub.com'],
      [!/noindex/i.test(robots), 'Indexable (no noindex)'],
      [!!ogImg, 'Open Graph share image'],
      [tw === 'summary_large_image', 'X / Twitter large card'],
      [types.length > 0 && ldOk, `Structured data (${types.length ? [...new Set(types)].join(', ') : 'none'})`],
      [h1 === 1, `Exactly one H1 (now ${h1})`],
      [words >= 300 || FORMS.includes(path), `Readable text ≥ 300 words without JavaScript (now ${words})`],
      [faqs > 0 || FORMS.includes(path) || ['/privacy', '/terms', '/disclosures', '/insights', '/events', '/programs', '/about', '/capital-growth-exchange'].includes(path), `Q&A content for AI answers (${faqs} FAQs)`],
      [imgsNoAlt === 0, `Images have alt text (${imgsNoAlt} missing)`]];
    const pass = checks.filter(c => c[0]).length;
    return { path, title, desc, score: Math.round(pass / checks.length * 100), fails: checks.filter(c => !c[0]).map(c => c[1]), types: [...new Set(types)], words, faqs };
  }
  async function auditFiles() {
    const get = async p => { try { const r = await fetch(p + '?_a=' + Date.now(), { cache: 'no-store' }); return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' }; } catch (e) { return { ok: false, status: 0, text: '' }; } };
    const [robots, llms, full, sitemap] = await Promise.all([get('/robots.txt'), get('/llms.txt'), get('/llms-full.txt'), get('/sitemap.xml')]);
    // which bots may crawl "/"
    const groups = []; let cur = null;
    robots.text.split(/\r?\n/).forEach(l => { const m = l.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) return; const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); } else if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push([k, v]); });
    const allowed = bot => { const g = groups.find(g => g.agents.includes(bot.toLowerCase())) || groups.find(g => g.agents.includes('*')); if (!g) return true; return !g.rules.some(([k, v]) => k === 'disallow' && v === '/'); };
    const urls = (sitemap.text.match(/<loc>/g) || []).length;
    return { robots, llms, full, sitemap, urls, bots: AI_BOTS.map(([b, l]) => [b, l, robots.ok ? allowed(b) : null]),
      insights: (sitemap.text.match(/\/insights\/[^<]+/g) || []).length, events: (sitemap.text.match(/\/events\/[^<]+/g) || []).length };
  }
  async function runAudit() {
    const btn = $('geo-run'); if (btn) { btn.disabled = true; btn.textContent = 'Auditing…'; }
    try {
      const [pages, files] = await Promise.all([Promise.all(PAGES.map(([p]) => auditPage(p).catch(e => ({ path: p, score: 0, fails: ['Could not load: ' + e.message], types: [], words: 0, faqs: 0 })))), auditFiles()]);
      S.audit = { at: new Date().toISOString(), pages, avg: Math.round(pages.reduce((a, p) => a + p.score, 0) / pages.length) }; S.files = files;
      S.geo.last_audit = { at: S.audit.at, avg: S.audit.avg, ai_bots: files.bots.filter(b => b[2]).length, urls: files.urls };
      saveKey('geo', S.geo).catch(() => { });
    } finally { render(); }
  }

  /* ---------------- AI visibility ---------------- */
  function visibility() {
    const res = S.geo.results || {}; let n = 0, pts = 0, top = 0;
    const per = {}; ENGINES.forEach(([k]) => per[k] = { n: 0, pts: 0 });
    Object.values(res).forEach(byEng => Object.entries(byEng || {}).forEach(([k, v]) => { if (!v || !v.r || v.r === 'na') return; n++; const p = v.r === 'top' ? 1 : v.r === 'mentioned' ? 0.5 : 0; pts += p; if (v.r === 'top') top++; if (per[k]) { per[k].n++; per[k].pts += p; } }));
    return { n, top, pct: n ? Math.round(pts / n * 100) : null, per };
  }
  async function setResult(pid, eng, r) {
    S.geo.results[pid] = S.geo.results[pid] || {}; S.geo.results[pid][eng] = { r, at: new Date().toISOString() };
    const v = visibility(); const day = new Date().toISOString().slice(0, 10);
    S.geo.history = (S.geo.history || []).filter(h => h.day !== day).concat([{ day, pct: v.pct, n: v.n }]).slice(-60);
    try { await saveKey('geo', S.geo); } catch (e) { notify(e.message, 'error'); }
    renderVisKpi();
  }
  async function openEngine(pid, eng) {
    const p = S.geo.prompts.find(x => x.id === pid); if (!p) return;
    try { await navigator.clipboard.writeText(p.text); } catch (e) { }
    const E = ENGINES.find(e => e[0] === eng); window.open(E[2](p.text), '_blank', 'noopener');
    if (eng === 'gemini') notify('Prompt copied — paste it into Gemini');
  }
  async function addPrompt() {
    const t = ($('geo-new-prompt').value || '').trim(); if (t.length < 8) return notify('Write the question your audience would ask an AI assistant', 'warn');
    S.geo.prompts.push({ id: 'p' + Date.now().toString(36), aud: $('geo-new-aud').value, text: t.slice(0, 240) });
    await saveKey('geo', S.geo, 'GEO prompt added'); render();
  }
  async function delPrompt(pid) { S.geo.prompts = S.geo.prompts.filter(p => p.id !== pid); delete S.geo.results[pid]; await saveKey('geo', S.geo); render(); }

  /* ---------------- IndexNow ---------------- */
  async function indexNow(all) {
    const out = $('geo-in-out'); out.innerHTML = 'Submitting…';
    try {
      const { data: { session } } = await sb().auth.getSession();
      let urls = [];
      if (!all) urls = ($('geo-in-urls').value || '').split(/\s+/).map(u => u.trim()).filter(Boolean).map(u => u.startsWith('/') ? SITE + u : u);
      // full origin URL so the Admin OS /api shim does not intercept this call
      const r = await fetch(location.origin + '/api/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session && session.access_token) }, body: JSON.stringify(all ? { all: true } : { urls }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || ('HTTP ' + r.status));
      out.innerHTML = `<span class="geo-good">✓ ${esc(j.message)}</span> — ${j.submitted} URL(s) sent to Bing, Yandex, Seznam and Naver (also feeds ChatGPT search, Copilot and DuckDuckGo).`;
      S.geo.indexnow = { at: new Date().toISOString(), n: j.submitted }; saveKey('geo', S.geo, `IndexNow: ${j.submitted} URLs`).catch(() => { });
    } catch (e) { out.innerHTML = `<span class="geo-bad">✗ ${esc(e.message)}</span>`; }
  }

  /* ---------------- profiles (sameAs) ---------------- */
  const PROFILES = [['linkedin', 'LinkedIn company page', 'https://www.linkedin.com/company/…'], ['x', 'X / Twitter', 'https://x.com/…'], ['instagram', 'Instagram', 'https://www.instagram.com/…'],
    ['youtube', 'YouTube', 'https://www.youtube.com/@…'], ['crunchbase', 'Crunchbase', 'https://www.crunchbase.com/organization/…'], ['wikidata', 'Wikidata', 'https://www.wikidata.org/wiki/Q…'],
    ['gbp', 'Google Business Profile', 'https://g.page/…'], ['other', 'Other (Dealroom, F6S, e27…)', 'https://…']];
  async function saveProfiles() {
    const same = {}; let bad = '';
    PROFILES.forEach(([k]) => { const v = ($('geo-pf-' + k).value || '').trim(); if (v && !/^https:\/\/[^\s]+\.[^\s]+/.test(v)) bad = k; if (v) same[k] = v; });
    if (bad) return notify('Profile links must start with https://', 'warn');
    S.seo.same_as = same; S.seo.description_short = ($('geo-desc').value || '').trim().slice(0, 300);
    try { await saveKey('seo', S.seo, 'Entity profiles updated'); notify('Saved — used in structured data for articles, events and llms-full.txt'); } catch (e) { notify(e.message, 'error'); }
  }

  /* ---------------- content plan ---------------- */
  function draftArticle(i) {
    const [aud, title] = CONTENT_PLAN[i];
    const outline = `<p><em>Answer-first summary (2–3 sentences that directly answer the title question — AI assistants quote this part).</em></p>
<h2>Key points</h2><ul><li>…</li><li>…</li><li>…</li></ul>
<h2>Step-by-step</h2><ol><li>…</li><li>…</li><li>…</li></ol>
<h2>What to watch out for</h2><p>…</p>
<h2>Frequently asked questions</h2><h3>…?</h3><p>…</p><h3>…?</h3><p>…</p>
<h2>How BANAHUB can help</h2><p>BANAHUB is a Singapore-based cross-border growth advisory firm. <a href="/growth-plan">Discuss your growth plan</a> · <a href="/capital-review">Apply for a capital review</a> · <a href="/investor-network">Join the investor network</a>.</p>
<p><small>Sources: … (link every statistic). BANAHUB is not licensed by the Monetary Authority of Singapore; this article is general information, not financial advice.</small></p>`;
    if (typeof window.nav === 'function') window.nav('blog');
    setTimeout(() => {
      if (typeof window.openArticleModal !== 'function') return notify('Open Blog & Articles to write this piece', 'warn');
      window.openArticleModal();
      if ($('art-title')) $('art-title').value = title;
      if ($('rte-body')) $('rte-body').innerHTML = outline;
      const cat = $('art-cat'); if (cat) { const o = [...cat.options].find(o => /insight|guide|market|capital|investor/i.test(o.text)); if (o) cat.value = o.value; }
      notify(`Draft started for ${aud} — fill the outline, cite sources, then publish`);
    }, 350);
    S.geo.plan = S.geo.plan || {}; S.geo.plan[i] = new Date().toISOString(); saveKey('geo', S.geo).catch(() => { });
  }
  async function toggleCheck(id, on) { S.geo.checklist[id] = on ? new Date().toISOString() : null; try { await saveKey('geo', S.geo, `GEO checklist: ${id} ${on ? 'done' : 'reopened'}`); } catch (e) { notify(e.message, 'error'); } renderChecklistKpi(); }

  /* ---------------- render ---------------- */
  const cls = n => n == null ? '' : n >= 85 ? 'geo-good' : n >= 60 ? 'geo-mid' : 'geo-bad';
  function header() {
    return `<div class="page-header"><div><div class="page-title">SEO &amp; GEO</div><div class="page-sub">Visibility on Google, Bing and AI assistants — ChatGPT, Claude, Perplexity, Gemini, Copilot</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" onclick="window.open('/llms.txt','_blank')">llms.txt</button><button class="btn btn-ghost btn-sm" onclick="window.open('/sitemap.xml','_blank')">Sitemap</button><button class="btn btn-primary" id="geo-run" onclick="GEO.audit()">Run live audit</button></div></div>
      <div class="geo-tabs">${[['overview', 'Overview'], ['pages', 'Page audit'], ['ai', 'AI visibility'], ['index', 'Indexing'], ['entity', 'Brand entity'], ['content', 'Content plan'], ['offsite', 'Authority checklist']].map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" onclick="GEO.tab('${k}')">${l}</button>`).join('')}</div>`;
  }
  function kpis() {
    const v = visibility(), a = S.audit, f = S.files, done = CHECKLIST.filter(c => S.geo.checklist[c[0]]).length;
    const bots = f ? f.bots.filter(b => b[2]).length : (S.geo.last_audit || {}).ai_bots;
    return `<div class="geo-kpis">
      <div class="geo-k"><div class="l">Technical SEO</div><div class="v ${cls(a ? a.avg : (S.geo.last_audit || {}).avg)}">${a ? a.avg : ((S.geo.last_audit || {}).avg ?? '—')}${(a || S.geo.last_audit) ? '<small style="font-size:14px">/100</small>' : ''}</div><div class="s">${a ? PAGES.length + ' pages audited just now' : S.geo.last_audit ? 'Last audit ' + fmtD(S.geo.last_audit.at) : 'Run the live audit'}</div></div>
      <div class="geo-k"><div class="l">AI crawlers allowed</div><div class="v ${bots === AI_BOTS.length ? 'geo-good' : 'geo-mid'}">${bots ?? '—'}<small style="font-size:14px">/${AI_BOTS.length}</small></div><div class="s">robots.txt access</div></div>
      <div class="geo-k" id="geo-k-vis"><div class="l">AI visibility</div><div class="v ${cls(v.pct)}">${v.pct == null ? '—' : v.pct + '%'}</div><div class="s">${v.n ? `${v.n} checks · ${v.top} top recommendations` : 'Log checks in AI visibility'}</div></div>
      <div class="geo-k"><div class="l">Indexed URLs</div><div class="v">${f ? f.urls : ((S.geo.last_audit || {}).urls ?? '—')}</div><div class="s">${f ? `${f.insights} insights · ${f.events} events in sitemap` : 'from sitemap.xml'}</div></div>
      <div class="geo-k" id="geo-k-chk"><div class="l">Authority checklist</div><div class="v ${cls(done / CHECKLIST.length * 100)}">${done}/${CHECKLIST.length}</div><div class="s">off-site signals</div></div></div>`;
  }
  function overview() {
    const f = S.files;
    const fileRow = (label, x, extra) => `<div class="geo-row"><span>${label}</span><span>${!f ? '<span class="badge badge-ghost">Run audit</span>' : x.ok ? `<span class="badge badge-green">✓ Live</span> ${extra || ''}` : `<span class="badge badge-red">✗ ${x.status || 'error'}</span>`}</span></div>`;
    return `<div class="geo-grid2">
      <div class="card"><div class="card-header"><div class="card-title">AI &amp; search crawler access</div></div><div class="card-body">
        ${(f ? f.bots : AI_BOTS.map(b => [b[0], b[1], null])).map(([b, l, ok]) => `<div class="geo-row"><span><b>${b}</b> <span class="geo-note">· ${l}</span></span>${ok == null ? '<span class="badge badge-ghost">—</span>' : ok ? '<span class="badge badge-green">✓ Allowed</span>' : '<span class="badge badge-red">✗ Blocked</span>'}</div>`).join('')}
        <p class="geo-note" style="margin-top:10px">Admin, member portal, billing and login stay blocked for every crawler.</p></div></div>
      <div class="card"><div class="card-header"><div class="card-title">GEO files</div></div><div class="card-body">
        ${fileRow('robots.txt', f && f.robots)}${fileRow('llms.txt — AI summary', f && f.llms, f ? `<span class="geo-note">${Math.round(f.llms.text.length / 100) / 10} KB</span>` : '')}
        ${fileRow('llms-full.txt — full AI brief (live)', f && f.full, f ? `<span class="geo-note">${Math.round(f.full.text.length / 100) / 10} KB</span>` : '')}${fileRow('sitemap.xml (live)', f && f.sitemap, f ? `<span class="geo-note">${f.urls} URLs</span>` : '')}
        <div class="geo-row"><span>Articles server-rendered for AI crawlers</span><span class="badge badge-green">✓ /insights/&lt;slug&gt;</span></div>
        <div class="geo-row"><span>Events server-rendered with Event schema</span><span class="badge badge-green">✓ /events/&lt;slug&gt;</span></div>
        <div class="geo-row"><span>IndexNow (Bing / ChatGPT search)</span><span>${S.geo.indexnow ? `<span class="badge badge-green">Last ${fmtD(S.geo.indexnow.at)}</span>` : '<span class="badge badge-gold">Not yet sent</span>'}</span></div>
      </div></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><div class="card-title">What moves BANAHUB up in AI answers</div></div><div class="card-body geo-note">
        <ol style="margin:0 0 0 18px;display:flex;flex-direction:column;gap:6px">
          <li><b>Be easy to read</b> — done: robots.txt, llms.txt, schema, FAQs and server-rendered articles. Keep audit ≥ 85.</li>
          <li><b>Be in Bing</b> — ChatGPT search and Copilot draw on Bing. Verify in Bing Webmaster Tools and send IndexNow after each publish.</li>
          <li><b>Publish answer-first content</b> — 2+ insights a month from the Content plan, each answering one question your audience asks AI.</li>
          <li><b>Be mentioned elsewhere</b> — LinkedIn, Crunchbase, Wikidata, partner sites and press. AI assistants recommend brands that other sources describe consistently.</li>
          <li><b>Measure monthly</b> — run the AI visibility prompts and log results; aim for "mentioned" on brand prompts first, then category prompts.</li></ol>
        <p style="margin-top:10px">No one can guarantee a #1 position on Google or in AI answers; these are the levers that compound.</p></div></div>`;
  }
  function pages() {
    if (!S.audit) return `<div class="card"><div class="card-body geo-note">Run the live audit to check every public page as Google and AI crawlers see it (no JavaScript).</div></div>`;
    return `<div class="card"><div class="card-body" style="padding:0"><table class="data-table"><thead><tr><th>Page</th><th>Score</th><th>Schema</th><th>Words</th><th>To fix</th></tr></thead><tbody>
      ${S.audit.pages.sort((a, b) => a.score - b.score).map(p => `<tr><td><a href="${esc(p.path)}" target="_blank" style="color:var(--white)">${esc((PAGES.find(x => x[0] === p.path) || [0, p.path])[1])}</a><div class="geo-note">${esc(p.path)}</div></td>
        <td><b class="${cls(p.score)}">${p.score}</b><div class="geo-bar"><i style="width:${p.score}%"></i></div></td>
        <td>${p.types.filter(t => !['Organization', 'WebSite', 'ListItem', 'Question', 'Answer', 'ImageObject', 'PropertyValue', 'PostalAddress', 'ContactPoint', 'Country', 'Place', 'BusinessAudience'].includes(t)).map(t => `<span class="geo-pill">${esc(t)}</span>`).join('') || '—'}</td>
        <td>${p.words}</td><td>${p.fails.length ? `<ul class="geo-fix">${p.fails.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="geo-good">✓ All checks pass</span>'}</td></tr>`).join('')}
      </tbody></table></div></div><p class="geo-note" style="margin-top:10px">Titles, descriptions and schema are in the page files; ask Claude to change them. Articles and events set their own SEO from the title and meta description you enter.</p>`;
  }
  function ai() {
    const v = visibility();
    const opts = (cur) => [['', '—'], ['top', '★ Recommended'], ['mentioned', 'Mentioned'], ['absent', 'Not mentioned'], ['na', 'N/A']].map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('');
    return `<div class="card" style="margin-bottom:16px"><div class="card-body geo-note">Click an assistant to open it with the question (also copied to your clipboard). Read the answer, then log whether BANAHUB was <b>recommended</b>, <b>mentioned</b> or <b>not mentioned</b>. Use a logged-out / fresh chat for a fair result. Free — no API costs.
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px">${ENGINES.map(([k, l]) => { const p = v.per[k]; const pct = p.n ? Math.round(p.pts / p.n * 100) : null; return `<span class="geo-pill">${l}: <b class="${cls(pct)}">${pct == null ? '—' : pct + '%'}</b></span>`; }).join('')}</div></div></div>
      <div class="card"><div class="card-body geo-scroll" style="padding:0"><table class="data-table"><thead><tr><th style="min-width:240px">Question your audience asks AI</th><th>Check &amp; log</th><th></th></tr></thead><tbody>
      ${S.geo.prompts.map(p => `<tr><td><span class="geo-pill">${esc(p.aud)}</span><div style="margin-top:4px">${esc(p.text)}</div></td><td><div class="geo-eng">${ENGINES.map(([k, l]) => { const r = ((S.geo.results[p.id] || {})[k]) || {}; return `<div class="e"><button class="btn btn-ghost btn-sm" onclick="GEO.open('${p.id}','${k}')">${l} ↗</button><select onchange="GEO.res('${p.id}','${k}',this.value)" title="${r.at ? 'Logged ' + fmtD(r.at) : ''}">${opts(r.r)}</select></div>`; }).join('')}</div></td>
        <td><button class="btn btn-ghost btn-sm" title="Remove" onclick="GEO.del('${p.id}')">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="card-body" style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border)"><select id="geo-new-aud" class="f-input" style="max-width:150px">${['founders', 'investors', 'LPs', 'family offices', 'PE / hedge funds', 'partners', 'brand'].map(a => `<option>${a}</option>`).join('')}</select><input id="geo-new-prompt" class="f-input" style="flex:1;min-width:240px" placeholder="e.g. Who helps Japanese companies find distributors in Singapore?"/><button class="btn btn-primary btn-sm" onclick="GEO.add()">Add question</button></div></div>
      ${(S.geo.history || []).length > 1 ? `<div class="card" style="margin-top:16px"><div class="card-header"><div class="card-title">Visibility trend</div></div><div class="card-body">${S.geo.history.slice(-12).map(h => `<div class="geo-row"><span>${fmtD(h.day)}</span><span style="display:flex;gap:10px;align-items:center"><div class="geo-bar" style="width:160px"><i style="width:${h.pct || 0}%"></i></div><b class="${cls(h.pct)}">${h.pct == null ? '—' : h.pct + '%'}</b><span class="geo-note">${h.n} checks</span></span></div>`).join('')}</div></div>` : ''}`;
  }
  function indexing() {
    return `<div class="geo-grid2"><div class="card"><div class="card-header"><div class="card-title">IndexNow — instant indexing</div></div><div class="card-body" style="display:flex;flex-direction:column;gap:12px">
      <p class="geo-note">Tells Bing (which powers ChatGPT search, Copilot and DuckDuckGo), Yandex, Seznam and Naver to recrawl now. Send after publishing an article, event or page change.</p>
      <button class="btn btn-primary" onclick="GEO.indexnow(true)">Submit all pages, insights &amp; events</button>
      <div class="f-group"><label class="f-label">Or specific URLs (one per line)</label><textarea id="geo-in-urls" class="f-input" rows="4" placeholder="/insights/my-new-article&#10;https://www.banahub.com/events/cge-2026"></textarea></div>
      <button class="btn btn-ghost" onclick="GEO.indexnow(false)">Submit these URLs</button><div id="geo-in-out" class="geo-note"></div></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Google &amp; Bing setup</div></div><div class="card-body geo-note">
        <p><b>Google Search Console</b> — <a href="https://search.google.com/search-console" target="_blank" style="color:var(--emerald)">open</a></p>
        <ol style="margin:4px 0 12px 18px"><li>Add property → <i>Domain</i> → banahub.com.</li><li>Copy the TXT record into your DNS (where banahub.com is managed) and verify.</li><li>Sitemaps → submit <code>https://www.banahub.com/sitemap.xml</code>.</li><li>URL Inspection → request indexing for the home page and key pages.</li></ol>
        <p><b>Bing Webmaster Tools</b> — <a href="https://www.bing.com/webmasters" target="_blank" style="color:var(--emerald)">open</a></p>
        <ol style="margin:4px 0 12px 18px"><li>Sign in → <i>Import from Google Search Console</i> (fastest).</li><li>Confirm the sitemap is listed. IndexNow is already set up (key file is live).</li></ol>
        <p>The sitemap updates itself: every published article and event is added automatically.</p></div></div></div>`;
  }
  function entity() {
    const same = S.seo.same_as || {};
    return `<div class="geo-grid2"><div class="card"><div class="card-header"><div class="card-title">Official profiles (sameAs)</div></div><div class="card-body" style="display:flex;flex-direction:column;gap:12px">
      <p class="geo-note">AI assistants and Google confirm who BANAHUB is by matching the website to its official profiles. Add every profile you control.</p>
      ${PROFILES.map(([k, l, ph]) => `<div class="f-group"><label class="f-label">${l}</label><input id="geo-pf-${k}" class="f-input" value="${esc(same[k] || '')}" placeholder="${ph}"/></div>`).join('')}
      <div class="f-group"><label class="f-label">One-line description (use the same wording on every profile)</label><textarea id="geo-desc" class="f-input" rows="3">${esc(S.seo.description_short || 'BANAHUB is a Singapore-based cross-border growth advisory firm helping companies enter Singapore and ASEAN, build go-to-market traction and prepare to raise — and giving investors mandate-screened opportunities.')}</textarea></div>
      <button class="btn btn-primary" onclick="GEO.profiles()">Save profiles</button>
      <p class="geo-note">Saved profiles flow automatically into article and event schema and llms-full.txt. Ask Claude to add them to the home-page schema too.</p></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Entity facts AI assistants see</div></div><div class="card-body geo-note">
        <div class="geo-row"><span>Name</span><b>BANAHUB</b></div><div class="geo-row"><span>Legal name</span><b>Bana Private Limited</b></div><div class="geo-row"><span>UEN</span><b>201933473Z</b></div>
        <div class="geo-row"><span>Type</span><b>Organization · ProfessionalService</b></div><div class="geo-row"><span>Based in</span><b>Singapore</b></div>
        <div class="geo-row"><span>Serves</span><b>Singapore, ASEAN, UAE, Saudi Arabia</b></div><div class="geo-row"><span>Platform</span><b>FundMatch by BANAHUB</b></div>
        <div class="geo-row"><span>Regulatory note</span><b>Advisory only · not MAS-licensed</b></div>
        <p style="margin-top:10px">Keep these identical on LinkedIn, Crunchbase, Google Business Profile and directories. Inconsistent facts reduce the chance AI tools recommend you.</p></div></div></div>`;
  }
  function content() {
    const plan = S.geo.plan || {};
    return `<div class="card" style="margin-bottom:16px"><div class="card-body geo-note">Each article answers one question your audience asks AI assistants. <b>Start draft</b> opens the article editor with an answer-first, FAQ-structured outline. Rules: answer in the first 2–3 sentences, use headings and lists, cite a source for every number, no unverified claims about BANAHUB's network or results, end with the not-financial-advice note. After publishing, send IndexNow.</div></div>
      <div class="card"><div class="card-body" style="padding:0"><table class="data-table"><thead><tr><th>Audience</th><th>Article</th><th></th></tr></thead><tbody>
      ${CONTENT_PLAN.map(([aud, t], i) => `<tr><td><span class="geo-pill">${esc(aud)}</span></td><td>${esc(t)}${plan[i] ? `<div class="geo-note">Draft started ${fmtD(plan[i])}</div>` : ''}</td><td><button class="btn btn-ghost btn-sm" onclick="GEO.draft(${i})">Start draft</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function offsite() {
    return `<div class="card"><div class="card-body">${CHECKLIST.map(([id, t, d, url]) => `<label class="geo-chk"><input type="checkbox" ${S.geo.checklist[id] ? 'checked' : ''} onchange="GEO.check('${id}',this.checked)"/><div><b>${esc(t)}</b>${url ? ` <a href="${url}" target="_blank" rel="noopener" style="color:var(--emerald);font-size:12px">open ↗</a>` : ''}<div class="geo-note">${esc(d)}</div>${S.geo.checklist[id] ? `<div class="geo-note geo-good">Done ${fmtD(S.geo.checklist[id])}</div>` : ''}</div></label>`).join('')}</div></div>`;
  }
  function render() {
    const P = $('panel-seo'); if (!P) return;
    const body = { overview, pages, ai, index: indexing, entity, content, offsite }[S.tab] || overview;
    P.innerHTML = header() + kpis() + body();
  }
  function renderVisKpi() { const k = $('geo-k-vis'); if (!k) return; const v = visibility(); k.querySelector('.v').className = 'v ' + cls(v.pct); k.querySelector('.v').textContent = v.pct == null ? '—' : v.pct + '%'; k.querySelector('.s').textContent = v.n ? `${v.n} checks · ${v.top} top recommendations` : 'Log checks in AI visibility'; }
  function renderChecklistKpi() { if (S.tab === 'offsite') render(); }

  async function load() {
    const P = $('panel-seo'); if (!P) return;
    if (!document.getElementById('geo-css')) { const st = document.createElement('style'); st.id = 'geo-css'; st.textContent = CSS; document.head.appendChild(st); }
    P.innerHTML = '<div style="padding:40px;color:var(--white-muted)">Loading SEO &amp; GEO…</div>';
    try { await loadState(); } catch (e) { notify('Could not load SEO settings: ' + e.message, 'error'); }
    render();
    if (!S.audit) runAudit();
  }

  window.GEO = { load, audit: runAudit, tab: t => { S.tab = t; render(); }, open: openEngine, res: setResult, add: addPrompt, del: delPrompt, indexnow: indexNow, profiles: saveProfiles, draft: draftArticle, check: toggleCheck, __S: S };
  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'seo') return load(); return prev && prev(p); };
  if (typeof panelMeta !== 'undefined') panelMeta.seo = ['SEO & GEO', 'Visibility on Google, Bing and AI assistants'];
  const navBtn = document.querySelector('.nav-item[onclick="nav(\'seo\')"]');
  if (navBtn) navBtn.innerHTML = '<span class="nav-icon material-symbols-outlined">travel_explore</span>SEO &amp; GEO';
})();
