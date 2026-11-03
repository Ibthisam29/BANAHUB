/* BANAHUB Admin OS — Fundraising Companies (Capital group).
 * Every company raising, categorised by industry, current stage, rounds raised, current raise size and
 * preferred investment instrument. Category columns (raise_band, rounds_band, rounds_raised, totals) are derived
 * in the database (20_fundraising_categories.sql); this screen reads deal_rooms and edits the fundraising profile.
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
  const FX = { USD: 1, SGD: 0.74, EUR: 1.08, GBP: 1.27, AED: 0.272, AUD: 0.66, HKD: 0.128, JPY: 0.0066, MYR: 0.22, IDR: 0.000063, INR: 0.012, CNY: 0.14 };
  const usd = (n, c) => n == null || n === '' ? null : Number(n) * (FX[String(c || 'USD').toUpperCase()] || 1);
  const short = n => { n = Number(n) || 0; const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)); };
  const money = (n, c) => n == null || n === '' ? '—' : `${c || 'USD'} ${short(n)}`;
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }) : '';

  const STAGES = ['Pre-seed', 'Seed', 'Pre-Series A', 'Series A', 'Series B', 'Series C+', 'Growth', 'Pre-IPO', 'Debt'];
  const ROUNDS = ['Friends & family', 'Angel', 'Pre-seed', 'Seed', 'Pre-Series A', 'Series A', 'Series B', 'Series C+', 'Bridge', 'Grant', 'Venture debt', 'Other'];
  const INSTR = ['Equity', 'Preferred equity', 'Convertible note', 'SAFE', 'Venture debt', 'Revenue-based financing', 'Private credit', 'Secondary sale', 'Open to discuss'];
  const BANDS = ['Under US$250k', 'US$250k–1M', 'US$1–3M', 'US$3–10M', 'US$10–25M', 'US$25M+'];
  const RBANDS = ['First raise', '1 prior round', '2 prior rounds', '3+ prior rounds'];
  const DIMS = [['industry', 'Industry'], ['stage', 'Stage'], ['rounds', 'Rounds raised'], ['band', 'Current raise'], ['instrument', 'Preferred instrument']];
  const NONE = 'Not set';

  const bandOf = r => r.raise_band || (() => { const u = usd(r.target_raise, r.currency); if (!u) return null; return u < 25e4 ? BANDS[0] : u < 1e6 ? BANDS[1] : u < 3e6 ? BANDS[2] : u < 1e7 ? BANDS[3] : u < 2.5e7 ? BANDS[4] : BANDS[5]; })();
  const roundsOf = r => r.rounds_band || (() => { const n = Array.isArray(r.prior_rounds) && r.prior_rounds.length ? r.prior_rounds.length : (r.rounds_raised || 0); return RBANDS[Math.min(3, n)]; })();
  const instrOf = r => arr(r.preferred_instruments).length ? arr(r.preferred_instruments) : arr(r.instrument || r.investment_type);
  const VAL = {
    industry: r => arr(r.industries).length ? arr(r.industries) : [NONE],
    stage: r => [r.stage || NONE],
    rounds: r => [roundsOf(r)],
    band: r => [bandOf(r) || NONE],
    instrument: r => instrOf(r).length ? instrOf(r) : [NONE],
  };
  const ORDERS = { stage: STAGES, rounds: RBANDS, band: BANDS, instrument: INSTR };
  const F = { raises: [], tax: [], group: 'industry', f: { industry: '', stage: '', rounds: '', band: '', instrument: '', q: '', closed: false } };
  const OPEN = r => !['closed', 'lost'].includes(r.pipeline_stage || 'new');

  function inject() {
    if ($('panel-os-fundraisers')) return true;
    const g = $('os-cap-nav-group'); if (!g) return false;
    const after = g.querySelector('[data-os-nav="os-deals"]') || g.querySelector('.nav-item');
    after.insertAdjacentHTML('afterend', '<button class="nav-item" onclick="nav(\'os-fundraisers\')" data-os-nav="os-fundraisers"><span class="nav-icon material-symbols-outlined">category</span>Fundraising Companies</button>');
    $('panel-dashboard').parentNode.insertAdjacentHTML('beforeend', '<div id="panel-os-fundraisers" class="panel"></div>');
    document.body.insertAdjacentHTML('beforeend', MODAL);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') panelMeta['os-fundraisers'] = ['Fundraising Companies', 'By industry, stage, rounds raised, raise size and instrument'];
    $('fr-stage').innerHTML = '<option value="">—</option>' + STAGES.map(s => `<option>${s}</option>`).join('');
    $('fr-instr').innerHTML = INSTR.map(x => `<label class="fr-opt"><input type="checkbox" value="${x}" onchange="frInstr()"/>${x}<input type="radio" name="fr-primary" value="${x}" title="Primary" onchange="frInstr()"/></label>`).join('');
    return true;
  }

  async function load() {
    const [raises, tax] = await Promise.all([
      q(sb().from('deal_rooms').select('*').order('created_at', { ascending: false })),
      F.tax.length ? F.tax : q(sb().from('industry_taxonomy').select('sector,industry,industry_ord,sector_ord').order('industry_ord').order('sector_ord')).catch(() => []),
    ]);
    F.raises = raises || []; F.tax = tax || [];
  }
  function sortCats(dim, cats) {
    const ord = ORDERS[dim];
    if (dim === 'industry') { const io = {}; F.tax.forEach(t => { io[t.industry] = t.industry_ord; }); return cats.sort((a, b) => (io[a] ?? 98) - (io[b] ?? 98) || a.localeCompare(b)); }
    return cats.sort((a, b) => (ord && ord.includes(a) ? ord.indexOf(a) : 98) - (ord && ord.includes(b) ? ord.indexOf(b) : 98) || a.localeCompare(b));
  }
  const NONE_LAST = (a, b) => (a === NONE) - (b === NONE);
  function filtered(skip) {
    const f = F.f, qs = f.q.toLowerCase();
    return F.raises.filter(r => (f.closed || OPEN(r))
      && DIMS.every(([d]) => d === skip || !f[d] || VAL[d](r).includes(f[d]))
      && (!qs || [r.company_name, r.name, arr(r.sectors).join(' '), r.hq_country, r.geography, r.last_round].join(' ').toLowerCase().includes(qs)));
  }
  function counts(dim, rows) { const c = {}; rows.forEach(r => VAL[dim](r).forEach(v => { c[v] = (c[v] || 0) + 1; })); return c; }

  async function render() {
    const P = $('panel-os-fundraisers');
    P.innerHTML = '<div class="os-empty">Loading…</div>';
    try { await load(); } catch (e) { P.innerHTML = `<div class="card os-empty">${esc(e.message)}</div>`; return; }
    draw();
  }
  function draw() {
    const P = $('panel-os-fundraisers'), f = F.f, rows = filtered(), g = F.group;
    const gc = counts(g, rows), cats = sortCats(g, Object.keys(gc)).sort(NONE_LAST);
    const totalTarget = rows.reduce((a, r) => a + (usd(r.target_raise, r.currency) || 0), 0);
    const sel = d => { const c = counts(d, filtered(d)); const opts = sortCats(d, Object.keys(c)).sort(NONE_LAST);
      return `<select class="f-input f-select" onchange="frF('${d}',this.value)" aria-label="${DIMS.find(x => x[0] === d)[1]}"><option value="">${esc(DIMS.find(x => x[0] === d)[1])}: all</option>${opts.map(o => `<option value="${esc(o)}" ${o === f[d] ? 'selected' : ''}>${esc(o)} (${c[o]})</option>`).join('')}</select>`; };
    P.innerHTML = `<div class="page-header"><div><div class="page-title">Fundraising Companies</div><div class="page-sub">${rows.length} ${f.closed ? '' : 'active '}raises · US$${short(totalTarget)} being raised (indicative FX)</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${can('matches.write') ? '<button class="btn btn-primary" onclick="frEdit()">+ Add company raising</button>' : ''}</div></div>
      <div class="fr-group"><span>Group by</span>${DIMS.map(([d, l]) => `<button class="${d === g ? 'on' : ''}" onclick="frGroup('${d}')">${l}</button>`).join('')}</div>
      <div class="fr-cats">${cats.map(c => `<button class="fr-cat ${f[g] === c ? 'on' : ''}" onclick="frF('${g}', ${esc(JSON.stringify(f[g] === c ? '' : c))})"><b>${gc[c]}</b><span>${esc(c)}</span><i>US$${short(rows.filter(r => VAL[g](r).includes(c)).reduce((a, r) => a + (usd(r.target_raise, r.currency) || 0), 0))}</i></button>`).join('') || '<div class="os-empty">No companies raising yet.</div>'}</div>
      <div class="filter-bar" style="flex-wrap:wrap">${DIMS.map(([d]) => sel(d)).join('')}
        <input class="f-input" style="max-width:220px" placeholder="Search company, sector, country…" value="${esc(f.q)}" oninput="frF('q',this.value)"/>
        <label style="font-size:12px;display:flex;align-items:center;gap:5px"><input type="checkbox" ${f.closed ? 'checked' : ''} onchange="frF('closed',this.checked)"/> Include closed / lost</label>
        ${DIMS.some(([d]) => f[d]) || f.q ? '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="frClear()">Clear filters</button>' : ''}</div>
      <div class="card" style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Company</th><th>Industry · sectors</th><th>Stage</th><th>Rounds raised</th><th>Current raise</th><th>Preferred instrument</th><th></th></tr></thead><tbody>
      ${rows.map(row).join('') || '<tr><td colspan="7"><div class="os-empty">No companies match these filters.</div></td></tr>'}</tbody></table></div>`;
  }
  function row(r) {
    const pr = Array.isArray(r.prior_rounds) ? r.prior_rounds : [], n = pr.length || r.rounds_raised || 0;
    const pctRaised = r.target_raise && r.raised_amount ? Math.min(100, Math.round(100 * r.raised_amount / r.target_raise)) : null;
    const ins = instrOf(r);
    return `<tr><td><b style="color:var(--ink)">${esc(r.company_name || r.name || 'Untitled')}</b><div class="cap-sub">${esc([r.hq_country, r.name && r.company_name && r.name !== r.company_name ? r.name : ''].filter(Boolean).join(' · '))}</div></td>
      <td style="font-size:12px;max-width:220px"><b>${esc(arr(r.industries).join(', ') || '—')}</b><div class="cap-sub">${esc(arr(r.sectors).join(', '))}</div></td>
      <td>${r.stage ? `<span class="fr-tag">${esc(r.stage)}</span>` : '<span class="cap-sub">—</span>'}</td>
      <td style="font-size:12px">${n ? `<b>${n}</b> round${n === 1 ? '' : 's'}` : '<span class="fr-tag fr-first">First raise</span>'}${r.total_raised_to_date ? `<div class="cap-sub">${money(r.total_raised_to_date, r.currency)} to date</div>` : ''}${r.last_round ? `<div class="cap-sub">Last: ${esc(r.last_round)} ${fmtD(r.last_round_date)}</div>` : ''}</td>
      <td style="font-size:12px"><b>${money(r.target_raise, r.currency)}</b>${bandOf(r) ? `<div class="cap-sub">${esc(bandOf(r))}</div>` : ''}${pctRaised != null ? `<div class="fr-bar" title="${pctRaised}% committed"><i style="width:${pctRaised}%"></i></div><div class="cap-sub">${money(r.raised_amount, r.currency)} committed</div>` : ''}${r.pre_money_valuation ? `<div class="cap-sub">Pre-money ${money(r.pre_money_valuation, r.currency)}</div>` : ''}${r.close_date ? `<div class="cap-sub">Close ${fmtD(r.close_date)}</div>` : ''}</td>
      <td style="font-size:12px">${ins.map((x, k) => `<span class="fr-tag ${k ? 'fr-sec' : ''}">${esc(x)}</span>`).join(' ') || '—'}</td>
      <td><div style="display:flex;flex-direction:column;gap:4px;align-items:stretch">${can('matches.write') ? `<button class="btn btn-ghost fr-act" onclick="frEdit('${r.id}')">Edit</button>` : ''}<button class="btn btn-ghost fr-act" onclick="frMatches('${r.id}')">Matches</button></div></td></tr>`;
  }

  // ── edit ─────────────────────────────────────────────────────────────────
  function sectorsBox(selected) {
    const by = {}; F.tax.forEach(t => { (by[t.industry] = by[t.industry] || []).push(t.sector); });
    const known = new Set(F.tax.map(t => t.sector)), extra = selected.filter(s => !known.has(s));
    return Object.entries(by).map(([ind, ss]) => `<div class="fr-ind"><b>${esc(ind)}</b>${ss.map(s => `<label class="fr-opt"><input type="checkbox" value="${esc(s)}" ${selected.includes(s) ? 'checked' : ''}/>${esc(s)}</label>`).join('')}</div>`).join('')
      + (extra.length ? `<div class="fr-ind"><b>Other</b>${extra.map(s => `<label class="fr-opt"><input type="checkbox" value="${esc(s)}" checked/>${esc(s)}</label>`).join('')}</div>` : '');
  }
  function roundRow(x) {
    x = x || {};
    return `<div class="fr-round"><select class="f-input f-select" data-k="round">${ROUNDS.map(o => `<option ${o === x.round ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <input class="f-input" data-k="amount" type="number" min="0" step="any" placeholder="Amount" value="${x.amount == null ? '' : esc(x.amount)}"/>
      <input class="f-input" data-k="date" type="month" value="${x.date ? esc(String(x.date).slice(0, 7)) : ''}"/>
      <input class="f-input" data-k="lead" placeholder="Lead investor (optional)" value="${esc(x.lead || '')}"/>
      <button class="btn btn-ghost fr-act" onclick="this.parentNode.remove();frRounds()" aria-label="Remove round">✕</button></div>`;
  }
  function edit(id) {
    const r = F.raises.find(x => x.id === id) || {};
    $('fr-id').value = id || ''; $('fr-h').textContent = id ? (r.company_name || r.name || 'Company') : 'Add company raising';
    const set = (k, v) => { $('fr-' + k).value = v == null ? '' : v; };
    set('company', r.company_name); set('name', r.name); set('hq', r.hq_country); set('stage', r.stage || '');
    set('target', r.target_raise); set('cur', r.currency || 'USD'); set('raised', r.raised_amount); set('min', r.min_ticket);
    set('val', r.pre_money_valuation); set('close', r.close_date); set('use', r.use_of_funds); set('nrounds', (Array.isArray(r.prior_rounds) && r.prior_rounds.length) ? '' : (r.rounds_raised || ''));
    set('total', (Array.isArray(r.prior_rounds) && r.prior_rounds.length) ? '' : r.total_raised_to_date);
    $('fr-sectors').innerHTML = sectorsBox(arr(r.sectors));
    const ins = instrOf(r);
    document.querySelectorAll('#fr-instr input[type=checkbox]').forEach(c => { c.checked = ins.includes(c.value); });
    document.querySelectorAll('#fr-instr input[type=radio]').forEach(c => { c.checked = c.value === ins[0]; });
    $('fr-rounds').innerHTML = (Array.isArray(r.prior_rounds) ? r.prior_rounds : []).map(roundRow).join('');
    frRounds(); frInstr();
    $('modal-fr').style.display = 'flex';
  }
  function frInstr() {
    const ticked = [...document.querySelectorAll('#fr-instr input[type=checkbox]:checked')].map(c => c.value);
    let prim = (document.querySelector('#fr-instr input[type=radio]:checked') || {}).value;
    if (prim && !ticked.includes(prim)) { const cb = document.querySelector(`#fr-instr input[type=checkbox][value="${prim}"]`); if (cb) { cb.checked = true; ticked.push(prim); } }
    if (!prim && ticked.length) { prim = ticked[0]; document.querySelector(`#fr-instr input[type=radio][value="${prim}"]`).checked = true; }
    document.querySelectorAll('#fr-instr input[type=radio]').forEach(r => { r.disabled = !ticked.includes(r.value); });
  }
  function frRounds() { const has = $('fr-rounds').children.length > 0; $('fr-manual').style.display = has ? 'none' : ''; }
  function instrumentsSelected() {
    const ticked = [...document.querySelectorAll('#fr-instr input[type=checkbox]:checked')].map(c => c.value);
    const prim = (document.querySelector('#fr-instr input[type=radio]:checked') || {}).value;
    return prim && ticked.includes(prim) ? [prim, ...ticked.filter(x => x !== prim)] : ticked;
  }
  async function save() {
    const id = $('fr-id').value, v = k => $('fr-' + k).value.trim(), num = k => v(k) === '' ? null : Number(v(k));
    const sectors = [...document.querySelectorAll('#fr-sectors input:checked')].map(c => c.value);
    const rounds = [...document.querySelectorAll('#fr-rounds .fr-round')].map(el => { const g = k => el.querySelector(`[data-k=${k}]`).value.trim();
      return { round: g('round'), amount: g('amount') === '' ? null : Number(g('amount')), currency: v('cur') || 'USD', date: g('date') ? g('date') + '-01' : null, lead: g('lead') || null }; });
    const preferred = instrumentsSelected();
    const p = { company_name: v('company') || null, name: v('name') || null, hq_country: v('hq') || null, stage: v('stage') || null,
      sectors, industry: sectors.join(', ') || null, target_raise: num('target'), currency: v('cur') || 'USD', raised_amount: num('raised'), min_ticket: num('min'),
      pre_money_valuation: num('val'), close_date: v('close') || null, use_of_funds: v('use') || null,
      preferred_instruments: preferred, instrument: preferred[0] || null, investment_type: preferred.join(', ') || null, prior_rounds: rounds };
    if (!rounds.length) { p.rounds_raised = Math.max(0, Math.floor(num('nrounds') || 0)); p.total_raised_to_date = num('total'); p.last_round = null; p.last_round_date = null; }
    if (!p.company_name && !p.name) return notify('Enter the company name', 'warn');
    if (!p.name) p.name = `${p.company_name}${p.stage ? ' — ' + p.stage : ''}`;
    if (p.target_raise != null && !(p.target_raise > 0)) return notify('Target raise must be a positive amount', 'warn');
    if (p.raised_amount != null && p.target_raise && p.raised_amount > p.target_raise * 3) return notify('Committed amount looks too high — check the figure', 'warn');
    if (rounds.some(x => x.amount != null && !(x.amount >= 0))) return notify('Check the round amounts', 'warn');
    const btn = $('fr-go'); btn.disabled = true;
    try {
      if (id) await q(sb().from('deal_rooms').update(p).eq('id', id));
      else await q(sb().from('deal_rooms').insert({ ...p, status: 'draft', pipeline_stage: 'new', next_action: 'Screen the company', next_action_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), os_owner_id: OS().uid || null, created_by: OS().uid || null }));
      notify(id ? 'Fundraising profile saved' : 'Company added'); closeModal('modal-fr'); render();
    } catch (e) { notify(e.message, 'warn'); } finally { btn.disabled = false; }
  }
  function matches(id) { if (window.matchForRaise) return window.matchForRaise(id); window.nav && nav('os-matching'); }

  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'os-fundraisers') { inject(); return render(); } return prev && prev(p); };
  Object.assign(window, { frGroup: d => { F.group = d; draw(); }, frF: (k, v) => { F.f[k] = v; draw(); }, frClear: () => { Object.assign(F.f, { industry: '', stage: '', rounds: '', band: '', instrument: '', q: '' }); draw(); },
    frEdit: edit, frSave: save, frInstr, frRounds, frAddRound: () => { $('fr-rounds').insertAdjacentHTML('beforeend', roundRow()); frRounds(); }, frMatches: matches, __FR: F });

  const MODAL = `<div id="modal-fr" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-fr')"><div class="modal modal-lg" style="max-width:860px">
    <div class="modal-header"><div><div class="modal-title" id="fr-h">Fundraising profile</div><div class="modal-sub">Industry, stage, funding history, current raise and preferred instruments — categories update automatically</div></div><button class="modal-close" onclick="closeModal('modal-fr')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:14px"><input type="hidden" id="fr-id"/>
      <div class="f-grid"><div class="f-group"><label class="f-label" for="fr-company">Company</label><input id="fr-company" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="fr-hq">HQ country</label><input id="fr-hq" class="f-input" placeholder="Singapore"/></div></div>
      <div class="f-group"><label class="f-label" for="fr-name">Raise name (optional)</label><input id="fr-name" class="f-input" placeholder="e.g. Acme — Series A 2026"/></div>
      <div><div class="f-label">Industry / sectors</div><div id="fr-sectors" class="fr-sectors"></div></div>
      <div class="fr-sec-h">Funding history</div>
      <div id="fr-rounds"></div><button class="btn btn-ghost fr-act" style="align-self:flex-start" onclick="frAddRound()">+ Add a previous round</button>
      <div class="f-grid" id="fr-manual"><div class="f-group"><label class="f-label" for="fr-nrounds">Rounds raised so far (if no detail)</label><input id="fr-nrounds" class="f-input" type="number" min="0" placeholder="0 = first raise"/></div>
        <div class="f-group"><label class="f-label" for="fr-total">Total raised to date</label><input id="fr-total" class="f-input" type="number" min="0" step="any"/></div></div>
      <div class="fr-sec-h">Current raise</div>
      <div class="f-grid fr-g3"><div class="f-group"><label class="f-label" for="fr-stage">Stage / round</label><select id="fr-stage" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="fr-target">Target raise</label><input id="fr-target" class="f-input" type="number" min="0" step="any"/></div>
        <div class="f-group"><label class="f-label" for="fr-cur">Currency</label><select id="fr-cur" class="f-input f-select">${['USD', 'SGD', 'EUR', 'GBP', 'AUD', 'AED', 'HKD', 'MYR', 'IDR', 'INR', 'JPY'].map(c => `<option>${c}</option>`).join('')}</select></div>
        <div class="f-group"><label class="f-label" for="fr-raised">Committed so far</label><input id="fr-raised" class="f-input" type="number" min="0" step="any"/></div>
        <div class="f-group"><label class="f-label" for="fr-min">Minimum ticket</label><input id="fr-min" class="f-input" type="number" min="0" step="any"/></div>
        <div class="f-group"><label class="f-label" for="fr-val">Pre-money valuation</label><input id="fr-val" class="f-input" type="number" min="0" step="any"/></div>
        <div class="f-group"><label class="f-label" for="fr-close">Target close</label><input id="fr-close" class="f-input" type="date"/></div></div>
      <div><div class="f-label">Preferred investment <span style="font-weight:400;text-transform:none">— tick all they accept; the dot marks the preferred one</span></div><div id="fr-instr" class="fr-instr"></div></div>
      <div class="f-group"><label class="f-label" for="fr-use">Use of funds</label><textarea id="fr-use" class="f-input" rows="2"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-fr')">Cancel</button><button class="btn btn-primary" id="fr-go" onclick="frSave()">Save</button></div></div></div>`;
  const CSS = `.fr-group{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:12px;color:var(--white-muted)}.fr-group span{margin-right:4px;font-weight:700}
  .fr-group button{border:1px solid var(--border);background:var(--card,#fff);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;color:var(--ink)}.fr-group button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .fr-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:14px}
  .fr-cat{text-align:left;border:1px solid var(--border);background:var(--card,#fff);border-radius:10px;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:2px}
  .fr-cat b{font-size:20px;color:var(--ink)}.fr-cat span{font-size:12px;font-weight:600;color:var(--ink)}.fr-cat i{font-style:normal;font-size:11px;color:var(--white-muted)}.fr-cat.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
  .fr-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:4px;padding:2px 7px;background:#e8eef7;color:#1d3d6b;margin:1px 0}.fr-tag.fr-sec{background:#f0f0ee;color:#555;font-weight:600}.fr-tag.fr-first{background:#fff4d6;color:#7a5c00}
  .fr-bar{height:5px;border-radius:3px;background:#eee;margin-top:4px;max-width:120px}.fr-bar i{display:block;height:100%;border-radius:3px;background:#0a5c40}
  .fr-act{padding:3px 8px!important;font-size:11.5px!important;min-height:0!important}
  .fr-sectors{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px 14px;max-height:230px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:10px}
  .fr-ind b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--white-muted);margin-bottom:3px}
  .fr-opt{display:flex;align-items:center;gap:6px;font-size:12.5px;padding:2px 0;cursor:pointer}
  .fr-instr{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 14px}.fr-instr .fr-opt input[type=radio]{margin-left:auto}
  .fr-sec-h{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;border-top:1px solid var(--border);padding-top:12px}
  .fr-round{display:grid;grid-template-columns:150px 130px 140px minmax(0,1fr) 34px;gap:6px;margin-bottom:6px}
  .fr-g3{grid-template-columns:repeat(3,minmax(0,1fr))!important}
  @media(max-width:700px){.fr-round{grid-template-columns:1fr 1fr}.fr-g3{grid-template-columns:1fr 1fr!important}}`;

  const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000);
})();
