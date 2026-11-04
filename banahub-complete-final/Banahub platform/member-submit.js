/* BANAHUB member portal — "My Capital Raise" (free to enter; the investor campaign is a paid service)
 * Companies: company profile, funding history, current raise, next stage  → public.deal_rooms (submitted_by = me)
 * Investors: investor profile, mandate and funds                          → public.investors (user_id = me)
 * Server-side guards (24_member_submissions.sql) fix every internal field; BANAHUB reviews in Admin OS → Member Submissions.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const arr = v => Array.isArray(v) ? v : [];
  const sbc = () => window.getBanaSupabaseClient();
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const money = (n, c) => n == null || n === '' ? '—' : `${c || 'USD'} ${Number(n).toLocaleString('en-SG', { maximumFractionDigits: 0 })}`;

  const COMPANY_TYPES = ['Startup', 'Scale-up', 'SMB / SME', 'Corporate', 'Enterprise / MNC', 'Government / agency', 'Non-profit', 'Other company'];
  const INVESTOR_TYPES = [['Angel investor', 'Angel', null], ['Venture capital (VC)', 'VC', null], ['Corporate venture capital', 'VC', 'Corporate VC'], ['Private equity (PE)', 'Private Equity', null],
    ['Limited partner (LP)', 'LP', null], ['Single family office', 'Family Office', 'Single family office'], ['Multi-family office', 'Multi-Family Office', null], ['Fund manager', 'Other', 'Fund manager'],
    ['Hedge fund', 'Hedge Fund', null], ['Fund of funds', 'Fund of Funds', null], ['Institutional investor', 'Other', 'Institutional'], ['Other investor', 'Other', null]];
  const STAGES = ['Pre-seed', 'Seed', 'Pre-Series A', 'Series A', 'Series B', 'Series C+', 'Growth', 'Pre-IPO', 'Debt'];
  const ROUNDS = ['Friends & family', 'Angel', 'Pre-seed', 'Seed', 'Pre-Series A', 'Series A', 'Series B', 'Series C+', 'Bridge', 'Grant', 'Venture debt', 'Other'];
  const INSTR = ['Equity', 'Preferred equity', 'Convertible note', 'SAFE', 'Venture debt', 'Revenue-based financing', 'Private credit', 'Secondary sale', 'Open to discuss'];
  const TRACTION = [['', 'Select'], ['pre_revenue', 'Pre-revenue'], ['early_revenue', 'Early revenue'], ['product_market_fit', 'Product–market fit'], ['scaling', 'Scaling revenue'], ['profitable', 'Profitable']];
  const GEOS = ['Singapore', 'Malaysia', 'Indonesia', 'Vietnam', 'Thailand', 'Philippines', 'Southeast Asia', 'UAE', 'Saudi Arabia', 'Qatar', 'GCC / Middle East', 'Hong Kong', 'China', 'Japan', 'South Korea', 'India', 'Australia / NZ', 'Europe', 'United Kingdom', 'United States', 'Global'];
  const CUR = ['USD', 'SGD', 'EUR', 'GBP', 'AUD', 'AED', 'HKD', 'MYR', 'IDR', 'INR', 'JPY'];
  const RS = { submitted: ['Submitted', '#7a5000', 'rgba(180,120,0,0.10)'], in_review: ['In review', '#1d3d6b', 'rgba(29,61,107,0.10)'], needs_info: ['More info needed', '#ba1a1a', 'rgba(186,26,26,0.08)'], accepted: ['Accepted', '#003527', 'rgba(0,53,39,0.10)'], declined: ['Not proceeding', '#3a3a3a', 'rgba(27,28,26,0.08)'] };
  const S = { uid: null, me: null, tax: [], raises: [], investor: null, mode: null, editing: null };

  const opt = (list, sel) => list.map(o => o === '' ? `<option value="">Select</option>` : Array.isArray(o) ? `<option value="${esc(o[0])}" ${o[0] === sel ? 'selected' : ''}>${esc(o[1])}</option>` : `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const chips = (name, list, sel) => `<div class="ms-chips" data-chips="${name}">${list.map(o => `<button type="button" class="ms-chip${arr(sel).includes(o) ? ' on' : ''}" data-v="${esc(o)}" aria-pressed="${arr(sel).includes(o)}">${esc(o)}</button>`).join('')}</div>`;
  const chipVals = name => [...document.querySelectorAll(`[data-chips="${name}"] .ms-chip.on`)].map(b => b.getAttribute('data-v'));
  const pill = s => { const r = RS[s] || RS.submitted; return `<span class="ms-pill" style="color:${r[1]};background:${r[2]}">${r[0]}</span>`; };
  const field = (id, label, input, hint) => `<div class="ms-f"><label class="f-lab" for="${id}">${label}</label>${input}${hint ? `<div class="ms-hint">${hint}</div>` : ''}</div>`;
  const inp = (id, v, a) => `<input id="${id}" class="f-in" value="${esc(v == null ? '' : v)}" ${a || ''}/>`;
  const sel = (id, list, v) => `<select id="${id}" class="f-in">${opt(list, v)}</select>`;
  const val = id => ($(id) ? $(id).value.trim() : '');
  const num = id => { const v = val(id).replace(/,/g, ''); return v === '' ? null : Number(v); };

  function inject() {
    if ($('panel-submit')) return true;
    const prof = document.querySelector('.nav-item[onclick*="switchTab(\'profile\'"]'); const top = $('top-profile');
    if (!prof || !top || !$('panel-profile')) return false;
    prof.insertAdjacentHTML('beforebegin', `<button class="nav-item" onclick="switchTab('submit',this)"><span class="mat-ic material-symbols-outlined">rocket_launch</span>My Capital Raise</button>`);
    top.insertAdjacentHTML('beforebegin', `<button class="tab-btn" id="top-submit" onclick="switchTab('submit',null,'top-submit')">My Capital Raise</button>`);
    $('panel-profile').insertAdjacentHTML('beforebegin', '<div class="panel" id="panel-submit"><div id="ms-root"></div></div>');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const orig = window.switchTab;
    window.switchTab = function (id, b, t) { const r = orig.apply(this, arguments); if (id === 'submit') load(); return r; };
    if (/[?&]tab=submit/.test(location.search)) setTimeout(() => window.switchTab('submit', null, 'top-submit'), 300);
    return true;
  }

  async function load() {
    const root = $('ms-root'); root.innerHTML = '<div class="ms-loading">Loading…</div>';
    try {
      const sb = await sbc(); const { data: { user } } = await sb.auth.getUser();
      if (!user) { root.innerHTML = '<div class="glass-card sect">Please sign in.</div>'; return; }
      S.uid = user.id;
      const [me, tax, raises, inv] = await Promise.all([
        q(sb.from('users').select('id,full_name,email,role,company_name,member_category,country,website').eq('id', user.id).maybeSingle()),
        S.tax.length ? S.tax : q(sb.from('industry_taxonomy').select('sector,industry,industry_ord,sector_ord').order('industry_ord').order('sector_ord')).catch(() => []),
        q(sb.from('deal_rooms').select('*').eq('submitted_by', user.id).order('created_at', { ascending: false })).catch(() => []),
        q(sb.from('investors').select('*').eq('user_id', user.id).maybeSingle()).catch(() => null),
      ]);
      S.me = me || {}; S.tax = tax || []; S.raises = raises || []; S.investor = inv;
      if (S.price === undefined) { try { const r = await sb.functions.invoke('billing', { body: { action: 'campaign_price' } }); S.price = (r.data && r.data.price) || null; } catch (e) { S.price = null; } }
      if (!S.mode) S.mode = S.me.role === 'investor' || INVESTOR_TYPES.some(t => t[0] === S.me.member_category) || inv ? 'investor' : 'company';
      render();
    } catch (e) { root.innerHTML = `<div class="glass-card sect" style="color:#ba1a1a">${esc(e.message)}</div>`; }
  }

  function render() {
    const root = $('ms-root'), inv = S.investor;
    root.innerHTML = `
      <div class="ms-hero"><div><div class="ms-eyebrow">My Capital Raise</div><h2>${S.mode === 'investor' ? 'Tell us what you invest in' : 'Put your raise in front of the right investors'}</h2>
        <p>${S.mode === 'investor' ? 'Share your mandate and funds so BANAHUB only brings you opportunities that fit. Free for investors.' : 'Entering your company and raise is free. Once BANAHUB has reviewed it, you can choose to have us run a paid investor campaign for you.'} BANAHUB is not a licensed financial adviser; nothing here guarantees investor interest, introductions or funding.</p></div>
        <span class="material-symbols-outlined ms-hero-ic">rocket_launch</span></div>
      ${S.mode === 'company' ? `<div class="ms-steps"><div class="ms-st"><b>1</b><div><strong>Enter your raise</strong><span class="ms-free">Free</span></div></div><i></i><div class="ms-st"><b>2</b><div><strong>BANAHUB review</strong><span class="ms-free">Free</span></div></div><i></i>
        <div class="ms-st"><b>3</b><div><strong>Investor campaign</strong><span class="ms-paid">${S.price ? esc(S.price.currency) + ' ' + Number(S.price.amount).toLocaleString('en-SG') : 'Paid service'}</span></div></div></div>` : ''}
      ${/[?&]campaign=success/.test(location.search) ? '<div class="ms-ok">✓ Payment received — your campaign is confirmed once payment clears (PayNow can take a few minutes). The BANAHUB team will be in touch to start.</div>' : ''}
      ${/[?&]campaign=cancelled/.test(location.search) ? '<div class="ms-ok" style="background:#fff4d6;color:#7a5000">Payment cancelled — you can start the campaign any time.</div>' : ''}
      <div class="ms-choice">
        <button type="button" class="ms-card${S.mode === 'company' ? ' on' : ''}" onclick="msMode('company')"><span class="material-symbols-outlined">apartment</span><b>I'm a company</b><span>Company profile, capital raise, stage and next round</span></button>
        <button type="button" class="ms-card${S.mode === 'investor' ? ' on' : ''}" onclick="msMode('investor')"><span class="material-symbols-outlined">account_balance</span><b>I'm an investor</b><span>Investor profile, mandate and funds</span></button>
      </div>
      ${S.mode === 'company' ? companyView() : investorView(inv)}`;
    root.querySelectorAll('.ms-chip').forEach(b => b.addEventListener('click', () => { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); if (b.closest('[data-chips="instr"]')) primaryOpts(); }));
    if (S.mode === 'company' && $('ms-form')) primaryOpts();
  }

  // ── paid investor campaign ─────────────────────────────────────────────
  const INCLUDED = ['Investor matching against your sector, stage, ticket and geography', 'Curated investor shortlist approved with you', 'Outreach run and followed up by the BANAHUB team', 'Campaign tracking and a results report'];
  function campaignBox(r) {
    const c = r.campaign_status, price = S.price ? `${esc(S.price.currency)} ${Number(S.price.amount).toLocaleString('en-SG')}` : null;
    const inc = `<ul class="ms-inc">${INCLUDED.map(x => `<li>${x}</li>`).join('')}</ul>`;
    if (['paid', 'active', 'completed'].includes(c)) return `<div class="ms-camp ms-camp-on"><span class="material-symbols-outlined">campaign</span><div><b>Investor campaign — ${c === 'paid' ? 'paid, starting soon' : c === 'active' ? 'running' : 'completed'}</b><div class="ms-sub">Paid ${r.campaign_paid_at ? new Date(r.campaign_paid_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}${r.campaign_amount ? ' · ' + esc(r.campaign_currency || '') + ' ' + Number(r.campaign_amount).toLocaleString('en-SG') : ''}. The BANAHUB team will keep you updated.</div></div></div>`;
    if (r.review_status !== 'accepted') return `<div class="ms-camp ms-camp-lock"><span class="material-symbols-outlined">lock</span><div><b>Investor campaign${price ? ' · ' + price : ''}</b><div class="ms-sub">Paid service — available once BANAHUB has reviewed and accepted your raise.</div>${inc}</div></div>`;
    if (!price) return `<div class="ms-camp"><span class="material-symbols-outlined">campaign</span><div><b>Investor campaign</b><div class="ms-sub">Your raise is accepted. Campaign pricing is being finalised — the BANAHUB team will contact you.</div>${inc}</div></div>`;
    return `<div class="ms-camp ms-camp-go"><span class="material-symbols-outlined">campaign</span><div style="flex:1"><b>Run an investor campaign — ${price}</b><div class="ms-sub">One-time payment by card or PayNow. Your raise is accepted and ready to go.</div>${inc}
      <div class="ms-camp-act"><button class="btn-p" onclick="msCampaign('${r.id}',this)">${c === 'awaiting_payment' ? 'Continue to payment' : 'Start campaign — pay ' + price}</button><span class="ms-sub">No guarantee of investor interest, introductions or funding.</span></div><div class="ms-msg err" id="mcp-${r.id}"></div></div></div>`;
  }
  async function startCampaign(id, btn) {
    const err = $('mcp-' + id); if (err) err.textContent = ''; btn.disabled = true; const t = btn.textContent; btn.textContent = 'Opening secure payment…';
    try {
      const sb = await sbc(); const { data, error } = await sb.functions.invoke('billing', { body: { action: 'campaign_checkout', raise_id: id } });
      if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch (e) {} throw new Error(m); }
      if (!data || !data.url) throw new Error((data && data.error) || 'Could not start payment');
      location.href = data.url;
    } catch (e) { if (err) err.textContent = e.message; btn.disabled = false; btn.textContent = t; }
  }

  // ── company ─────────────────────────────────────────────────────────────
  function companyView() {
    const list = S.raises.length ? `<div class="glass-card sect"><h3>My capital raises</h3><p class="d">Review status is updated by the BANAHUB team.</p>
      ${S.raises.map(r => `<div class="ms-raise"><div class="ms-row" style="border:0"><div><b>${esc(r.company_name || r.name)}</b> · ${esc(r.stage || '')} · ${money(r.target_raise, r.currency)}<div class="ms-sub">Entered ${r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}${r.review_note ? ` · <b style="color:#ba1a1a">BANAHUB: ${esc(r.review_note)}</b>` : ''}</div></div>
        <div style="display:flex;gap:8px;align-items:center">${pill(r.review_status)}${['submitted', 'needs_info'].includes(r.review_status) ? `<button class="btn-o" onclick="msEdit('${r.id}')">Edit</button>` : ''}</div></div>${campaignBox(r)}</div>`).join('')}
      <button class="btn-o" style="margin-top:12px" onclick="msEdit('')">+ Enter another raise</button></div>` : '';
    if (S.raises.length && S.editing === null) return list;
    return list + companyForm(S.raises.find(r => r.id === S.editing) || {});
  }
  function companyForm(r) {
    const by = {}; S.tax.forEach(t => { (by[t.industry] = by[t.industry] || []).push(t.sector); });
    const secs = arr(r.sectors), instr = arr(r.preferred_instruments).length ? arr(r.preferred_instruments) : [];
    return `<form id="ms-form" class="ms-form" onsubmit="event.preventDefault();msSaveCompany()">
      <div class="glass-card sect"><div class="ms-step">1</div><h3>Company</h3><p class="d">The basics we need to understand your business.</p>
        <div class="ms-grid">${field('mc-name', 'Company name *', inp('mc-name', r.company_name || S.me.company_name, 'required maxlength="160"'))}
          ${field('mc-type', 'Company type *', sel('mc-type', ['', ...COMPANY_TYPES], r.company_type || (COMPANY_TYPES.includes(S.me.member_category) ? S.me.member_category : '')))}
          ${field('mc-web', 'Website', inp('mc-web', r.website || S.me.website, 'placeholder="company.com" maxlength="200"'))}
          ${field('mc-hq', 'HQ country *', inp('mc-hq', r.hq_country || S.me.country, 'required list="ms-geo" maxlength="80"'))}
          ${field('mc-founded', 'Year founded', inp('mc-founded', r.founded_year, 'type="number" min="1900" max="2100"'))}
          ${field('mc-team', 'Team size', inp('mc-team', r.team_size, 'type="number" min="0"'))}</div>
        <div class="f-lab" style="margin-top:14px">Industry / sectors *</div>
        <div class="ms-secs">${Object.entries(by).map(([ind, ss]) => `<div><div class="ms-ind">${esc(ind)}</div>${chips('sectors', ss, secs)}</div>`).join('')}</div>
        ${field('mc-desc', 'What does the company do? *', `<textarea id="mc-desc" class="f-in" rows="3" required maxlength="1500" placeholder="One paragraph: product, customers, market">${esc(r.description || '')}</textarea>`)}
      </div>
      <div class="glass-card sect"><div class="ms-step">2</div><h3>Traction</h3><p class="d">Approximate figures are fine.</p>
        <div class="ms-grid">${field('mc-traction', 'Traction stage', sel('mc-traction', TRACTION, r.traction_stage || ''))}
          ${field('mc-rev', 'Annual revenue', inp('mc-rev', r.annual_revenue, 'type="number" min="0" step="any"'), 'In the raise currency')}
          ${field('mc-growth', 'Revenue growth (% YoY)', inp('mc-growth', r.revenue_growth_pct, 'type="number" step="any"'))}</div></div>
      <div class="glass-card sect"><div class="ms-step">3</div><h3>Funding so far</h3><p class="d">Add each round you've raised. Leave empty if this is your first raise.</p>
        <div id="mc-rounds">${arr(r.prior_rounds).map(roundRow).join('')}</div>
        <button type="button" class="btn-o" onclick="msAddRound()">+ Add a previous round</button></div>
      <div class="glass-card sect"><div class="ms-step">4</div><h3>Current raise</h3><p class="d">What you are raising now.</p>
        <div class="ms-grid">${field('mc-stage', 'Stage / round *', sel('mc-stage', ['', ...STAGES], r.stage || ''))}
          ${field('mc-target', 'Amount raising *', inp('mc-target', r.target_raise, 'type="number" min="1" step="any" required'))}
          ${field('mc-cur', 'Currency', sel('mc-cur', CUR, r.currency || 'USD'))}
          ${field('mc-raised', 'Already committed', inp('mc-raised', r.raised_amount, 'type="number" min="0" step="any"'))}
          ${field('mc-min', 'Minimum ticket', inp('mc-min', r.min_ticket, 'type="number" min="0" step="any"'))}
          ${field('mc-val', 'Pre-money valuation', inp('mc-val', r.pre_money_valuation, 'type="number" min="0" step="any"'))}
          ${field('mc-close', 'Target close', inp('mc-close', r.close_date, 'type="date"'))}
          ${field('mc-deck', 'Pitch deck link', inp('mc-deck', r.deck_url, 'type="url" placeholder="https://…" maxlength="500"'), 'Shared only with the BANAHUB team')}</div>
        <div class="f-lab" style="margin-top:14px">Preferred investment *</div>${chips('instr', INSTR, instr)}
        <div class="ms-grid" style="margin-top:10px">${field('mc-primary', 'Most preferred', `<select id="mc-primary" class="f-in"></select>`)}
          ${field('mc-lead', 'Do you need a lead investor?', sel('mc-lead', [['no', 'No / already have one'], ['yes', 'Yes']], r.lead_needed ? 'yes' : 'no'))}</div>
        ${field('mc-use', 'Use of funds', `<textarea id="mc-use" class="f-in" rows="2" maxlength="1000" placeholder="e.g. 40% product, 35% Singapore & Indonesia GTM, 25% hiring">${esc(r.use_of_funds || '')}</textarea>`)}</div>
      <div class="glass-card sect"><div class="ms-step">5</div><h3>Next stage</h3><p class="d">Where you're heading after this round.</p>
        <div class="ms-grid">${field('mc-next', 'Next round', sel('mc-next', ['', ...STAGES], r.next_stage || ''))}
          ${field('mc-next-amt', 'Expected amount', inp('mc-next-amt', r.next_stage_amount, 'type="number" min="0" step="any"'), 'Same currency as the current raise')}
          ${field('mc-next-date', 'Expected timing', inp('mc-next-date', r.next_stage_date ? String(r.next_stage_date).slice(0, 7) : '', 'type="month"'))}</div></div>
      <datalist id="ms-geo">${GEOS.map(g => `<option>${esc(g)}</option>`).join('')}</datalist>
      <div class="ms-submit"><label class="ms-consent"><input type="checkbox" id="mc-consent" required/> I confirm the information is accurate and I'm authorised to share it with BANAHUB.</label>
        <div style="display:flex;gap:10px;align-items:center">${S.raises.length ? '<button type="button" class="btn-o" onclick="msEdit(null)">Cancel</button>' : ''}<button class="btn-p" id="mc-go" type="submit">${r.id ? 'Save changes' : 'Save my raise — free'}</button></div></div>
      <div id="mc-msg" class="ms-msg"></div><input type="hidden" id="mc-id" value="${esc(r.id || '')}"/></form>`;
  }
  function roundRow(x) {
    x = x || {};
    return `<div class="ms-round"><select class="f-in" data-k="round" aria-label="Round">${opt(ROUNDS, x.round)}</select><input class="f-in" data-k="amount" type="number" min="0" step="any" placeholder="Amount" value="${x.amount == null ? '' : esc(x.amount)}" aria-label="Amount"/>
      <input class="f-in" data-k="date" type="month" value="${x.date ? esc(String(x.date).slice(0, 7)) : ''}" aria-label="Month"/><input class="f-in" data-k="lead" placeholder="Lead investor (optional)" value="${esc(x.lead || '')}" aria-label="Lead investor"/>
      <button type="button" class="ms-x" onclick="this.parentNode.remove()" aria-label="Remove round">✕</button></div>`;
  }
  function primaryOpts() {
    const s = $('mc-primary'); if (!s) return; const cur = s.value || (arr((S.raises.find(r => r.id === S.editing) || {}).preferred_instruments)[0]); const v = chipVals('instr');
    s.innerHTML = v.length ? v.map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('') : '<option value="">Select instruments above</option>';
  }
  async function saveCompany() {
    const msg = $('mc-msg'); msg.textContent = ''; msg.className = 'ms-msg';
    const sectors = chipVals('sectors'), instr = chipVals('instr'), prim = val('mc-primary');
    const bad = m => { msg.textContent = m; msg.classList.add('err'); msg.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    if (!val('mc-type')) return bad('Choose the company type.');
    if (!sectors.length) return bad('Choose at least one industry / sector.');
    if (!val('mc-stage')) return bad('Choose the stage of the current raise.');
    if (!instr.length) return bad('Choose at least one preferred investment type.');
    const target = num('mc-target'); if (!(target > 0)) return bad('Enter the amount you are raising.');
    const raised = num('mc-raised'); if (raised != null && raised > target * 3) return bad('Committed amount looks too high — please check.');
    const deck = val('mc-deck'); if (deck && !/^https:\/\//i.test(deck)) return bad('Pitch deck link must start with https://');
    const rounds = [...document.querySelectorAll('#mc-rounds .ms-round')].map(el => { const g = k => el.querySelector(`[data-k=${k}]`).value.trim(); return { round: g('round'), amount: g('amount') === '' ? null : Number(g('amount')), currency: val('mc-cur'), date: g('date') ? g('date') + '-01' : null, lead: g('lead').slice(0, 120) || null }; });
    const preferred = prim && instr.includes(prim) ? [prim, ...instr.filter(x => x !== prim)] : instr;
    const nd = val('mc-next-date');
    const p = { submitted_by: S.uid, company_name: val('mc-name'), name: `${val('mc-name')} — ${val('mc-stage')}`, company_type: val('mc-type'), website: val('mc-web') || null, hq_country: val('mc-hq'), geography: val('mc-hq'),
      founded_year: num('mc-founded'), team_size: num('mc-team'), sectors, industry: sectors.join(', '), description: val('mc-desc'), traction_stage: val('mc-traction') || null, annual_revenue: num('mc-rev'), revenue_growth_pct: num('mc-growth'),
      prior_rounds: rounds, stage: val('mc-stage'), target_raise: target, currency: val('mc-cur'), raised_amount: raised, min_ticket: num('mc-min'), pre_money_valuation: num('mc-val'), close_date: val('mc-close') || null,
      deck_url: deck || null, preferred_instruments: preferred, instrument: preferred[0], investment_type: preferred.join(', '), lead_needed: val('mc-lead') === 'yes', use_of_funds: val('mc-use') || null,
      next_stage: val('mc-next') || null, next_stage_amount: num('mc-next-amt'), next_stage_date: nd ? nd + '-01' : null };
    const btn = $('mc-go'); btn.disabled = true;
    try {
      const sb = await sbc(), id = val('mc-id');
      if (id) await q(sb.from('deal_rooms').update(p).eq('id', id)); else await q(sb.from('deal_rooms').insert(p));
      await sb.from('users').update({ member_category: p.company_type, company_name: S.me.company_name || p.company_name }).eq('id', S.uid);
      S.editing = null; await load();
      const m = document.querySelector('#ms-root .ms-hero'); if (m) m.insertAdjacentHTML('afterend', '<div class="ms-ok">✓ Saved — free. BANAHUB will review your raise; once accepted you can start an investor campaign.</div>');
    } catch (e) { bad(e.message); } finally { if ($('mc-go')) $('mc-go').disabled = false; }
  }

  // ── investor ────────────────────────────────────────────────────────────
  function investorView(i) {
    i = i || {};
    const cat = (INVESTOR_TYPES.find(t => t[0] === S.me.member_category) || [])[0] || (INVESTOR_TYPES.find(t => t[1] === i.investor_type && (t[2] || null) === (i.investor_subtype || null)) || [])[0] || '';
    const by = {}; S.tax.forEach(t => { (by[t.industry] = by[t.industry] || []).push(t.sector); });
    return `${i.id ? `<div class="glass-card sect ms-status"><div><b>Your investor profile</b><div class="ms-sub">Submitted ${i.submitted_at ? new Date(i.submitted_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}${i.review_note ? ` · <b style="color:#ba1a1a">BANAHUB: ${esc(i.review_note)}</b>` : ''}</div></div>${pill(i.review_status)}</div>` : ''}
    <form id="ms-iform" class="ms-form" onsubmit="event.preventDefault();msSaveInvestor()">
      <div class="glass-card sect"><div class="ms-step">1</div><h3>Investor profile</h3><p class="d">Who you are and how you invest.</p>
        <div class="ms-grid">${field('mi-cat', 'Investor type *', `<select id="mi-cat" class="f-in"><option value="">Select</option>${INVESTOR_TYPES.map(t => `<option ${t[0] === cat ? 'selected' : ''}>${esc(t[0])}</option>`).join('')}</select>`)}
          ${field('mi-org', 'Organisation / fund manager *', inp('mi-org', i.organization || S.me.company_name, 'required maxlength="160"'))}
          ${field('mi-web', 'Website', inp('mi-web', i.website || S.me.website, 'maxlength="200" placeholder="fund.com"'))}
          ${field('mi-aum', 'Assets under management', inp('mi-aum', i.aum, 'type="number" min="0" step="any"'), 'Optional — shared only with BANAHUB')}
          ${field('mi-aumc', 'Currency', sel('mi-aumc', CUR, i.aum_currency || i.check_currency || 'USD'))}
          ${field('mi-appetite', 'Current appetite', sel('mi-appetite', [['', 'Select'], ['active', 'Actively deploying'], ['selective', 'Selective'], ['paused', 'Paused'], ['not_deploying', 'Not deploying']], i.appetite || ''))}</div></div>
      <div class="glass-card sect"><div class="ms-step">2</div><h3>What you're looking for</h3><p class="d">Your mandate — we only share opportunities that fit it.</p>
        <div class="ms-grid">${field('mi-min', 'Ticket size — min', inp('mi-min', i.check_min, 'type="number" min="0" step="any"'))}
          ${field('mi-max', 'Ticket size — max', inp('mi-max', i.check_max, 'type="number" min="0" step="any"'))}
          ${field('mi-cur', 'Ticket currency', sel('mi-cur', CUR, i.check_currency || 'USD'))}
          ${field('mi-lead', 'Lead or follow', sel('mi-lead', [['', 'Select'], ['lead', 'Lead'], ['follow', 'Follow'], ['either', 'Either']], i.lead_follow || ''))}
          ${field('mi-rev', 'Minimum annual revenue', inp('mi-rev', i.min_revenue, 'type="number" min="0" step="any"'), 'Leave blank if none')}
          ${field('mi-co', 'Co-invest', sel('mi-co', [['', 'Select'], ['yes', 'Yes'], ['no', 'No'], ['case_by_case', 'Case by case']], i.co_invest || ''))}</div>
        <div class="f-lab" style="margin-top:14px">Stages</div>${chips('istages', STAGES, arr(i.preferred_stages))}
        <div class="f-lab" style="margin-top:14px">Investment types</div>${chips('iinstr', INSTR.filter(x => x !== 'Open to discuss'), arr(i.instruments))}
        <div class="f-lab" style="margin-top:14px">Geographies</div>${chips('igeo', GEOS, arr(i.invest_geographies))}
        <div class="f-lab" style="margin-top:14px">Sectors</div><div class="ms-secs">${Object.entries(by).map(([ind, ss]) => `<div><div class="ms-ind">${esc(ind)}</div>${chips('isectors', ss, arr(i.focus_sectors))}</div>`).join('')}</div>
        ${field('mi-thesis', 'Investment thesis / current mandate', `<textarea id="mi-thesis" class="f-in" rows="3" maxlength="1500" placeholder="What you invest in and why; what you are looking for right now">${esc(i.current_mandate || '')}</textarea>`)}</div>
      <div class="glass-card sect"><div class="ms-step">3</div><h3>Funds</h3><p class="d">Funds or vehicles you're investing from (optional).</p>
        <div id="mi-funds">${arr(i.funds).map(fundRow).join('')}</div><button type="button" class="btn-o" onclick="msAddFund()">+ Add a fund</button></div>
      <div class="ms-submit"><label class="ms-consent"><input type="checkbox" id="mi-consent" required/> I confirm the information is accurate. BANAHUB does not provide investment advice; any introduction is at my discretion.</label>
        <button class="btn-p" id="mi-go" type="submit">${i.id ? 'Save changes' : 'Save my investor profile'}</button></div>
      <div id="mi-msg" class="ms-msg"></div></form>`;
  }
  function fundRow(f) {
    f = f || {};
    return `<div class="ms-fund"><div class="ms-grid">${['name|Fund name|text', 'size|Fund size|number', 'vintage|Vintage year|number'].map(s => { const [k, l, t] = s.split('|'); return `<div class="ms-f"><label class="f-lab">${l}</label><input class="f-in" data-k="${k}" type="${t}" value="${esc(f[k] == null ? '' : f[k])}" ${t === 'number' ? 'min="0" step="any"' : 'maxlength="120"'}/></div>`; }).join('')}
      <div class="ms-f"><label class="f-lab">Currency</label><select class="f-in" data-k="currency">${opt(CUR, f.currency || 'USD')}</select></div>
      <div class="ms-f"><label class="f-lab">Status</label><select class="f-in" data-k="status">${opt([['raising', 'Raising'], ['deploying', 'Deploying'], ['fully_deployed', 'Fully deployed'], ['harvesting', 'Harvesting']], f.status || 'deploying')}</select></div>
      <div class="ms-f"><label class="f-lab">Strategy</label><input class="f-in" data-k="strategy" value="${esc(f.strategy || '')}" maxlength="200" placeholder="e.g. Seed–Series A B2B SaaS, SEA"/></div></div>
      <button type="button" class="ms-x" onclick="this.parentNode.remove()" aria-label="Remove fund">✕ Remove fund</button></div>`;
  }
  async function saveInvestor() {
    const msg = $('mi-msg'); msg.textContent = ''; msg.className = 'ms-msg';
    const bad = m => { msg.textContent = m; msg.classList.add('err'); msg.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    const cat = INVESTOR_TYPES.find(t => t[0] === val('mi-cat'));
    if (!cat) return bad('Choose your investor type.');
    if (!val('mi-org')) return bad('Enter your organisation.');
    const mn = num('mi-min'), mx = num('mi-max'); if (mn != null && mx != null && mn > mx) return bad('Minimum ticket is larger than maximum.');
    const funds = [...document.querySelectorAll('#mi-funds .ms-fund')].map(el => { const g = k => el.querySelector(`[data-k=${k}]`).value.trim(); return { name: g('name'), size: g('size') === '' ? null : Number(g('size')), currency: g('currency'), vintage: g('vintage') === '' ? null : Number(g('vintage')), status: g('status'), strategy: g('strategy') || null }; }).filter(f => f.name || f.size);
    const p = { user_id: S.uid, full_name: S.me.full_name || null, email: S.me.email, organization: val('mi-org'), website: val('mi-web') || null, investor_type: cat[1], investor_subtype: cat[2],
      aum: num('mi-aum'), aum_currency: val('mi-aumc'), appetite: val('mi-appetite') || null, check_min: mn, check_max: mx, check_currency: val('mi-cur'), lead_follow: val('mi-lead') || null, min_revenue: num('mi-rev'),
      co_invest: val('mi-co') || null, preferred_stages: chipVals('istages'), instruments: chipVals('iinstr'), invest_geographies: chipVals('igeo'), geography: chipVals('igeo').join(', ') || null,
      focus_sectors: chipVals('isectors'), current_mandate: val('mi-thesis') || null, funds,
      check_size: mn != null || mx != null ? `${val('mi-cur')} ${mn != null ? Number(mn).toLocaleString() : '?'}–${mx != null ? Number(mx).toLocaleString() : '?'}` : null };
    const btn = $('mi-go'); btn.disabled = true;
    try {
      const sb = await sbc();
      if (S.investor && S.investor.id) await q(sb.from('investors').update(p).eq('id', S.investor.id)); else await q(sb.from('investors').insert(p));
      await sb.from('users').update({ member_category: cat[0], company_name: S.me.company_name || p.organization }).eq('id', S.uid);
      await load();
      const m = document.querySelector('#ms-root .ms-hero'); if (m) m.insertAdjacentHTML('afterend', '<div class="ms-ok">✓ Saved — the BANAHUB team will review your profile.</div>');
    } catch (e) { bad(e.message); } finally { if ($('mi-go')) $('mi-go').disabled = false; }
  }

  Object.assign(window, { msMode: m => { S.mode = m; render(); }, msEdit: id => { S.editing = id; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }, msSaveCompany: saveCompany, msCampaign: startCampaign, msSaveInvestor: saveInvestor,
    msAddRound: () => $('mc-rounds').insertAdjacentHTML('beforeend', roundRow()), msAddFund: () => $('mi-funds').insertAdjacentHTML('beforeend', fundRow()), __MS: S });

  const CSS = `#panel-submit{max-width:1040px}
  .ms-hero{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:26px 28px;border-radius:18px;margin-bottom:18px;color:#fff;background:linear-gradient(135deg,#003527 0%,#0b5a43 60%,#1f7a5c 100%);box-shadow:0 12px 32px rgba(0,53,39,.18)}
  .ms-hero h2{font-family:'Newsreader',Georgia,serif;font-size:26px;font-weight:600;line-height:1.2;margin:6px 0 8px}.ms-hero p{font-size:13.5px;line-height:1.6;color:rgba(255,255,255,.92);max-width:640px}
  .ms-eyebrow{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#b9e6cf}.ms-hero-ic{font-size:56px!important;color:rgba(255,255,255,.25)}
  .ms-choice{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
  .ms-card{display:flex;flex-direction:column;gap:4px;text-align:left;padding:18px 20px;border-radius:14px;border:1.5px solid rgba(0,53,39,.15);background:rgba(255,255,255,.8);cursor:pointer;color:#1b1c1a;transition:all .15s;font-family:'Manrope',sans-serif}
  .ms-card .material-symbols-outlined{font-size:26px;color:#003527}.ms-card b{font-size:16px}.ms-card span:last-child{font-size:13px;color:#2f3a35}
  .ms-card:hover{border-color:#003527;transform:translateY(-1px)}.ms-card.on{border-color:#003527;background:#eaf4ef;box-shadow:inset 0 0 0 1px #003527}
  .ms-form .sect{position:relative;padding-left:62px}.ms-step{position:absolute;left:20px;top:22px;width:28px;height:28px;border-radius:50%;background:#003527;color:#fff;font:800 13px 'Manrope',sans-serif;display:flex;align-items:center;justify-content:center}
  .ms-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}@media(max-width:860px){.ms-grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.ms-grid{grid-template-columns:1fr}.ms-form .sect{padding-left:22px}.ms-step{position:static;margin-bottom:8px}.ms-choice{grid-template-columns:1fr}.ms-hero-ic{display:none}}
  .ms-f{display:flex;flex-direction:column;margin-top:4px}.ms-hint{font-size:11.5px;color:#3a433e;margin-top:4px}
  .ms-chips{display:flex;flex-wrap:wrap;gap:6px}.ms-chip{border:1px solid rgba(0,53,39,.22);background:#fff;color:#1b1c1a;border-radius:999px;padding:6px 12px;font:600 12.5px 'Manrope',sans-serif;cursor:pointer;transition:all .12s}
  .ms-chip:hover{border-color:#003527}.ms-chip.on{background:#003527;color:#fff;border-color:#003527}
  .ms-secs{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:12px}.ms-ind{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#003527;margin-bottom:6px}
  .ms-round{display:grid;grid-template-columns:160px 140px 150px minmax(0,1fr) 36px;gap:8px;margin-bottom:8px}@media(max-width:700px){.ms-round{grid-template-columns:1fr 1fr}}
  .ms-fund{border:1px solid rgba(0,53,39,.12);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:rgba(255,255,255,.6)}
  .ms-x{border:1px solid rgba(186,26,26,.3);color:#ba1a1a;background:#fff;border-radius:8px;padding:6px 10px;font:700 12px 'Manrope',sans-serif;cursor:pointer;margin-top:6px}
  .ms-submit{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:18px 22px;border-radius:14px;background:#fff;border:1px solid rgba(0,53,39,.12);position:sticky;bottom:12px;box-shadow:0 8px 24px rgba(0,53,39,.10)}
  .ms-consent{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:#1b1c1a;max-width:620px}
  .ms-steps{display:flex;align-items:center;gap:10px;margin:-4px 0 18px;flex-wrap:wrap}.ms-steps i{flex:1;min-width:20px;height:2px;background:rgba(0,53,39,.18)}
  .ms-st{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid rgba(0,53,39,.14);border-radius:12px;padding:10px 14px}.ms-st b{width:26px;height:26px;border-radius:50%;background:#003527;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px}
  .ms-st strong{display:block;font-size:13px;color:#1b1c1a}.ms-free{font-size:11.5px;font-weight:800;color:#0a5c40}.ms-paid{font-size:11.5px;font-weight:800;color:#7a5000}
  .ms-raise{border:1px solid rgba(0,53,39,.10);border-radius:14px;padding:4px 16px 14px;margin-bottom:12px;background:rgba(255,255,255,.7)}
  .ms-camp{display:flex;gap:12px;align-items:flex-start;border-radius:12px;padding:14px;background:#f4f8f6;border:1px dashed rgba(0,53,39,.25);color:#1b1c1a}.ms-camp>.material-symbols-outlined{font-size:24px;color:#003527}
  .ms-camp-lock{background:#f7f6f2;border-style:dashed}.ms-camp-lock>.material-symbols-outlined{color:#5c645f}.ms-camp-go{background:linear-gradient(135deg,#eef7f2,#fff);border:1.5px solid #003527}.ms-camp-on{background:#e3f1e8;border:1px solid #0a5c40}
  .ms-inc{margin:8px 0 0 18px;font-size:12.5px;color:#1b1c1a;list-style:disc}.ms-inc li{margin:2px 0}.ms-camp-act{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}
  .ms-msg{margin-top:10px;font-size:13px;font-weight:600}.ms-msg.err{color:#ba1a1a}.ms-ok{padding:12px 16px;border-radius:12px;background:#eaf4ef;color:#003527;font-weight:700;margin-bottom:16px}
  .ms-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(0,53,39,.08);color:#1b1c1a;font-size:14px}.ms-sub{font-size:12px;color:#3a433e;margin-top:3px}
  .ms-status{display:flex;justify-content:space-between;align-items:center}.ms-pill{display:inline-block;padding:4px 11px;border-radius:999px;font-size:12px;font-weight:700}.ms-loading{padding:40px;text-align:center;color:#3a433e}`;

  const t = setInterval(() => { if (inject()) clearInterval(t); }, 200); setTimeout(() => clearInterval(t), 15000);
})();
