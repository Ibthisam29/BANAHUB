/* BANAHUB Insights & Events feed (site v4) — reads published articles and events
 * from Admin OS. Home: #home-feed / #home-feed-list. Insights: #feed-list, #article-view. */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (d, o) { try { return new Date(d).toLocaleDateString('en-SG', o); } catch (e) { return ''; } };
  function eventHref(e) { return (e.page_url && /^\/[a-z0-9\-\/]*$/i.test(e.page_url)) ? e.page_url : 'event.html?id=' + encodeURIComponent(e.id); }
  function artKey(a) { return a.slug || a.id; }
  function plain(html) { var d = document.createElement('div'); d.innerHTML = String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''); return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
  function dateBlock(d) { return '<div class="bh-date" aria-hidden="true"><div class="m">' + esc(fmt(d, { month: 'short' }).toUpperCase()) + '</div><div class="d">' + esc(new Date(d).getDate()) + '</div></div>'; }

  function eventItem(e, past) {
    var meta = [fmt(e.event_date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }), e.type, e.format, e.location].filter(Boolean).map(esc).join(' · ');
    var x = plain(e.description).slice(0, 180);
    return '<a class="bh-item" href="' + esc(eventHref(e)) + '">' + dateBlock(e.event_date) +
      '<div><div class="meta" style="margin:0 0 4px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.7rem;color:var(--bh-em-2)">' + (past ? 'Past event' : 'Event') + '</div><h3 class="bh-h3">' + esc(e.title) + '</h3><div class="meta">' + meta + '</div>' + (x ? '<p class="x">' + esc(x) + (x.length >= 180 ? '…' : '') + '</p>' : '') + '</div>' +
      '<span class="bh-link">' + (past ? 'View' : 'Details') + ' <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></span></a>';
  }
  function articleItem(a) {
    var d = a.publish_date || a.created_at;
    var x = (a.meta_description || plain(a.body)).slice(0, 200);
    return '<a class="bh-item" href="insights.html?article=' + encodeURIComponent(artKey(a)) + '">' + dateBlock(d) +
      '<div><div class="meta" style="margin:0 0 4px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.7rem;color:var(--bh-gold-ink)">' + esc(a.category || 'Insight') + '</div><h3 class="bh-h3">' + esc(a.title) + '</h3>' +
      '<div class="meta">' + [fmt(d, { day: 'numeric', month: 'long', year: 'numeric' }), a.author_name].filter(Boolean).map(esc).join(' · ') + '</div>' + (x ? '<p class="x">' + esc(x) + (x.length >= 200 ? '…' : '') + '</p>' : '') + '</div>' +
      '<span class="bh-link">Read <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></span></a>';
  }

  // Safe article body: whitelist tags + attributes
  var OK = /^(P|BR|STRONG|EM|B|I|U|UL|OL|LI|H2|H3|H4|BLOCKQUOTE|A|IMG|FIGURE|FIGCAPTION|HR|SPAN|TABLE|THEAD|TBODY|TR|TH|TD|CODE|PRE|SUB|SUP)$/;
  function safeBody(html) {
    html = String(html || '');
    if (!/<[a-z][\s\S]*>/i.test(html)) return html.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br/>') + '</p>'; }).join('');
    var doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html'), root = doc.body.firstChild;
    (function walk(n) {
      [].slice.call(n.childNodes).forEach(function (c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1) { c.remove(); return; }
        if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|LINK|META)$/.test(c.tagName)) { c.remove(); return; }
        walk(c);
        if (!OK.test(c.tagName)) { while (c.firstChild) c.parentNode.insertBefore(c.firstChild, c); c.remove(); return; }
        [].slice.call(c.attributes).forEach(function (a) {
          var k = a.name.toLowerCase(), v = a.value.trim();
          var keep = (k === 'href' && c.tagName === 'A' && /^(https?:|mailto:|\/|#|[a-z0-9-]+\.html)/i.test(v)) || (k === 'src' && c.tagName === 'IMG' && /^https:/i.test(v)) || (k === 'alt' && c.tagName === 'IMG');
          if (!keep) c.removeAttribute(a.name);
        });
        if (c.tagName === 'A' && /^https?:/i.test(c.getAttribute('href') || '')) { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer'); }
      });
    })(root);
    return root.innerHTML;
  }

  async function load() {
    var out = { events: [], articles: [] };
    try {
      var r = await Promise.all([window.apiFetch('/api/events').then(function (x) { return x.json(); }).catch(function () { return {}; }),
                                 window.apiFetch('/api/articles').then(function (x) { return x.json(); }).catch(function () { return {}; })]);
      out.events = (r[0].events || []).filter(function (e) { return e.published && e.event_date; });
      out.articles = (r[1].articles || []).filter(function (a) { return a.published !== false && (a.status || 'published') === 'published'; });
    } catch (e) {}
    var now = Date.now();
    out.upcoming = out.events.filter(function (e) { return new Date(e.end_date || e.event_date).getTime() >= now; }).sort(function (a, b) { return new Date(a.event_date) - new Date(b.event_date); });
    out.past = out.events.filter(function (e) { return new Date(e.end_date || e.event_date).getTime() < now; }).sort(function (a, b) { return new Date(b.event_date) - new Date(a.event_date); });
    out.articles.sort(function (a, b) { return new Date(b.publish_date || b.created_at) - new Date(a.publish_date || a.created_at); });
    return out;
  }

  async function home() {
    var sec = document.getElementById('home-feed'), list = document.getElementById('home-feed-list'); if (!sec || !list) return;
    var d = await load();
    var items = d.upcoming.slice(0, 3).map(function (e) { return eventItem(e); }).concat(d.articles.slice(0, 3).map(articleItem));
    if (!items.length) return; // section stays hidden — nothing invented
    list.innerHTML = items.slice(0, 5).join(''); sec.hidden = false;
  }

  async function insights() {
    var list = document.getElementById('feed-list'); if (!list) return;
    var d = await load(), q = new URLSearchParams(location.search), key = q.get('article');
    if (key) {
      var a = d.articles.find(function (x) { return String(artKey(x)) === key || String(x.id) === key; });
      var view = document.getElementById('article-view');
      document.getElementById('feed-view').hidden = true; view.hidden = false;
      if (!a) { view.innerHTML = '<div class="bh-empty">This article is not available. <a class="bh-link" href="insights.html">All insights</a></div>'; return; }
      document.title = a.title + ' — BANAHUB';
      var md = document.querySelector('meta[name=description]'); if (md && a.meta_description) md.setAttribute('content', a.meta_description);
      view.innerHTML = '<article class="bh-article"><a class="bh-link" href="insights.html" style="margin-bottom:22px"><span class="material-symbols-outlined" aria-hidden="true" style="transform:rotate(180deg)">arrow_forward</span> All insights</a>' +
        '<span class="bh-eyebrow" style="display:flex">' + esc(a.category || 'Insight') + '</span><h1 class="bh-h1">' + esc(a.title) + '</h1>' +
        '<p class="bh-small">' + [fmt(a.publish_date || a.created_at, { day: 'numeric', month: 'long', year: 'numeric' }), a.author_name].filter(Boolean).map(esc).join(' · ') + '</p>' +
        '<div class="body">' + safeBody(a.body) + '</div></article>';
      return;
    }
    var tabs = document.querySelectorAll('[data-tab]');
    function render(t) {
      tabs.forEach(function (b) { var on = b.getAttribute('data-tab') === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      var items = t === 'events' ? d.upcoming.map(function (e) { return eventItem(e); })
        : t === 'insights' ? d.articles.map(articleItem)
        : t === 'past' ? d.past.map(function (e) { return eventItem(e, true); })
        : d.upcoming.map(function (e) { return eventItem(e); }).concat(d.articles.map(articleItem));
      var empty = { events: 'No upcoming events are scheduled. Join the investor network or propose a collaboration to hear about future sessions.', insights: 'No insights published yet.', past: 'No past events to show.', all: 'Nothing published yet. Check back soon.' }[t];
      list.innerHTML = items.length ? items.join('') : '<div class="bh-empty">' + esc(empty) + '</div>';
    }
    tabs.forEach(function (b) { b.addEventListener('click', function () { render(b.getAttribute('data-tab')); history.replaceState(null, '', b.getAttribute('data-tab') === 'all' ? location.pathname : '#' + b.getAttribute('data-tab')); }); });
    var h = location.hash.replace('#', '');
    render(['events', 'insights', 'past'].indexOf(h) >= 0 ? h : 'all');
  }

  function boot() { home(); insights(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
