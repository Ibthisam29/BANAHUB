/* BANAHUB growth layer (public site) — loaded by nav.js on every public page.
 * • First-touch attribution: utm_* , ?ref= (member referral code), referrer → localStorage; landing event when campaign/ref present
 * • Founding-member banner (site_settings.growth, editable in Admin OS → Growth)
 * • Newsletter sign-up block in the footer ("Monthly ASEAN market & capital brief")
 * • window.BHGrowth.capture(event, data) — used by /readiness, register and roundtable forms
 * No third-party trackers, no cookies; data goes only to BANAHUB's own database.
 */
(function () {
  'use strict';
  if (window.BHGrowth) return;
  var LS = 'bh_attr_v1', ST = { settings: null };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  // ---- attribution (first touch wins; a new ref/utm visit refreshes it) ----
  var q = new URLSearchParams(location.search), utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { var v = q.get(k); if (v) utm[k.slice(4)] = v.slice(0, 100); });
  var ref = (q.get('ref') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  var ext = document.referrer && document.referrer.indexOf(location.host) === -1 ? document.referrer.slice(0, 300) : '';
  var attr = store(LS) || null;
  if (!attr || ref || Object.keys(utm).length) {
    attr = { utm: Object.keys(utm).length ? utm : (attr && attr.utm) || null, ref: ref || (attr && attr.ref) || null, referrer: ext || (attr && attr.referrer) || null, page: location.pathname, at: new Date().toISOString() };
    store(LS, attr);
  }

  function sb() { return window.getBanaSupabaseClient ? window.getBanaSupabaseClient() : Promise.reject(new Error('offline')); }
  async function capture(event, data) {
    data = data || {};
    var a = store(LS) || {};
    var p = Object.assign({ event: event, utm: a.utm || undefined, ref: a.ref || undefined, referrer: a.referrer || undefined, page: location.pathname + location.search.slice(0, 120) }, data);
    try {
      var c = await sb();
      var r = await c.rpc('growth_capture', { p: p });
      if (r.error) throw r.error;
      if (r.data === false) throw new Error('rejected');
      return true;
    } catch (e) {
      // fallbacks if the growth function is unavailable: keep the subscriber and the lead
      var ok = false;
      if ((event === 'newsletter' || data.newsletter === 'true') && data.email) {
        try { var c2 = await sb(); var r2 = await c2.from('newsletter_subscribers').insert({ email: String(data.email).trim().toLowerCase(), name: data.name || null, is_active: true }); if (!r2.error || /duplicate/i.test(r2.error.message)) ok = true; } catch (e2) { }
      }
      if (data.email && event !== 'newsletter' && event !== 'signup') {
        try {
          var c3 = await sb();
          var r3 = await c3.from('enquiries').insert({ name: (data.name || '').slice(0, 200) || null, email: String(data.email).trim().toLowerCase(), company: (data.company || '').slice(0, 300) || null, type: event, source: 'website:' + event,
            message: event === 'readiness' ? 'Investor-readiness check: score ' + data.score + ' (' + ((data.answers || {}).band || '') + ')' + ((data.answers || {}).roundtable ? ' · requests roundtable invitation' : '') : 'Roundtable invitation request',
            data: { score: data.score, answers: data.answers, utm: p.utm, ref: p.ref }, page_url: location.href.slice(0, 500) });
          if (!r3.error) ok = true;
        } catch (e3) { }
      }
      return ok;
    }
  }
  if ((ref || Object.keys(utm).length) && !sessionStorage.getItem('bh_landed')) { try { sessionStorage.setItem('bh_landed', '1'); } catch (e) { } capture('landing', {}); }

  // ---- settings ----
  async function settings() {
    if (ST.settings) return ST.settings;
    try { var c = await sb(); var r = await c.from('site_settings').select('value').eq('key', 'growth').maybeSingle(); ST.settings = (r.data && r.data.value) || {}; }
    catch (e) { ST.settings = {}; }
    return ST.settings;
  }

  // ---- styles ----
  var css = document.createElement('style');
  css.textContent =
    '.bhg-banner{position:relative;z-index:40;background:#00281e;color:#fff;font:600 13.5px/1.45 Manrope,system-ui,sans-serif;padding:10px 44px 10px 16px;text-align:center}' +
    '.bhg-banner a{color:#e9c349;text-decoration:underline;text-underline-offset:3px;margin-left:8px;white-space:nowrap}' +
    '.bhg-banner button{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;color:rgba(255,255,255,.8);font-size:18px;cursor:pointer;padding:6px 10px;min-height:36px}' +
    '.bhg-news{border-top:1px solid rgba(255,255,255,.14);border-bottom:1px solid rgba(255,255,255,.14);margin:28px 0 8px;padding:24px 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:24px;align-items:center}' +
    '.bhg-news h4{color:#fff;font:600 1.25rem Newsreader,Georgia,serif;margin:0 0 6px;text-transform:none;letter-spacing:0}.bhg-news p{margin:0;font-size:13.5px}' +
    '.bhg-news form{display:flex;gap:8px;flex-wrap:wrap}.bhg-news input{flex:1 1 180px;min-height:44px;border-radius:10px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.06);color:#fff;padding:0 14px;font:500 14px Manrope,sans-serif}' +
    '.bhg-news input::placeholder{color:rgba(255,255,255,.6)}.bhg-news button{min-height:44px;border-radius:10px;border:0;background:#e9c349;color:#00281e;font:800 14px Manrope,sans-serif;padding:0 18px;cursor:pointer}' +
    '.bhg-news .msg{flex-basis:100%;font-size:13px;color:#e9c349;min-height:1em}' +
    '@media(max-width:760px){.bhg-news{grid-template-columns:1fr}.bhg-banner{font-size:12.5px;text-align:left}}';
  document.head.appendChild(css);

  async function banner() {
    var s = await settings();
    if (!s.banner_on || !s.banner_text) return;
    if (/^\/(dashboard|admin|billing|login|reset|payment|unsubscribe|readiness)/.test(location.pathname)) return;
    try { if (sessionStorage.getItem('bhg_banner_x') === String(s.banner_text).length + '') return; } catch (e) { }
    var b = document.createElement('div'); b.className = 'bhg-banner'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Announcement');
    b.innerHTML = esc(s.banner_text) + (s.banner_link ? '<a href="' + esc(s.banner_link) + '">' + esc(s.banner_cta || 'Learn more') + ' →</a>' : '') + '<button type="button" aria-label="Dismiss">×</button>';
    b.querySelector('button').onclick = function () { b.remove(); try { sessionStorage.setItem('bhg_banner_x', String(s.banner_text).length + ''); } catch (e) { } };
    document.body.insertBefore(b, document.body.firstChild);
  }

  async function newsletter() {
    var foot = document.querySelector('.bh-foot .bh-foot-top'); if (!foot || document.getElementById('bhg-news')) return;
    var s = await settings();
    var box = document.createElement('div'); box.className = 'bhg-news'; box.id = 'bhg-news';
    box.innerHTML = '<div><h4>The ASEAN market &amp; capital brief</h4><p>' + esc(s.newsletter_text || 'Monthly: market entry, funding activity and BANAHUB sessions. Unsubscribe any time.') + '</p></div>' +
      '<form novalidate><label class="sr-only" for="bhg-email" style="position:absolute;left:-9999px">Email</label><input id="bhg-email" type="email" autocomplete="email" placeholder="Work email" required/><button type="submit">Subscribe</button><div class="msg" aria-live="polite"></div></form>';
    foot.parentNode.insertBefore(box, foot.nextSibling);
    var f = box.querySelector('form');
    f.onsubmit = async function (e) {
      e.preventDefault();
      var em = f.querySelector('input').value.trim(), m = f.querySelector('.msg');
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(em)) { m.textContent = 'Enter a valid email address.'; return; }
      f.querySelector('button').disabled = true; m.textContent = 'Subscribing…';
      var ok = await capture('newsletter', { email: em });
      m.textContent = ok ? 'Subscribed — thank you. The next brief will reach your inbox.' : 'Could not subscribe right now — email hello@banahub.com.';
      if (ok) f.querySelector('input').value = ''; f.querySelector('button').disabled = false;
    };
  }

  window.BHGrowth = { capture: capture, settings: settings, attribution: function () { return store(LS) || {}; } };
  function init() { banner(); newsletter(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); }); else setTimeout(init, 0);
})();
