/* BANAHUB Admin OS — LinkedIn-style shell.
 * Top bar: logo · search · section tabs (Home, Investors, Companies, Deals, Members, Content, Admin) · alerts · Me.
 * Slim left menu: the pages of the active section. Overlapping pages are merged into one menu entry with tabs.
 * Built from the existing menu buttons, so role permissions and badge counts carry over. Nothing is deleted:
 * hidden pages stay in the code and their data stays in the database.
 */
(function () {
  'use strict';
  if (window.__LK) return; window.__LK = true;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Item = 'panel' | ['panel', 'Label override'] | { label, icon, tabs: [[panel, tabLabel], …] }
  const SECTIONS = [
    { id: 'home', icon: 'home', label: 'Home', items: [
      { label: 'Home', icon: 'space_dashboard', tabs: [['os-revenue', 'Revenue'], ['os-dashboard', 'Sales pipeline'], ['dashboard', 'Website & members']] },
      'os-tasks', 'activity', 'notifications'] },
    { id: 'investors', icon: 'account_balance', label: 'Investors', items: [
      { label: 'Investors Database', icon: 'account_balance', tabs: [['investors', 'Database'], ['os-investors', 'CRM & relationships'], ['os-matching', 'Matching']] },
      'access', 'os-datarooms'] },
    { id: 'companies', icon: 'domain', label: 'Companies', items: [
      { label: 'Companies', icon: 'domain', tabs: [['os-companies', 'Accounts'], ['businesses', 'Businesses'], ['os-fundraisers', 'Fundraising']] },
      'os-contacts', 'os-opps',
      { label: 'Partners', icon: 'handshake', tabs: [['os-partners', 'Industry partners'], ['partners', 'Sponsors & ecosystem'], ['providers', 'Solution providers']] }] },
    { id: 'deals', icon: 'rocket_launch', label: 'Deals', items: [
      { label: 'Capital Command Centre', icon: 'rocket_launch', tabs: [['os-capital', 'Overview'], ['os-cap-analytics', 'Analytics']] },
      { label: 'Deal Pipeline', icon: 'view_kanban', tabs: [['os-deals', 'Pipeline'], ['capital', 'Capital raises'], ['os-submissions', 'Member submissions']] },
      'os-campaigns', 'os-meetings'] },
    { id: 'members', icon: 'group', label: 'Members', items: [
      ['users', 'Members'],
      { label: 'Membership', icon: 'card_membership', tabs: [['os-membership', 'Overview'], ['memberships', 'Sign-ups & subscriptions'], ['applications', 'Applications']] },
      'kyc', 'os-payments', 'pricing', 'enquiries'] },
    { id: 'content', icon: 'edit_note', label: 'Content', items: ['pages', 'blog', 'events', 'media', 'programs', 'growth', 'emails', 'seo'] },
    { id: 'admin', icon: 'admin_panel_settings', label: 'Admin', items: ['settings', 'admins', 'os-roles', 'os-agentctl'] },
  ];
  const HIDDEN = new Set(['payments', 'os-pitch']);          // hidden from the menu (user's choice)
  const REDIRECT = { payments: 'os-payments' };               // old page → merged page

  // ---- read the original menu (permissions + labels + icons + badges) ----
  function orig() {
    const m = {};
    document.querySelectorAll('#sidebar .nav-group .nav-item, #sidebar .nav-item').forEach((b) => {
      const k = ((b.getAttribute('onclick') || '').match(/nav\('([^']+)'\)/) || [])[1];
      if (!k || b.closest('#lk-side')) return;
      const hidden = b.style.display === 'none' || b.hidden || (b.closest('.nav-group') && b.closest('.nav-group').style.display === 'none');
      const icon = (b.querySelector('.nav-icon, .material-symbols-outlined') || {}).textContent || 'circle';
      const badgeEl = b.querySelector('.nav-badge-count, [class*=badge]');
      const badge = badgeEl && badgeEl.style.display !== 'none' ? parseInt(badgeEl.textContent, 10) || 0 : 0;
      const label = [...b.childNodes].filter((n) => !(n.nodeType === 1 && (n.classList.contains('material-symbols-outlined') || /badge/.test(n.className)))).map((n) => n.textContent).join(' ').trim().replace(/\s+/g, ' ');
      m[k] = { k, ok: !hidden, icon: icon.trim(), label, badge };
    });
    return m;
  }
  const PM = (k) => (typeof panelMeta !== 'undefined' && panelMeta[k]) || null;

  // resolve the structure against what this admin can see
  function model() {
    const o = orig(), used = new Set(), secs = [];
    SECTIONS.forEach((s) => {
      const items = [];
      s.items.forEach((it) => {
        if (typeof it === 'string' || Array.isArray(it)) {
          const k = Array.isArray(it) ? it[0] : it; used.add(k);
          if (!o[k] || !o[k].ok || HIDDEN.has(k)) return;
          items.push({ key: k, label: (Array.isArray(it) && it[1]) || o[k].label || (PM(k) || [k])[0], icon: o[k].icon, tabs: null, badge: o[k].badge });
        } else {
          it.tabs.forEach((t) => used.add(t[0]));
          const tabs = it.tabs.filter((t) => o[t[0]] && o[t[0]].ok && !HIDDEN.has(t[0]));
          if (!tabs.length) return;
          items.push({ key: tabs[0][0], label: it.label, icon: it.icon, tabs, badge: tabs.reduce((n, t) => n + o[t[0]].badge, 0) });
        }
      });
      secs.push({ ...s, items });
    });
    // any page added later that isn't mapped yet → Admin › More (never silently lost)
    const extra = Object.values(o).filter((x) => x.ok && !used.has(x.k) && !HIDDEN.has(x.k) && x.k !== 'profile');
    if (extra.length) secs[secs.length - 1].items.push(...extra.map((x) => ({ key: x.k, label: x.label, icon: x.icon, tabs: null, badge: x.badge })));
    return secs.filter((s) => s.items.length);
  }
  function locate(secs, k) {
    for (const s of secs) for (const it of s.items) if (it.key === k || (it.tabs && it.tabs.some((t) => t[0] === k))) return { s, it };
    return null;
  }

  // ---- build the shell ----
  let S = { secs: [], cur: null, sec: null };
  function build() {
    if ($('lk-top')) return;
    document.body.classList.add('lk');
    const tb = document.querySelector('.topbar'), side = $('sidebar');
    const top = document.createElement('div'); top.id = 'lk-top'; top.className = 'lk-top';
    top.innerHTML = '<div class="lk-left"></div><nav class="lk-tabs" id="lk-tabs" aria-label="Sections"></nav><div class="lk-right"></div>';
    tb.appendChild(top);
    const left = top.querySelector('.lk-left'), right = top.querySelector('.lk-right');
    const mob = $('mob-toggle'); if (mob) left.appendChild(mob);
    const logo = document.createElement('button'); logo.className = 'lk-logo'; logo.type = 'button'; logo.setAttribute('aria-label', 'Home');
    logo.innerHTML = '<img src="logo.png" alt="BANAHUB"/>'; logo.onclick = () => go('os-revenue'); left.appendChild(logo);
    const sr = document.createElement('div'); sr.className = 'lk-search'; sr.setAttribute('role', 'search');
    sr.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">search</span><input id="lk-q" type="search" autocomplete="off" placeholder="Search pages, investors…" aria-label="Search Admin OS"/><div class="lk-sres" id="lk-sres" hidden></div>';
    left.appendChild(sr);
    // keep the original alert / refresh / sign-out buttons (ids and handlers intact)
    tb.querySelectorAll('.topbar-right .tb-btn').forEach((b) => right.appendChild(b));
    const me = document.createElement('button'); me.type = 'button'; me.className = 'lk-me'; me.title = 'My profile';
    me.innerHTML = `<span class="lk-av">${esc(($('av-initial') || {}).textContent || 'A')}</span><span class="lk-tl">Me</span>`; me.onclick = () => go('profile');
    right.insertBefore(me, right.firstChild);

    const nav2 = document.createElement('div'); nav2.id = 'lk-side'; nav2.className = 'lk-side';
    const hdr = side.querySelector('.sidebar-header'); hdr.after(nav2);
    const head = document.createElement('div'); head.id = 'lk-head'; head.className = 'lk-head';
    const main = $('main-content'); main.insertBefore(head, main.firstChild);

    const q = $('lk-q');
    q.addEventListener('input', () => search(q.value));
    q.addEventListener('keydown', (e) => {
      const r = $('lk-sres'), items = [...r.querySelectorAll('button')]; let i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { q.value = ''; r.hidden = true; }
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[0].focus(); }
      if (e.key === 'Enter' && items.length) { e.preventDefault(); items[0].click(); }
    });
    $('lk-sres').addEventListener('keydown', (e) => {
      const items = [...$('lk-sres').querySelectorAll('button')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); i <= 0 ? q.focus() : items[i - 1].focus(); }
      if (e.key === 'Escape') { $('lk-sres').hidden = true; q.focus(); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.lk-search')) $('lk-sres').hidden = true; });
  }

  function search(v) {
    const r = $('lk-sres'); v = v.trim().toLowerCase();
    if (!v) { r.hidden = true; return; }
    const hits = [];
    S.secs.forEach((s) => s.items.forEach((it) => {
      (it.tabs || [[it.key, '']]).forEach((t) => {
        const name = it.tabs ? `${it.label} › ${t[1]}` : it.label, sub = (PM(t[0]) || ['', ''])[1];
        if ((name + ' ' + s.label + ' ' + sub).toLowerCase().includes(v)) hits.push({ k: t[0], name, sec: s.label, icon: it.icon });
      });
    }));
    const can = (k) => S.secs.some((s) => s.items.some((it) => it.key === k || (it.tabs || []).some((t) => t[0] === k)));
    const acts = [];
    if (can('investors')) acts.push({ act: 'inv', name: `Search investors for “${v}”`, icon: 'account_balance' });
    if (can('os-companies')) acts.push({ act: 'co', name: `Search companies for “${v}”`, icon: 'domain' });
    r.innerHTML = acts.map((a) => `<button type="button" data-act="${a.act}"><span class="material-symbols-outlined">${a.icon}</span><b>${esc(a.name)}</b></button>`).join('') +
      hits.slice(0, 8).map((h) => `<button type="button" data-k="${esc(h.k)}"><span class="material-symbols-outlined">${esc(h.icon)}</span>${esc(h.name)}<small>${esc(h.sec)}</small></button>`).join('') +
      (hits.length || acts.length ? '' : '<div class="lk-empty">No matching pages</div>');
    r.hidden = false;
    r.querySelectorAll('button').forEach((b) => b.onclick = () => {
      r.hidden = true; const raw = $('lk-q').value.trim(); $('lk-q').value = '';
      if (b.dataset.k) return go(b.dataset.k);
      if (b.dataset.act === 'inv') { go('investors'); setTimeout(() => { const i = $('inv-search'); if (i) { i.value = raw; i.dispatchEvent(new Event('input')); i.focus(); } }, 50); }
      if (b.dataset.act === 'co') { go('os-companies'); setTimeout(() => { const i = document.querySelector('#panel-os-companies input[type=search], #panel-os-companies input'); if (i) { i.value = raw; i.dispatchEvent(new Event('input')); i.focus(); } }, 400); }
    });
  }

  function go(k) { window.nav(k); }

  const badge = (n) => n > 0 ? `<span class="lk-badge">${n > 99 ? '99+' : n}</span>` : '';
  function render() {
    if (!$('lk-top')) return;
    S.secs = model();
    const loc = locate(S.secs, S.cur) || (S.sec && { s: S.secs.find((s) => s.id === S.sec) }) || { s: S.secs[0] };
    const sec = loc.s || S.secs[0]; if (!sec) return; S.sec = sec.id;
    $('lk-tabs').innerHTML = S.secs.map((s) => `<button type="button" class="lk-tab${s.id === sec.id ? ' on' : ''}" data-s="${s.id}" ${s.id === sec.id ? 'aria-current="page"' : ''}>
      <span class="lk-ic"><span class="material-symbols-outlined">${s.icon}</span>${badge(s.items.reduce((n, it) => n + it.badge, 0))}</span><span class="lk-tl">${esc(s.label)}</span></button>`).join('');
    $('lk-tabs').querySelectorAll('.lk-tab').forEach((b) => b.onclick = () => { const s = S.secs.find((x) => x.id === b.dataset.s); go(s.items[0].key); });
    $('lk-side').innerHTML = `<div class="lk-sec">${esc(sec.label)}</div>` + sec.items.map((it) => {
      const on = loc.it === it;
      return `<button type="button" class="lk-item${on ? ' on' : ''}" data-k="${esc(it.key)}" ${on ? 'aria-current="page"' : ''}><span class="material-symbols-outlined">${esc(it.icon)}</span><span>${esc(it.label)}</span>${badge(it.badge)}</button>`;
    }).join('');
    $('lk-side').querySelectorAll('.lk-item').forEach((b) => b.onclick = () => go(b.dataset.k));
    // page header: breadcrumb + merged-page tabs; on phones also the section's pages as chips
    const it = loc.it, meta = PM(S.cur) || ['', ''];
    $('lk-head').innerHTML = `<div class="lk-crumb">${esc(sec.label)}${it ? ' <span>›</span> ' + esc(it.label) : ''}${meta[1] ? `<em>${esc(meta[1])}</em>` : ''}</div>` +
      `<div class="lk-chips" role="tablist" aria-label="${esc(sec.label)} pages">${sec.items.map((x) => `<button type="button" role="tab" class="${loc.it === x ? 'on' : ''}" data-k="${esc(x.key)}">${esc(x.label)}${badge(x.badge)}</button>`).join('')}</div>` +
      (it && it.tabs && it.tabs.length > 1 ? `<div class="lk-ptabs" role="tablist">${it.tabs.map((t) => `<button type="button" role="tab" class="${t[0] === S.cur ? 'on' : ''}" aria-selected="${t[0] === S.cur}" data-k="${esc(t[0])}">${esc(t[1])}${badge((orig()[t[0]] || {}).badge || 0)}</button>`).join('')}</div>` : '');
    $('lk-head').querySelectorAll('button[data-k]').forEach((b) => b.onclick = () => go(b.dataset.k));
  }

  // ---- hook navigation ----
  function hook() {
    const prev = window.nav;
    if (!prev || prev.__lk) return;
    const wrapped = function (k) { if (REDIRECT[k]) k = REDIRECT[k]; const r = prev.apply(this, [k]); S.cur = k; render(); try { $('main-content').scrollTop = 0; } catch (e) { } return r; };
    wrapped.__lk = true; window.nav = wrapped;
  }

  let t;
  function soon(recs) { if (recs && recs.every((r) => r.target.closest ? r.target.closest('#lk-side') : (r.target.parentElement && r.target.parentElement.closest('#lk-side')))) return; clearTimeout(t); t = setTimeout(render, 150); }
  function start() {
    const shell = $('os-shell'); if (!shell || !document.querySelector('.topbar') || !$('sidebar')) return;
    build(); hook();
    S.cur = (typeof currentPanel !== 'undefined' && currentPanel) || 'dashboard';
    render();
    // badges and permission changes arrive later (roles load, modules inject menu items) — follow them
    new MutationObserver(soon).observe($('sidebar'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
    const av = $('av-initial'); if (av) new MutationObserver(() => { const m = document.querySelector('.lk-av'); if (m) m.textContent = av.textContent; }).observe(av, { childList: true, characterData: true, subtree: true });
  }
  // after every other module has wrapped nav/loadPanel
  if (document.readyState === 'complete') setTimeout(start, 0); else window.addEventListener('load', () => setTimeout(start, 0));
})();
