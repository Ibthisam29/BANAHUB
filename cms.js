/* BANAHub Page CMS runtime
 * ─────────────────────────────────────────────────────────────────────────
 * PUBLIC MODE  (every page, auto-loaded by config.js)
 *   Fetches pages.sections.cms_published for this page's slug and applies
 *   admin edits: text/HTML, image src, link href, hide. Cached in
 *   localStorage so repeat visits render edits without a flash.
 *
 * EDIT MODE    (?cms_edit=1, only inside the same-origin admin iframe)
 *   Click any text to edit inline, click an image to swap it, use the
 *   floating toolbar to edit links / hide / reset. The admin page collects
 *   changes via postMessage and saves them as draft or published.
 *
 * Element keys are structural paths (tag:nth-of-type chain from <body>),
 * so no page HTML needs data attributes. An explicit data-cms="key" on an
 * element overrides the generated key.
 */
(function () {
  'use strict';
  if (window.__banaCms) return; window.__banaCms = true;

  var CFG = window.CONFIG || {};
  var SB_URL = CFG.SUPABASE_URL, SB_KEY = CFG.SUPABASE_ANON_KEY;
  var params = new URLSearchParams(location.search);
  var inFrame = false; try { inFrame = window.parent !== window && window.parent.location.origin === location.origin; } catch (e) {}
  var EDIT = params.get('cms_edit') === '1' && inFrame;
  var SKIP = '#site-nav, #site-footer, script, style, noscript, svg, iframe, [data-cms-skip], .cms-ui';
  var TEXT_TAGS = /^(H1|H2|H3|H4|H5|H6|P|LI|A|BUTTON|SPAN|STRONG|EM|B|I|SMALL|LABEL|BLOCKQUOTE|FIGCAPTION|TD|TH|DT|DD|DIV|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|MAIN)$/;

  function slug() {
    var p = location.pathname.replace(/\/+$/, '').split('/').pop() || 'index';
    p = p.replace(/\.html$/, '');
    return p === '' ? 'index' : p;
  }
  var SLUG = slug();

  // ── keys ────────────────────────────────────────────────────────────────
  function keyOf(el) {
    if (el.dataset && el.dataset.cms) return 'k:' + el.dataset.cms;
    var parts = [];
    while (el && el !== document.body && el.nodeType === 1) {
      var tag = el.tagName.toLowerCase(), i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) i++;
      parts.unshift(tag + ':' + i);
      el = el.parentElement;
    }
    return parts.join('>');
  }
  function find(key) {
    if (key.indexOf('k:') === 0) return document.querySelector('[data-cms="' + key.slice(2).replace(/"/g, '') + '"]');
    var el = document.body, parts = key.split('>');
    for (var p = 0; p < parts.length && el; p++) {
      var m = parts[p].match(/^([a-z0-9-]+):(\d+)$/); if (!m) return null;
      var n = +m[2], hit = null;
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (c.tagName.toLowerCase() === m[1] && --n === 0) { hit = c; break; }
      }
      el = hit;
    }
    return el;
  }
  function skipped(el) { return !el || !el.closest || !!el.closest(SKIP); }

  // ── sanitiser (admin-authored, but defend in depth) ─────────────────────
  function clean(html) {
    var doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('*').forEach(function (n) {
      [].slice.call(n.attributes).forEach(function (a) {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      });
    });
    return doc.body.firstChild.innerHTML;
  }
  function safeUrl(u) { return /^\s*javascript:/i.test(u || '') ? '#' : u; }

  // ── apply ───────────────────────────────────────────────────────────────
  var ORIGINAL = {};
  function remember(key, el) {
    if (ORIGINAL[key]) return;
    ORIGINAL[key] = { h: el.innerHTML, src: el.getAttribute('src'), href: el.getAttribute('href'), display: el.style.display };
  }
  function apply(overrides, meta) {
    overrides = overrides || {};
    Object.keys(overrides).forEach(function (key) {
      var el = find(key), o = overrides[key]; if (!el || skipped(el) || !o) return;
      remember(key, el);
      if (o.h != null && el.tagName !== 'IMG') el.innerHTML = clean(o.h);
      if (o.src != null && el.tagName === 'IMG') { el.src = safeUrl(o.src); el.removeAttribute('srcset'); }
      if (o.href != null && el.tagName === 'A') el.setAttribute('href', safeUrl(o.href));
      if (o.hide) el.style.display = EDIT ? '' : 'none';
      if (EDIT) el.classList.toggle('cms-hidden', !!o.hide);
    });
    if (meta) {
      if (meta.title) document.title = meta.title;
      if (meta.description) {
        var m = document.querySelector('meta[name="description"]');
        if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
        m.setAttribute('content', meta.description);
      }
    }
  }

  function fetchPage() {
    if (!SB_URL || !SB_KEY) return Promise.resolve(null);
    return fetch(SB_URL + '/rest/v1/pages?slug=eq.' + encodeURIComponent(SLUG) + '&select=sections', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }
    }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return (rows && rows[0] && rows[0].sections) || {}; })
      .catch(function () { return null; });
  }

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  // ═══ PUBLIC MODE ═════════════════════════════════════════════════════════
  if (!EDIT) {
    var CK = 'bana_cms_' + SLUG, cached = null;
    try { cached = JSON.parse(localStorage.getItem(CK) || 'null'); } catch (e) {}
    ready(function () {
      if (cached) apply(cached.o, cached.m);
      fetchPage().then(function (s) {
        if (!s) return;
        var o = s.cms_published || {}, m = s.cms_meta || {};
        try { localStorage.setItem(CK, JSON.stringify({ o: o, m: m })); } catch (e) {}
        if (!cached || JSON.stringify(cached.o) !== JSON.stringify(o) || JSON.stringify(cached.m) !== JSON.stringify(m)) apply(o, m);
      });
    });
    return;
  }

  // ═══ EDIT MODE ═══════════════════════════════════════════════════════════
  var CHANGES = {};   // key → {h,src,href,hide}
  var current = null, bar = null;

  function post(msg) { window.parent.postMessage(Object.assign({ source: 'bana-cms' }, msg), location.origin); }
  function dirty() { post({ type: 'cms:dirty', count: Object.keys(CHANGES).length }); }
  function set(key, patch) { CHANGES[key] = Object.assign({}, CHANGES[key] || {}, patch); dirty(); }

  function css() {
    var st = document.createElement('style'); st.className = 'cms-ui';
    st.textContent =
      '.cms-hover{outline:2px dashed #0a7a55!important;outline-offset:2px;cursor:text!important}' +
      'img.cms-hover{cursor:pointer!important}' +
      '.cms-active{outline:2px solid #0a7a55!important;outline-offset:2px;background:rgba(10,122,85,.06)!important}' +
      '.cms-edited{box-shadow:inset 0 0 0 9999px rgba(197,160,40,.08)}' +
      '.cms-hidden{opacity:.25!important;outline:2px dashed #b3261e!important}' +
      '.cms-bar{position:fixed;z-index:2147483647;display:flex;gap:4px;padding:4px;background:#0f1f1a;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:600 12px/1 system-ui,sans-serif}' +
      '.cms-bar button{all:unset;cursor:pointer;color:#fff;padding:7px 10px;border-radius:6px}.cms-bar button:hover{background:#ffffff22}' +
      '.cms-tag{color:#8fd3b6;padding:7px 8px 7px 6px;text-transform:uppercase;letter-spacing:.06em;font-size:10px}';
    document.head.appendChild(st);
  }

  function editableTarget(t) {
    while (t && t !== document.body) {
      if (skipped(t)) return null;
      if (t.tagName === 'IMG') return t;
      if (TEXT_TAGS.test(t.tagName)) {
        for (var n = t.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.textContent.trim()) return t;
        if (/^(A|BUTTON)$/.test(t.tagName) && t.textContent.trim()) return t;
      }
      t = t.parentElement;
    }
    return null;
  }

  function hideBar() { if (bar) bar.style.display = 'none'; }
  function showBar(el) {
    if (!bar) { bar = document.createElement('div'); bar.className = 'cms-bar cms-ui'; document.body.appendChild(bar); }
    var key = keyOf(el), link = el.tagName === 'A' ? el : el.closest('a');
    var html = '<span class="cms-tag">' + el.tagName.toLowerCase() + '</span>';
    if (el.tagName === 'IMG') html += '<button data-a="img">Change image</button>';
    if (link && !skipped(link)) html += '<button data-a="link">Edit link</button>';
    html += '<button data-a="hide">' + (CHANGES[key] && CHANGES[key].hide ? 'Show' : 'Hide') + '</button>';
    if (CHANGES[key]) html += '<button data-a="reset">Reset</button>';
    html += '<button data-a="done">Done</button>';
    bar.innerHTML = html;
    var r = el.getBoundingClientRect();
    bar.style.display = 'flex';
    bar.style.top = Math.max(8, r.top - 42) + 'px';
    bar.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 320)) + 'px';
    bar.onmousedown = function (e) { e.preventDefault(); };
    bar.onclick = function (e) {
      var a = e.target.getAttribute('data-a'); if (!a) return;
      if (a === 'img') pickImage(el);
      if (a === 'link') {
        var k = keyOf(link), v = prompt('Link URL', link.getAttribute('href') || '');
        if (v != null) { remember(k, link); link.setAttribute('href', v); set(k, { href: v }); link.classList.add('cms-edited'); }
      }
      if (a === 'hide') { remember(key, el); var h = !(CHANGES[key] && CHANGES[key].hide); set(key, { hide: h }); el.classList.toggle('cms-hidden', h); showBar(el); }
      if (a === 'reset') {
        var o = ORIGINAL[key];
        if (o) { if (el.tagName === 'IMG') el.setAttribute('src', o.src || ''); else el.innerHTML = o.h; if (o.href != null) el.setAttribute('href', o.href); }
        delete CHANGES[key]; el.classList.remove('cms-edited', 'cms-hidden'); dirty(); deactivate();
      }
      if (a === 'done') deactivate();
    };
  }

  function pickImage(img) {
    var key = keyOf(img);
    post({ type: 'cms:pick-image', key: key, current: img.getAttribute('src') || '' });
  }

  function activate(el) {
    if (current === el) return;
    deactivate();
    current = el; el.classList.add('cms-active');
    var key = keyOf(el); remember(key, el);
    if (el.tagName !== 'IMG') {
      el.setAttribute('contenteditable', 'true'); el.focus();
      el.oninput = function () { set(key, { h: el.innerHTML }); el.classList.add('cms-edited'); };
    }
    showBar(el);
  }
  function deactivate() {
    if (!current) return hideBar();
    current.classList.remove('cms-active'); current.removeAttribute('contenteditable'); current.oninput = null;
    current = null; hideBar();
  }

  ready(function () {
    css();
    // Block navigation + forms while editing
    document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
    document.addEventListener('mouseover', function (e) {
      var t = editableTarget(e.target);
      document.querySelectorAll('.cms-hover').forEach(function (n) { if (n !== t) n.classList.remove('cms-hover'); });
      if (t && t !== current) t.classList.add('cms-hover');
    }, true);
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.cms-ui')) return;
      var a = e.target.closest && e.target.closest('a,button');
      if (a) e.preventDefault();
      var t = editableTarget(e.target);
      if (!t) { deactivate(); return; }
      e.preventDefault(); e.stopPropagation();
      if (t.tagName === 'IMG') { deactivate(); current = t; t.classList.add('cms-active'); showBar(t); return; }
      activate(t);
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') deactivate(); }, true);
    window.addEventListener('scroll', function () { if (current) showBar(current); }, { passive: true });

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.source !== 'bana-admin') return;
      var d = e.data;
      if (d.type === 'cms:load') {
        CHANGES = JSON.parse(JSON.stringify(d.overrides || {}));
        apply(CHANGES, d.meta);
        Object.keys(CHANGES).forEach(function (k) { var el = find(k); if (el) el.classList.add('cms-edited'); });
        dirty();
      }
      if (d.type === 'cms:collect') {
        deactivate();
        post({ type: 'cms:changes', requestId: d.requestId, overrides: CHANGES, title: document.title,
               description: (document.querySelector('meta[name="description"]') || {}).content || '' });
      }
      if (d.type === 'cms:set-image') {
        var img = find(d.key); if (!img) return;
        remember(d.key, img); img.setAttribute('src', d.url); img.removeAttribute('srcset');
        set(d.key, { src: d.url }); img.classList.add('cms-edited');
      }
    });
    post({ type: 'cms:ready', slug: SLUG, title: document.title,
           description: (document.querySelector('meta[name="description"]') || {}).content || '' });
  });
})();
