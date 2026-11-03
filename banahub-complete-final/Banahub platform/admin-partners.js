/* BANAHUB Admin OS — Industry Partners (Commercial OS group).
 * Law firms, accounting firms, banks, agencies, accelerators, corporates, service providers… categorised by
 * partner type, industry served, country and relationship status.
 * partners    = public profile (shown on the website when "Show on website" is ticked)
 * partner_crm = private relationship record (contacts, agreement, referrals, next action) — staff only (22_industry_partners.sql)
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const arr = v => Array.isArray(v) ? v : String(v || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);
  const OS = () => window.__OS || { perms: new Set(), people: [] };
  const can = p => OS().perms.has('*') || OS().perms.has(p);
  const sb = () => OS().sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; }
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const today = () => new Date(new Date().toDateString());

  const CATS = [['law_firm', 'Law firm'], ['accounting', 'Accounting / tax'], ['bank', 'Bank / financial institution'], ['government', 'Government / agency'], ['accelerator', 'Accelerator / incubator'],
    ['corporate', 'Corporate'], ['service_provider', 'Service provider'], ['investor_network', 'Investor network'], ['university', 'University / research'], ['association', 'Industry association / chamber'], ['media', 'Media'], ['other', 'Other']];
  const STATUS = [['prospect', 'Prospect', '#555', '#eee'], ['in_discussion', 'In discussion', '#7a5c00', '#fff4d6'], ['active', 'Active', '#0a5c40', '#e3f1e8'], ['paused', 'Paused', '#555', '#f0f0ee'], ['ended', 'Ended', '#8c1d18', '#fdecea']];
  const AGREE = [['', '—'], ['none', 'No agreement'], ['mou', 'MOU'], ['referral', 'Referral agreement'], ['revenue_share', 'Revenue share'], ['sponsorship', 'Sponsorship'], ['service_agreement', 'Service agreement'], ['co_delivery', 'Co-delivery'], ['other', 'Other']];
  const SERVICES = ['Company incorporation', 'Legal', 'Accounting / audit', 'Tax', 'Banking', 'Payments', 'Grants / incentives', 'Immigration / visas', 'HR / payroll / EOR', 'Real estate / office', 'Market research', 'Marketing / PR', 'Distribution / channel', 'Technology', 'Recruitment', 'Insurance', 'Capital / investment', 'Training / programmes'];
  const COUNTRIES = ['Singapore', 'Malaysia', 'Indonesia', 'Vietnam', 'Thailand', 'Philippines', 'UAE', 'Saudi Arabia', 'Qatar', 'Hong Kong', 'China', 'Japan', 'South Korea', 'India', 'Australia', 'United Kingdom', 'Europe', 'United States', 'Global'];
  const catLabel = c => (CATS.find(x => x[0] === c) || [c, c || 'Uncategorised'])[1];
  const stOf = s => STATUS.find(x => x[0] === s) || STATUS[0];
  const NONE = 'Not set';
  const DIMS = [['category', 'Partner type'], ['industry', 'Industry'], ['country', 'Country'], ['status', 'Status'], ['service', 'Service']];
  const P = { list: [], crm: {}, tax: [], group: 'category', f: { category: '', industry: '', country: '', status: '', service: '', q: '', ended: false } };
  const VAL = {
    category: p => [catLabel(p.category)],
    industry: p => arr(p.industries).length ? arr(p.industries) : [NONE],
    country: p => arr(p.countries).length ? arr(p.countries) : [NONE],
    status: p => [stOf((P.crm[p.id] || {}).status)[1]],
    service: p => arr(p.services).length ? arr(p.services) : [NONE],
  };
  const ORD = { category: CATS.map(c => c[1]), status: STATUS.map(s => s[1]), country: COUNTRIES, service: SERVICES };

  function inject() {
    if ($('panel-os-partners')) return true;
    const anchor = document.querySelector('[data-os-nav="os-companies"]') || document.querySelector(`#sidebar [onclick="nav('os-companies')"]`);
    if (!anchor) return false;
    anchor.insertAdjacentHTML('afterend', '<button class="nav-item" onclick="nav(\'os-partners\')" data-os-nav="os-partners"><span class="nav-icon material-symbols-outlined">handshake</span>Industry Partners<span class="nav-badge" id="nb-ip-od" style="display:none"></span></button>');
    $('panel-dashboard').parentNode.insertAdjacentHTML('beforeend', '<div id="panel-os-partners" class="panel"></div>');
    document.body.insertAdjacentHTML('beforeend', MODAL);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') panelMeta['os-partners'] = ['Industry Partners', 'By partner type, industry, country and relationship status'];
    $('ip-cat').innerHTML = '<option value="">—</option>' + CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('ip-status').innerHTML = STATUS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('ip-agree').innerHTML = AGREE.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const nb = $('nb-ip-od'); if (nb && !can('companies.read_all') && !OS().perms.has('*')) document.querySelector('[data-os-nav="os-partners"]').style.display = 'none';
    load().then(badge).catch(() => {});
    return true;
  }

  async function load() {
    const [list, crm, tax] = await Promise.all([
      q(sb().from('partners').select('*').order('name')),
      q(sb().from('partner_crm').select('*')).catch(() => []),
      P.tax.length ? P.tax : q(sb().from('industry_taxonomy').select('sector,industry,industry_ord,sector_ord').order('industry_ord').order('sector_ord')).catch(() => []),
    ]);
    P.list = list || []; P.crm = {}; (crm || []).forEach(c => { P.crm[c.partner_id] = c; }); P.tax = tax || [];
  }
  const overdue = c => c && c.next_action_date && new Date(c.next_action_date) < today() && !['ended'].includes(c.status);
  function badge() { const n = P.list.filter(p => overdue(P.crm[p.id])).length, el = $('nb-ip-od'); if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; } }

  function sortCats(d, cats) { const o = ORD[d]; if (d === 'industry') { const io = {}; P.tax.forEach(t => { io[t.industry] = t.industry_ord; }); return cats.sort((a, b) => (io[a] ?? 98) - (io[b] ?? 98) || a.localeCompare(b)); }
    return cats.sort((a, b) => (o && o.includes(a) ? o.indexOf(a) : 98) - (o && o.includes(b) ? o.indexOf(b) : 98) || a.localeCompare(b)); }
  function filtered(skip) {
    const f = P.f, qs = f.q.toLowerCase();
    return P.list.filter(p => (f.ended || (P.crm[p.id] || {}).status !== 'ended')
      && DIMS.every(([d]) => d === skip || !f[d] || VAL[d](p).includes(f[d]))
      && (!qs || [p.name, p.description, arr(p.sectors).join(' '), arr(p.services).join(' '), (P.crm[p.id] || {}).contact_name].join(' ').toLowerCase().includes(qs)));
  }
  const counts = (d, rows) => { const c = {}; rows.forEach(p => VAL[d](p).forEach(v => { c[v] = (c[v] || 0) + 1; })); return c; };
  const head = (t, s, a) => `<div class="page-header"><div><div class="page-title">${t}</div><div class="page-sub">${s}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${a || ''}</div></div>`;

  async function render() {
    const el = $('panel-os-partners'); el.innerHTML = head('Industry Partners', '') + '<div class="os-empty">Loading…</div>';
    try { await load(); } catch (e) { el.innerHTML = head('Industry Partners', '') + `<div class="card os-empty">${esc(e.message)}</div>`; return; }
    badge(); draw();
  }
  function draw() {
    const el = $('panel-os-partners'), f = P.f, rows = filtered(), g = P.group, gc = counts(g, rows), cats = sortCats(g, Object.keys(gc)).sort((a, b) => (a === NONE) - (b === NONE));
    const all = P.list.map(p => P.crm[p.id] || {});
    const kpi = (l, v, s, w) => `<div class="os-kpi${w ? ' os-kpi-warn' : ''}"><div class="os-kpi-l">${l}</div><div class="os-kpi-v">${v}</div>${s ? `<div class="os-kpi-s">${s}</div>` : ''}</div>`;
    const sel = d => { const c = counts(d, filtered(d)), o = sortCats(d, Object.keys(c)).sort((a, b) => (a === NONE) - (b === NONE)), lab = DIMS.find(x => x[0] === d)[1];
      return `<select class="f-input f-select" aria-label="${lab}" onchange="ipF('${d}',this.value)"><option value="">${lab}: all</option>${o.map(v => `<option value="${esc(v)}" ${v === f[d] ? 'selected' : ''}>${esc(v)} (${c[v]})</option>`).join('')}</select>`; };
    el.innerHTML = head('Industry Partners', 'Law, accounting, banking, government, accelerators, corporates and service providers we work with',
      `${can('companies.write') ? '<button class="btn btn-primary" onclick="ipEdit()">+ Add partner</button>' : ''}`) + `
      <div class="os-kpis">${[
        kpi('Active partners', all.filter(c => c.status === 'active').length, `${all.filter(c => c.status === 'in_discussion').length} in discussion`),
        kpi('Partners', P.list.length, `${P.list.filter(p => p.published).length} shown on the website`),
        kpi('Referrals received', all.reduce((a, c) => a + (c.referrals_in || 0), 0), 'from partners'),
        kpi('Referrals sent', all.reduce((a, c) => a + (c.referrals_out || 0), 0), 'to partners'),
        kpi('Agreements expiring', all.filter(c => c.agreement_end && new Date(c.agreement_end) >= today() && new Date(c.agreement_end) - today() < 60 * 864e5).length, 'in the next 60 days'),
        kpi('Overdue next actions', P.list.filter(p => overdue(P.crm[p.id])).length, '', P.list.some(p => overdue(P.crm[p.id]))),
      ].join('')}</div>
      <div class="fr-group"><span>Group by</span>${DIMS.map(([d, l]) => `<button class="${d === g ? 'on' : ''}" onclick="ipGroup('${d}')">${l}</button>`).join('')}</div>
      <div class="fr-cats">${cats.map(c => `<button class="fr-cat ${f[g] === c ? 'on' : ''}" onclick="ipF('${g}', ${esc(JSON.stringify(f[g] === c ? '' : c))})"><b>${gc[c]}</b><span>${esc(c)}</span><i>${rows.filter(p => VAL[g](p).includes(c) && (P.crm[p.id] || {}).status === 'active').length} active</i></button>`).join('') || '<div class="os-empty">No partners yet — add your first one.</div>'}</div>
      <div class="filter-bar" style="flex-wrap:wrap">${DIMS.map(([d]) => sel(d)).join('')}
        <input class="f-input" style="max-width:220px" placeholder="Search name, service, contact…" value="${esc(f.q)}" oninput="ipF('q',this.value)"/>
        <label style="font-size:12px;display:flex;align-items:center;gap:5px"><input type="checkbox" ${f.ended ? 'checked' : ''} onchange="ipF('ended',this.checked)"/> Include ended</label>
        ${DIMS.some(([d]) => f[d]) || f.q ? '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="ipClear()">Clear filters</button>' : ''}</div>
      <div class="card" style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Partner</th><th>Type · industry</th><th>Services · countries</th><th>Relationship</th><th>Referrals</th><th>Next action</th><th></th></tr></thead><tbody>
      ${rows.map(row).join('') || '<tr><td colspan="7"><div class="os-empty">No partners match these filters.</div></td></tr>'}</tbody></table></div>`;
  }
  function row(p) {
    const c = P.crm[p.id] || {}, s = stOf(c.status), od = overdue(c), owner = (OS().people || []).find(x => x.id === c.owner_id);
    return `<tr><td><div style="display:flex;gap:10px;align-items:center">${p.logo_url ? `<img src="${esc(p.logo_url)}" alt="" style="width:32px;height:32px;object-fit:contain;border-radius:6px;border:1px solid var(--border);background:#fff"/>` : ''}<div><b style="color:var(--ink)">${esc(p.name)}</b>
        <div class="cap-sub">${p.website ? `<a href="${esc(/^https?:\/\//.test(p.website) ? p.website : 'https://' + p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}${p.published ? ' · on website' : ''}</div></div></div></td>
      <td style="font-size:12px"><span class="fr-tag">${esc(catLabel(p.category))}</span><div class="cap-sub">${esc(arr(p.industries).join(', '))}</div></td>
      <td style="font-size:12px;max-width:240px">${esc(arr(p.services).slice(0, 4).join(', ') || '—')}${arr(p.services).length > 4 ? ` +${arr(p.services).length - 4}` : ''}<div class="cap-sub">${esc(arr(p.countries).join(', '))}</div></td>
      <td style="font-size:12px"><span class="bl-st ip-st" style="color:${s[2]};background:${s[3]}">${s[1]}</span>${c.agreement_type && c.agreement_type !== 'none' ? `<div class="cap-sub">${esc((AGREE.find(a => a[0] === c.agreement_type) || ['', ''])[1])}${c.agreement_end ? ' to ' + fmtD(c.agreement_end) : ''}</div>` : ''}${c.contact_name ? `<div class="cap-sub">${esc(c.contact_name)}${c.contact_title ? ', ' + esc(c.contact_title) : ''}</div>` : ''}${owner ? `<div class="cap-sub">Owner: ${esc(owner.full_name || owner.email)}</div>` : ''}</td>
      <td style="font-size:12px">${c.referrals_in || 0} in · ${c.referrals_out || 0} out${c.referral_fee_pct != null ? `<div class="cap-sub">${c.referral_fee_pct}% fee</div>` : ''}</td>
      <td style="font-size:12px">${c.next_action ? `<span style="${od ? 'color:#b3261e;font-weight:700' : ''}">${esc(c.next_action)}</span><div class="cap-sub">${fmtD(c.next_action_date)}</div>` : (c.status === 'active' || c.status === 'in_discussion') ? '<span class="os-flag">No next action</span>' : '—'}</td>
      <td><div style="display:flex;flex-direction:column;gap:4px">${can('companies.write') ? `<button class="btn btn-ghost fr-act" onclick="ipEdit('${p.id}')">Edit</button><button class="btn btn-ghost fr-act" onclick="ipRef('${p.id}','in')">+ Referral in</button><button class="btn btn-ghost fr-act" onclick="ipRef('${p.id}','out')">+ Referral out</button>` : ''}</div></td></tr>`;
  }

  // ── edit ─────────────────────────────────────────────────────────────────
  const checks = (id, opts, sel) => { $(id).innerHTML = opts.map(o => `<label class="fr-opt"><input type="checkbox" value="${esc(o)}" ${sel.includes(o) ? 'checked' : ''}/>${esc(o)}</label>`).join('') + sel.filter(s => !opts.includes(s)).map(o => `<label class="fr-opt"><input type="checkbox" value="${esc(o)}" checked/>${esc(o)}</label>`).join(''); };
  const ticked = id => [...document.querySelectorAll(`#${id} input:checked`)].map(c => c.value);
  function edit(id) {
    const p = P.list.find(x => x.id === id) || { published: false }, c = P.crm[id] || {};
    $('ip-id').value = id || ''; $('ip-h').textContent = id ? p.name : 'Add industry partner';
    const set = (k, v) => { $('ip-' + k).value = v == null ? '' : v; };
    set('name', p.name); set('cat', p.category || ''); set('web', p.website); set('logo', p.logo_url); set('desc', p.description); set('tier', p.tier || 'standard');
    $('ip-pub').checked = !!p.published;
    const by = {}; P.tax.forEach(t => { (by[t.industry] = by[t.industry] || []).push(t.sector); });
    const secs = arr(p.sectors), known = new Set(P.tax.map(t => t.sector));
    $('ip-sectors').innerHTML = Object.entries(by).map(([ind, ss]) => `<div class="fr-ind"><b>${esc(ind)}</b>${ss.map(s => `<label class="fr-opt"><input type="checkbox" value="${esc(s)}" ${secs.includes(s) ? 'checked' : ''}/>${esc(s)}</label>`).join('')}</div>`).join('')
      + (secs.some(s => !known.has(s)) ? `<div class="fr-ind"><b>Other</b>${secs.filter(s => !known.has(s)).map(s => `<label class="fr-opt"><input type="checkbox" value="${esc(s)}" checked/>${esc(s)}</label>`).join('')}</div>` : '');
    checks('ip-services', SERVICES, arr(p.services)); checks('ip-countries', COUNTRIES, arr(p.countries));
    set('status', c.status || 'prospect'); set('agree', c.agreement_type || ''); set('astart', c.agreement_start); set('aend', c.agreement_end); set('fee', c.referral_fee_pct);
    set('cname', c.contact_name); set('ctitle', c.contact_title); set('cemail', c.contact_email); set('cphone', c.contact_phone);
    $('ip-owner').innerHTML = '<option value="">Unassigned</option>' + (OS().people || []).map(x => `<option value="${x.id}" ${x.id === (c.owner_id || (!id ? OS().uid : '')) ? 'selected' : ''}>${esc(x.full_name || x.email)}</option>`).join('');
    set('na', c.next_action); set('nad', c.next_action_date); set('last', c.last_contact_at); set('rin', c.referrals_in || 0); set('rout', c.referrals_out || 0); set('val', c.value_generated); set('notes', c.notes);
    $('modal-ip').style.display = 'flex';
  }
  async function save() {
    const id = $('ip-id').value, v = k => $('ip-' + k).value.trim(), num = k => v(k) === '' ? null : Number(v(k));
    const pub = { name: v('name'), category: v('cat') || null, website: v('web') || null, logo_url: v('logo') || null, description: v('desc') || null, tier: v('tier') || 'standard',
      type: v('cat') ? catLabel(v('cat')) : 'Ecosystem Partner', published: $('ip-pub').checked, sectors: ticked('ip-sectors'), services: ticked('ip-services'), countries: ticked('ip-countries') };
    if (!pub.name) return notify('Enter the partner name', 'warn');
    if (pub.website && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(pub.website)) return notify('Check the website address', 'warn');
    if (pub.logo_url && !/^https:\/\//i.test(pub.logo_url)) return notify('Logo must be an https:// link', 'warn');
    const email = v('cemail');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return notify('Check the contact email', 'warn');
    const crm = { status: v('status') || 'prospect', agreement_type: v('agree') || null, agreement_start: v('astart') || null, agreement_end: v('aend') || null, referral_fee_pct: num('fee'),
      contact_name: v('cname') || null, contact_title: v('ctitle') || null, contact_email: email || null, contact_phone: v('cphone') || null, owner_id: v('owner') || null,
      next_action: v('na') || null, next_action_date: v('nad') || null, last_contact_at: v('last') || null, referrals_in: Math.max(0, Math.floor(num('rin') || 0)), referrals_out: Math.max(0, Math.floor(num('rout') || 0)),
      value_generated: num('val'), notes: v('notes') || null, updated_at: new Date().toISOString() };
    if (crm.referral_fee_pct != null && !(crm.referral_fee_pct >= 0 && crm.referral_fee_pct <= 100)) return notify('Referral fee must be 0–100%', 'warn');
    if (crm.agreement_start && crm.agreement_end && crm.agreement_end < crm.agreement_start) return notify('Agreement end is before its start', 'warn');
    if (crm.next_action && !crm.next_action_date) return notify('Give the next action a date', 'warn');
    const btn = $('ip-go'); btn.disabled = true;
    try {
      let pid = id;
      if (id) await q(sb().from('partners').update(pub).eq('id', id));
      else pid = (await q(sb().from('partners').insert(pub).select('id').single())).id;
      await q(sb().from('partner_crm').upsert({ partner_id: pid, ...crm }, { onConflict: 'partner_id' }));
      notify(id ? 'Partner saved' : 'Partner added'); closeModal('modal-ip'); render();
    } catch (e) { notify(e.message, 'warn'); } finally { btn.disabled = false; }
  }
  async function addRef(id, dir) {
    const c = P.crm[id] || {}, k = dir === 'in' ? 'referrals_in' : 'referrals_out';
    try { await q(sb().from('partner_crm').upsert({ partner_id: id, status: c.status || 'active', [k]: (c[k] || 0) + 1, last_contact_at: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }, { onConflict: 'partner_id' }));
      notify(dir === 'in' ? 'Referral received recorded' : 'Referral sent recorded'); render(); } catch (e) { notify(e.message, 'warn'); }
  }
  async function remove() {
    const id = $('ip-id').value; if (!id || !confirm('Delete this partner and its relationship record? This cannot be undone.')) return;
    try { await q(sb().from('partners').delete().eq('id', id)); notify('Partner deleted', 'warn'); closeModal('modal-ip'); render(); } catch (e) { notify(e.message, 'warn'); }
  }

  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'os-partners') { inject(); return render(); } return prev && prev(p); };
  Object.assign(window, { ipGroup: d => { P.group = d; draw(); }, ipF: (k, v) => { P.f[k] = v; draw(); }, ipClear: () => { Object.assign(P.f, { category: '', industry: '', country: '', status: '', service: '', q: '' }); draw(); },
    ipEdit: edit, ipSave: save, ipDelete: remove, ipRef: addRef, __IP: P });

  const MODAL = `<div id="modal-ip" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-ip')"><div class="modal modal-lg" style="max-width:860px">
    <div class="modal-header"><div><div class="modal-title" id="ip-h">Industry partner</div><div class="modal-sub">Public profile (optional on the website) and a private relationship record only staff can see</div></div><button class="modal-close" onclick="closeModal('modal-ip')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:12px"><input type="hidden" id="ip-id"/>
      <div class="fr-sec-h" style="border:0;padding:0">Profile</div>
      <div class="f-grid"><div class="f-group"><label class="f-label" for="ip-name">Partner name</label><input id="ip-name" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="ip-cat">Partner type</label><select id="ip-cat" class="f-input f-select"></select></div></div>
      <div class="f-grid"><div class="f-group"><label class="f-label" for="ip-web">Website</label><input id="ip-web" class="f-input" placeholder="example.com"/></div>
        <div class="f-group"><label class="f-label" for="ip-logo">Logo URL (https)</label><input id="ip-logo" class="f-input"/></div></div>
      <div class="f-group"><label class="f-label" for="ip-desc">Short description</label><textarea id="ip-desc" class="f-input" rows="2"></textarea></div>
      <div><div class="f-label">Industries served</div><div id="ip-sectors" class="fr-sectors"></div></div>
      <div><div class="f-label">Services</div><div id="ip-services" class="ip-grid"></div></div>
      <div><div class="f-label">Countries</div><div id="ip-countries" class="ip-grid"></div></div>
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><label class="fr-opt"><input type="checkbox" id="ip-pub"/> Show on the website (name, logo, description, type only)</label>
        <label class="f-label" for="ip-tier" style="margin:0">Tier</label><select id="ip-tier" class="f-input f-select" style="width:140px"><option value="standard">Standard</option><option value="strategic">Strategic</option><option value="premier">Premier</option></select></div>
      <div class="fr-sec-h">Relationship <span style="font-weight:600;text-transform:none;letter-spacing:0;color:var(--white-muted)">— private to staff</span></div>
      <div class="f-grid fr-g3"><div class="f-group"><label class="f-label" for="ip-status">Status</label><select id="ip-status" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="ip-agree">Agreement</label><select id="ip-agree" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="ip-fee">Referral fee %</label><input id="ip-fee" class="f-input" type="number" min="0" max="100" step="0.5"/></div>
        <div class="f-group"><label class="f-label" for="ip-astart">Agreement start</label><input id="ip-astart" class="f-input" type="date"/></div>
        <div class="f-group"><label class="f-label" for="ip-aend">Agreement end</label><input id="ip-aend" class="f-input" type="date"/></div>
        <div class="f-group"><label class="f-label" for="ip-owner">Relationship owner</label><select id="ip-owner" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="ip-cname">Contact name</label><input id="ip-cname" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="ip-ctitle">Contact title</label><input id="ip-ctitle" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="ip-cemail">Contact email</label><input id="ip-cemail" class="f-input" type="email"/></div>
        <div class="f-group"><label class="f-label" for="ip-cphone">Contact phone</label><input id="ip-cphone" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="ip-last">Last contact</label><input id="ip-last" class="f-input" type="date"/></div>
        <div class="f-group"><label class="f-label" for="ip-val">Value generated (SGD)</label><input id="ip-val" class="f-input" type="number" min="0" step="any"/></div>
        <div class="f-group"><label class="f-label" for="ip-rin">Referrals received</label><input id="ip-rin" class="f-input" type="number" min="0"/></div>
        <div class="f-group"><label class="f-label" for="ip-rout">Referrals sent</label><input id="ip-rout" class="f-input" type="number" min="0"/></div></div>
      <div class="f-grid"><div class="f-group"><label class="f-label" for="ip-na">Next action</label><input id="ip-na" class="f-input"/></div><div class="f-group"><label class="f-label" for="ip-nad">Date</label><input id="ip-nad" class="f-input" type="date"/></div></div>
      <div class="f-group"><label class="f-label" for="ip-notes">Notes</label><textarea id="ip-notes" class="f-input" rows="3"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" style="margin-right:auto;color:#b3261e" onclick="ipDelete()">Delete</button><button class="btn btn-ghost" onclick="closeModal('modal-ip')">Cancel</button><button class="btn btn-primary" id="ip-go" onclick="ipSave()">Save</button></div></div></div>`;
  const CSS = `.ip-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:2px 14px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;max-height:170px;overflow:auto}
  .ip-st{display:inline-block;font-size:10.5px;font-weight:700;border-radius:4px;padding:2px 7px}
  .fr-group{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:12px;color:var(--white-muted)}.fr-group span{margin-right:4px;font-weight:700}
  .fr-group button{border:1px solid var(--border);background:var(--card,#fff);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;color:var(--ink)}.fr-group button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .fr-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:14px}
  .fr-cat{text-align:left;border:1px solid var(--border);background:var(--card,#fff);border-radius:10px;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:2px}
  .fr-cat b{font-size:20px;color:var(--ink)}.fr-cat span{font-size:12px;font-weight:600;color:var(--ink)}.fr-cat i{font-style:normal;font-size:11px;color:var(--white-muted)}.fr-cat.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
  .fr-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:4px;padding:2px 7px;background:#e8eef7;color:#1d3d6b}
  .fr-act{padding:3px 8px!important;font-size:11.5px!important;min-height:0!important}
  .fr-sectors{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px 14px;max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:10px}
  .fr-ind b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--white-muted);margin-bottom:3px}
  .fr-opt{display:flex;align-items:center;gap:6px;font-size:12.5px;padding:2px 0;cursor:pointer}
  .fr-sec-h{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;border-top:1px solid var(--border);padding-top:12px}
  .fr-g3{grid-template-columns:repeat(3,minmax(0,1fr))!important}@media(max-width:700px){.fr-g3{grid-template-columns:1fr 1fr!important}}`;

  const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000);
})();
