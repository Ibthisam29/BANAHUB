/* BANAHUB Admin OS — Member Submissions (Capital group)
 * Company raises (deal_rooms.submitted_by) and investor profiles & funds (investors.user_id) submitted from the member portal.
 * Review: in review → needs more info / accepted / declined. Accepted raises move into the Deal Pipeline (Screening).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const arr = v => Array.isArray(v) ? v : [];
  const OS = () => window.__OS || { perms: new Set(), people: [] };
  const can = p => OS().perms.has('*') || OS().perms.has(p);
  const sb = () => OS().sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const short = n => { n = Number(n) || 0; const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)); };
  const money = (n, c) => n == null || n === '' ? '—' : `${c || 'USD'} ${short(n)}`;
  const FX = { USD: 1, SGD: 0.74, EUR: 1.08, GBP: 1.27, AED: 0.272, AUD: 0.66, HKD: 0.128, JPY: 0.0066, MYR: 0.22, IDR: 0.000063, INR: 0.012 };
  const usd = (n, c) => (Number(n) || 0) * (FX[String(c || 'USD').toUpperCase()] || 1);
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const RS = { submitted: ['New', '#7a5000', '#fff4d6'], in_review: ['In review', '#1d3d6b', '#e6eef9'], needs_info: ['Needs info', '#8c1d18', '#fdecea'], accepted: ['Accepted', '#0a5c40', '#e3f1e8'], declined: ['Declined', '#3a3a3a', '#ecebe7'] };
  const pill = s => { const r = RS[s] || RS.submitted; return `<span class="sx-pill" style="color:${r[1]};background:${r[2]}">${r[0]}</span>`; };
  const CAMP = { awaiting_payment: ['Campaign: awaiting payment', '#7a5000', '#fff4d6'], paid: ['Campaign: PAID', '#0a5c40', '#e3f1e8'], active: ['Campaign: running', '#1d3d6b', '#e6eef9'], completed: ['Campaign: completed', '#3a3a3a', '#ecebe7'], cancelled: ['Campaign: cancelled', '#8c1d18', '#fdecea'] };
  const campPill = r => r.campaign_status && CAMP[r.campaign_status] ? `<span class="sx-pill" style="color:${CAMP[r.campaign_status][1]};background:${CAMP[r.campaign_status][2]};margin-right:6px">${CAMP[r.campaign_status][0]}${r.campaign_amount ? ' · ' + esc(r.campaign_currency || '') + ' ' + Number(r.campaign_amount).toLocaleString('en-SG') : ''}</span>` : '';
  const TRACTION = { pre_revenue: 'Pre-revenue', early_revenue: 'Early revenue', product_market_fit: 'Product–market fit', scaling: 'Scaling revenue', profitable: 'Profitable' };
  const X = { raises: [], inv: [], users: {}, tab: 'companies', st: 'open', q: '' };

  function inject() {
    if ($('panel-os-submissions')) return true;
    const g = $('os-cap-nav-group'); if (!g) return false;
    const after = g.querySelector('[data-os-nav="os-fundraisers"]') || g.querySelector('[data-os-nav="os-deals"]') || g.querySelector('.nav-item');
    after.insertAdjacentHTML('afterend', '<button class="nav-item" onclick="nav(\'os-submissions\')" data-os-nav="os-submissions"><span class="nav-icon material-symbols-outlined">inbox</span>Member Submissions<span class="nav-badge" id="nb-sx" style="display:none"></span></button>');
    $('panel-dashboard').parentNode.insertAdjacentHTML('beforeend', '<div id="panel-os-submissions" class="panel"></div>');
    document.body.insertAdjacentHTML('beforeend', MODAL);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') panelMeta['os-submissions'] = ['Member Submissions', 'Company raises and investor profiles submitted by members'];
    load().then(badge).catch(() => {});
    return true;
  }
  async function load() {
    const [raises, inv] = await Promise.all([
      q(sb().from('deal_rooms').select('*').not('submitted_by', 'is', null).order('submitted_at', { ascending: false })).catch(() => []),
      q(sb().from('investors').select('*').not('user_id', 'is', null).order('updated_at', { ascending: false })).catch(() => []),
    ]);
    X.raises = raises || []; X.inv = inv || [];
    const ids = [...new Set([...X.raises.map(r => r.submitted_by), ...X.inv.map(i => i.user_id)])].filter(Boolean);
    X.users = {};
    if (ids.length) (await q(sb().from('users').select('id,full_name,email,company_name,title,country,member_category,linkedin_verified,status').in('id', ids)).catch(() => [])).forEach(u => { X.users[u.id] = u; });
  }
  function badge() { const n = X.raises.filter(r => r.review_status === 'submitted').length + X.inv.filter(i => (i.review_status || 'submitted') === 'submitted').length, el = $('nb-sx'); if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; } }
  const isOpen = s => ['submitted', 'in_review', 'needs_info', null, undefined].includes(s);

  async function render() {
    const P = $('panel-os-submissions'); P.innerHTML = '<div class="os-empty">Loading…</div>';
    try { await load(); } catch (e) { P.innerHTML = `<div class="card os-empty">${esc(e.message)}</div>`; return; }
    badge(); draw();
  }
  function draw() {
    const P = $('panel-os-submissions'), list = X.tab === 'companies' ? X.raises : X.inv, stOf = x => x.review_status || 'submitted', qs = X.q.toLowerCase();
    const rows = list.filter(x => (X.st === 'all' || (X.st === 'open' ? isOpen(stOf(x)) : stOf(x) === X.st))
      && (!qs || JSON.stringify([x.company_name, x.organization, x.full_name, x.email, x.sectors, x.focus_sectors, (X.users[x.submitted_by || x.user_id] || {}).email]).toLowerCase().includes(qs)));
    const cnt = (l, f) => l.filter(f).length;
    P.innerHTML = `<div class="page-header"><div><div class="page-title">Member Submissions</div><div class="page-sub">Company raises and investor profiles submitted from the member portal — review, request info, accept into the pipeline</div></div></div>
      <div class="os-kpis">${[
        ['New company raises', cnt(X.raises, r => r.review_status === 'submitted')], ['Raises in review', cnt(X.raises, r => ['in_review', 'needs_info'].includes(r.review_status))],
        ['New investor profiles', cnt(X.inv, i => (i.review_status || 'submitted') === 'submitted')], ['Accepted', cnt(X.raises, r => r.review_status === 'accepted') + cnt(X.inv, i => i.review_status === 'accepted')],
        ['Paid campaigns', cnt(X.raises, r => ['paid', 'active', 'completed'].includes(r.campaign_status))],
        ['Capital sought (open)', 'US$' + short(X.raises.filter(r => isOpen(r.review_status)).reduce((a, r) => a + usd(r.target_raise, r.currency), 0))],
      ].map(([l, v]) => `<div class="os-kpi"><div class="os-kpi-l">${l}</div><div class="os-kpi-v">${v}</div></div>`).join('')}</div>
      <div class="sx-tabs"><button class="${X.tab === 'companies' ? 'on' : ''}" onclick="sxTab('companies')"><span class="material-symbols-outlined">apartment</span>Companies raising <b>${X.raises.length}</b></button>
        <button class="${X.tab === 'investors' ? 'on' : ''}" onclick="sxTab('investors')"><span class="material-symbols-outlined">account_balance</span>Investors &amp; funds <b>${X.inv.length}</b></button></div>
      <div class="filter-bar" style="flex-wrap:wrap"><select class="f-input f-select" style="width:190px" onchange="sxF('st',this.value)">${[['open', 'Open (new, in review, needs info)'], ['submitted', 'New'], ['in_review', 'In review'], ['needs_info', 'Needs info'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['all', 'All']].map(([v, l]) => `<option value="${v}" ${v === X.st ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="f-input" style="max-width:260px" placeholder="Search company, investor, sector, email…" value="${esc(X.q)}" oninput="sxF('q',this.value)"/><span style="margin-left:auto;font-size:12px;color:var(--ink)">${rows.length} shown</span></div>
      <div class="sx-list">${rows.map(X.tab === 'companies' ? raiseCard : invCard).join('') || '<div class="card os-empty">Nothing in this view yet. Members submit from their dashboard → Submit to BANAHUB.</div>'}</div>`;
  }
  const who = id => { const u = X.users[id] || {}; return `${esc(u.full_name || u.email || 'Member')}${u.linkedin_verified ? ' <span class="sx-li">in ✓</span>' : ''}<span class="sx-muted"> · ${esc(u.email || '')}${u.status && u.status !== 'approved' ? ' · account ' + esc(u.status) : ''}</span>`; };
  function raiseCard(r) {
    const pct = r.target_raise && r.raised_amount ? Math.min(100, Math.round(100 * r.raised_amount / r.target_raise)) : null;
    return `<div class="sx-card" onclick="sxOpen('r','${r.id}')"><div class="sx-top"><div><div class="sx-title">${esc(r.company_name || r.name)}</div><div class="sx-by">${who(r.submitted_by)}</div></div>${pill(r.review_status)}</div>
      <div class="sx-tags">${[r.company_type, ...arr(r.industries), r.hq_country].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="sx-facts"><div><b>${esc(r.stage || '—')}</b><i>Current round</i></div><div><b>${money(r.target_raise, r.currency)}</b><i>Raising${pct != null ? ` · ${pct}% committed` : ''}</i></div>
        <div><b>${arr(r.prior_rounds).length || r.rounds_raised || 0}</b><i>${arr(r.prior_rounds).length || r.rounds_raised ? 'prior rounds' + (r.total_raised_to_date ? ' · ' + money(r.total_raised_to_date, r.currency) : '') : 'First raise'}</i></div>
        <div><b>${esc(arr(r.preferred_instruments)[0] || r.instrument || '—')}</b><i>Preferred</i></div>
        <div><b>${esc(r.next_stage || '—')}</b><i>Next${r.next_stage_amount ? ' · ' + money(r.next_stage_amount, r.currency) : ''}${r.next_stage_date ? ' · ' + new Date(r.next_stage_date).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }) : ''}</i></div></div>
      <div class="sx-foot">${campPill(r)}Submitted ${fmtD(r.submitted_at)}${r.review_note ? ` · Note: ${esc(r.review_note)}` : ''}</div></div>`;
  }
  function invCard(i) {
    const funds = arr(i.funds);
    return `<div class="sx-card" onclick="sxOpen('i','${i.id}')"><div class="sx-top"><div><div class="sx-title">${esc(i.organization || i.full_name)}</div><div class="sx-by">${who(i.user_id)}</div></div>${pill(i.review_status || 'submitted')}</div>
      <div class="sx-tags">${[[i.investor_type, i.investor_subtype].filter(Boolean).join(' · '), ...arr(i.focus_industries)].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="sx-facts"><div><b>${i.check_min != null || i.check_max != null ? `${money(i.check_min, i.check_currency)}–${short(i.check_max)}` : '—'}</b><i>Ticket</i></div>
        <div><b>${esc(arr(i.preferred_stages).slice(0, 3).join(', ') || '—')}</b><i>Stages</i></div><div><b>${esc(arr(i.instruments).slice(0, 2).join(', ') || '—')}</b><i>Instruments</i></div>
        <div><b>${i.aum ? money(i.aum, i.aum_currency) : '—'}</b><i>AUM</i></div><div><b>${funds.length}</b><i>fund${funds.length === 1 ? '' : 's'}${funds[0] ? ' · ' + esc(funds[0].name || '') : ''}</i></div></div>
      <div class="sx-foot">${esc(arr(i.invest_geographies).join(', '))}${i.submitted_at ? ' · Submitted ' + fmtD(i.submitted_at) : ''}${i.review_note ? ` · Note: ${esc(i.review_note)}` : ''}</div></div>`;
  }

  // ── detail + review ─────────────────────────────────────────────────────
  const kv = rows => `<table class="sx-kv">${rows.filter(r => r[1] != null && r[1] !== '' && !(Array.isArray(r[1]) && !r[1].length)).map(([k, v]) => `<tr><th>${k}</th><td>${Array.isArray(v) ? esc(v.join(', ')) : v}</td></tr>`).join('')}</table>`;
  function open(kind, id) {
    const x = (kind === 'r' ? X.raises : X.inv).find(y => y.id === id); if (!x) return;
    $('sx-kind').value = kind; $('sx-id').value = id; $('sx-note').value = x.review_note || '';
    const uid = kind === 'r' ? x.submitted_by : x.user_id, u = X.users[uid] || {};
    $('sx-h').textContent = kind === 'r' ? (x.company_name || x.name) : (x.organization || x.full_name);
    $('sx-sub').innerHTML = `${who(uid)} · ${pill(x.review_status || 'submitted')}`;
    const link = v => v ? `<a href="${esc(/^https?:\/\//.test(v) ? v : 'https://' + v)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>` : '';
    $('sx-body').innerHTML = kind === 'r' ? `<div class="sx-sec">Company</div>${kv([['Type', esc(x.company_type)], ['Website', link(x.website)], ['HQ', esc(x.hq_country)], ['Founded', esc(x.founded_year)], ['Team', esc(x.team_size)], ['Industries', arr(x.industries)], ['Sectors', arr(x.sectors)], ['About', esc(x.description)]])}
      <div class="sx-sec">Traction</div>${kv([['Stage', esc(TRACTION[x.traction_stage] || x.traction_stage)], ['Annual revenue', x.annual_revenue != null ? money(x.annual_revenue, x.currency) : ''], ['Growth', x.revenue_growth_pct != null ? x.revenue_growth_pct + '% YoY' : '']])}
      <div class="sx-sec">Funding history</div>${arr(x.prior_rounds).length ? kv(arr(x.prior_rounds).map(p => [esc(p.round), `${money(p.amount, p.currency || x.currency)}${p.date ? ' · ' + new Date(p.date).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }) : ''}${p.lead ? ' · lead ' + esc(p.lead) : ''}`])) : '<div class="sx-muted">First raise</div>'}
      ${deckRow(x)}
      <div class="sx-sec">Current raise</div>${kv([['Round', esc(x.stage)], ['Raising', money(x.target_raise, x.currency)], ['Committed', x.raised_amount != null ? money(x.raised_amount, x.currency) : ''], ['Min ticket', x.min_ticket ? money(x.min_ticket, x.currency) : ''], ['Pre-money', x.pre_money_valuation ? money(x.pre_money_valuation, x.currency) : ''], ['Close', x.close_date ? fmtD(x.close_date) : ''], ['Instruments', arr(x.preferred_instruments)], ['Needs lead', x.lead_needed ? 'Yes' : ''], ['Use of funds', esc(x.use_of_funds)], ['Deck', link(x.deck_url)]])}
      <div class="sx-sec">Investor campaign (paid service)</div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${campPill(x) || '<span class="sx-muted">Not purchased</span>'}
        ${['', 'awaiting_payment', 'cancelled'].includes(x.campaign_status || '') ? `<button class="btn btn-ghost btn-sm" onclick="sxCamp('paid')">Mark paid (offline / invoice)</button>` : ''}
        ${x.campaign_status === 'paid' ? `<button class="btn btn-ghost btn-sm" onclick="sxCamp('active')">Mark campaign running</button>` : ''}
        ${x.campaign_status === 'active' ? `<button class="btn btn-ghost btn-sm" onclick="sxCamp('completed')">Mark completed</button>` : ''}</div>
      <div class="sx-sec">Next stage</div>${kv([['Next round', esc(x.next_stage)], ['Amount', x.next_stage_amount ? money(x.next_stage_amount, x.currency) : ''], ['Timing', x.next_stage_date ? new Date(x.next_stage_date).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }) : '']])}`
      : `${deckRow(x)}<div class="sx-sec">Investor</div>${kv([['Type', esc([x.investor_type, x.investor_subtype].filter(Boolean).join(' · '))], ['Website', link(x.website)], ['HQ', esc(x.hq_country)], ['Firm email', x.firm_email ? `<a href="mailto:${esc(x.firm_email)}">${esc(x.firm_email)}</a>` : ''], ['Firm phone', x.firm_phone ? `<a href="tel:${esc(x.firm_phone.replace(/[^+\d]/g, ''))}">${esc(x.firm_phone)}</a>` : ''], ['AUM', x.aum ? money(x.aum, x.aum_currency) : ''], ['Appetite', esc(x.appetite)], ['Lead / follow', esc(x.lead_follow)], ['Co-invest', esc(x.co_invest)]])}
      <div class="sx-sec">Mandate</div>${kv([['Ticket', x.check_min != null || x.check_max != null ? `${money(x.check_min, x.check_currency)} – ${money(x.check_max, x.check_currency)}` : ''], ['Stages', arr(x.preferred_stages)], ['Instruments', arr(x.instruments)], ['Geographies', arr(x.invest_geographies)], ['Industries', arr(x.focus_industries)], ['Sectors', arr(x.focus_sectors)], ['Min revenue', x.min_revenue != null ? money(x.min_revenue, x.check_currency) : ''], ['Thesis', esc(x.current_mandate)]])}
      <div class="sx-sec">Funds</div>${arr(x.funds).length ? kv(arr(x.funds).map(f => [esc(f.name || 'Fund'), `${f.size ? money(f.size, f.currency) : ''}${f.vintage ? ' · ' + esc(f.vintage) : ''}${f.status ? ' · ' + esc(String(f.status).replace(/_/g, ' ')) : ''}${f.strategy ? ' · ' + esc(f.strategy) : ''}${f.manager ? ' · manager: ' + esc(f.manager) : ''}${f.tickets ? ' · tickets ' + esc(f.tickets) : ''}${f.investments != null ? ' · ' + esc(f.investments) + ' investments' : ''}`])) : '<div class="sx-muted">No funds listed</div>'}
      <div class="sx-sec">Portfolio companies (${arr(x.portfolio_companies).length})</div>${arr(x.portfolio_companies).length ? `<div class="sx-chips">${arr(x.portfolio_companies).map(c => `<span title="${esc([c.sector, c.stage, c.year].filter(Boolean).join(' · '))}">${c.website ? `<a href="${esc(/^https?:/.test(c.website) ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>` : esc(c.name)}${c.stage ? ' · ' + esc(c.stage) : ''}${c.year ? ' · ' + esc(c.year) : ''}</span>`).join('')}</div>` : '<div class="sx-muted">None listed</div>'}
      <div class="sx-sec">Key people &amp; team</div>${arr(x.team).length ? `<table class="sx-team"><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th></th></tr>${arr(x.team).map(t => `<tr><td><b>${esc(t.name)}</b>${t.primary ? ' <span class="sx-pill" style="color:#0a5c40;background:#e3f1e8">Main contact</span>' : ''}</td><td>${esc(t.role || '')}</td><td>${t.email ? `<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>` : ''}</td><td>${t.phone ? `<a href="tel:${esc(String(t.phone).replace(/[^+\d]/g, ''))}">${esc(t.phone)}</a>` : ''}</td><td>${t.linkedin ? `<a href="${esc(/^https?:\/\//.test(t.linkedin) ? t.linkedin : 'https://' + t.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>` : ''}</td></tr>`).join('')}</table>` : '<div class="sx-muted">No team listed</div>'}`;
    $('sx-links').innerHTML = `${uid ? `<button class="btn btn-ghost btn-sm" onclick="closeModal('modal-sx');nav('users');setTimeout(()=>openUserModal('${uid}'),400)">Member profile</button>` : ''}${kind === 'r' ? `<button class="btn btn-ghost btn-sm" onclick="closeModal('modal-sx');window.matchForRaise&&matchForRaise('${id}')">Investor matches</button>` : ''}`;
    $('modal-sx').style.display = 'flex';
  }
  async function camp(status) {
    const id = $('sx-id').value;
    if (status === 'paid' && !confirm('Mark this campaign as PAID? Only do this if payment was received outside Stripe (bank transfer / Stripe invoice).')) return;
    const p = { campaign_status: status };
    if (status === 'paid') Object.assign(p, { campaign_paid_at: new Date().toISOString(), pipeline_stage: 'ready', next_action: 'Launch paid investor campaign', next_action_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) });
    if (status === 'active') p.pipeline_stage = 'campaign';
    try { await q(sb().from('deal_rooms').update(p).eq('id', id)); notify('Campaign updated'); closeModal('modal-sx'); render(); } catch (e) { notify(e.message, 'warn'); }
  }
  async function review(status) {
    const kind = $('sx-kind').value, id = $('sx-id').value, note = $('sx-note').value.trim();
    if (['needs_info', 'declined'].includes(status) && note.length < 5) return notify('Add a short note for the member (what you need / why)', 'warn');
    const p = { review_status: status, review_note: note || null };
    if (kind === 'r' && status === 'accepted') Object.assign(p, { pipeline_stage: 'screening', os_owner_id: OS().uid || null, next_action: 'Screen accepted submission', next_action_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) });
    if (kind === 'r' && status === 'declined') Object.assign(p, { pipeline_stage: 'lost', lost_reason: note || 'Declined at review' });
    if (kind === 'i' && status === 'accepted') Object.assign(p, { status: 'approved', active: true });
    try { await q(sb().from(kind === 'r' ? 'deal_rooms' : 'investors').update(p).eq('id', id)); notify({ accepted: 'Accepted' + (kind === 'r' ? ' — moved to Deal Pipeline (Screening)' : ' — added to Investor CRM'), declined: 'Declined', needs_info: 'Member asked for more info', in_review: 'Marked in review' }[status]); closeModal('modal-sx'); render(); }
    catch (e) { notify(e.message, 'warn'); }
  }

  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'os-submissions') { inject(); return render(); } return prev && prev(p); };
  function deckRow(x) {
    if (!x.deck_path && !x.deck_url) return '<div class="sx-sec">Pitch deck</div><div class="sx-muted">No deck uploaded</div>';
    return `<div class="sx-sec">Pitch deck</div><div class="sx-deck">${x.deck_path ? `<button type="button" class="btn btn-primary btn-sm" onclick="sxDeck('${esc(x.deck_path)}')"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">description</span> Open ${esc(x.deck_name || 'deck')}</button><span class="sx-muted">${x.deck_size ? (x.deck_size / 1048576).toFixed(1) + ' MB · ' : ''}${x.deck_uploaded_at ? 'uploaded ' + fmtD(x.deck_uploaded_at) : ''}</span>` : ''}${x.deck_url ? ` <a href="${esc(x.deck_url)}" target="_blank" rel="noopener noreferrer">Deck link ↗</a>` : ''}</div>`;
  }
  async function deck(path) {
    const w = window.open('', '_blank');
    try { const r = await sb().storage.from('decks').createSignedUrl(path, 300); if (r.error) throw new Error(r.error.message); if (w) w.location = r.data.signedUrl; else location.href = r.data.signedUrl; }
    catch (e) { if (w) w.close(); notify('Could not open deck: ' + e.message, 'error'); }
  }
  function sxBen() {
    if (!window.Ben || !Ben.ask) return notify('Ben is still loading', 'warn');
    const k = $('sx-kind').value, id = $('sx-id').value, name = ($('sx-h') || {}).textContent || '';
    Ben.ask(k === 'r'
      ? `Assess the investor readiness of the company raise "${name}" (deal_room_id ${id}). Read the deck and check the data room. Give the score, what's in place, what's missing, red flags, the investor types to target, and a 30/60/90-day plan. Suggest the review note I should send the founder.`
      : `Assess the fund / LP readiness of the investor profile "${name}" (investor_id ${id}). Read their deck if uploaded. Give the strengths, gaps, what's missing for LP diligence, and next steps. Suggest the review note I should send them.`);
  }
  Object.assign(window, { sxBen, sxDeck: deck, sxTab: t => { X.tab = t; draw(); }, sxF: (k, v) => { X[k] = v; draw(); }, sxOpen: open, sxReview: review, sxCamp: camp, __SX: X });

  const MODAL = `<div id="modal-sx" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-sx')"><div class="modal modal-lg" style="max-width:860px">
    <div class="modal-header"><div><div class="modal-title" id="sx-h">Submission</div><div class="modal-sub" id="sx-sub"></div></div><button class="modal-close" onclick="closeModal('modal-sx')">✕</button></div>
    <div class="modal-body"><input type="hidden" id="sx-kind"/><input type="hidden" id="sx-id"/><div id="sx-body"></div>
      <div class="f-group" style="margin-top:14px"><label class="f-label" for="sx-note">Note to the member (shown in their dashboard)</label><textarea id="sx-note" class="f-input" rows="2" placeholder="e.g. Please add your latest revenue figure and deck link"></textarea></div>
      <div id="sx-links" style="display:flex;gap:6px;margin-top:8px"></div></div>
    <div class="modal-footer" style="flex-wrap:wrap"><button class="btn btn-ghost" onclick="sxBen()" title="Ben reads the profile, deck and data room and gives a readiness assessment">✦ Ask Ben to assess</button><span style="flex:1"></span><button class="btn btn-danger" onclick="sxReview('declined')">Decline</button><button class="btn btn-ghost" onclick="sxReview('needs_info')">Ask for more info</button>
      <button class="btn btn-ghost" onclick="sxReview('in_review')">Mark in review</button><button class="btn btn-primary" onclick="sxReview('accepted')">Accept</button></div></div></div>`;
  const CSS = `.sx-tabs{display:flex;gap:8px;margin:4px 0 12px;flex-wrap:wrap}.sx-tabs button{display:flex;align-items:center;gap:8px;border:1px solid var(--border);background:var(--surface,#fff);color:var(--ink);border-radius:12px;padding:10px 16px;font-weight:700;font-size:13px;cursor:pointer}
  .sx-tabs button b{background:rgba(0,53,39,.08);border-radius:999px;padding:1px 8px;font-size:12px}.sx-tabs button.on{background:#003527;color:#fff;border-color:#003527}.sx-tabs button.on b{background:rgba(255,255,255,.2)}
  .sx-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px;max-height:calc(100vh - 330px);overflow:auto;padding:2px}
  @media(max-width:700px){.sx-list{grid-template-columns:1fr;max-height:none}}
  .sx-card{border:1px solid var(--border);border-radius:14px;background:var(--surface,#fff);padding:16px;cursor:pointer;transition:all .15s;color:var(--ink)}.sx-card:hover{border-color:#003527;box-shadow:0 6px 18px rgba(0,53,39,.08)}
  .sx-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.sx-title{font-size:16px;font-weight:800;color:var(--ink)}.sx-by{font-size:12px;color:var(--ink);margin-top:2px}.sx-muted{color:var(--white-dim)}
  .sx-li{font-size:10.5px;font-weight:800;color:#0A66C2;background:#0A66C215;border-radius:999px;padding:1px 6px;margin-left:4px}
  .sx-tags{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0}.sx-tags span{font-size:11.5px;font-weight:700;background:#eef3f0;color:#0a3d2c;border-radius:6px;padding:2px 8px}
  .sx-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;border-top:1px solid var(--border);padding-top:10px}.sx-facts b{display:block;font-size:13.5px;color:var(--ink)}.sx-facts i{font-style:normal;font-size:11px;color:var(--white-dim)}
  .sx-foot{font-size:11.5px;color:var(--white-dim);margin-top:10px}.sx-pill{font-size:11px;font-weight:800;border-radius:999px;padding:3px 10px;white-space:nowrap}
  .sx-sec{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#003527;margin:14px 0 4px}.sx-deck{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.sx-chips{display:flex;flex-wrap:wrap;gap:6px}.sx-chips span{font-size:12px;background:#eef3f0;border-radius:6px;padding:3px 8px;color:var(--ink)}
  .sx-team{width:100%;border-collapse:collapse;font-size:12.5px}.sx-team th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--white-dim);padding:4px 6px}.sx-team td{padding:6px;border-top:1px solid var(--border);color:var(--ink)}
  .sx-kv{width:100%;border-collapse:collapse;font-size:13px}.sx-kv th{text-align:left;width:150px;color:var(--white-dim);font-weight:600;padding:4px 0;vertical-align:top}.sx-kv td{color:var(--ink);padding:4px 0}`;

  const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000);
})();
