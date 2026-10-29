/* BANAHUB Investor Matching Engine (Admin OS)
 * Scores are computed in the database (os_compute_matches → os_match_breakdown) so every user
 * sees the same numbers. This file only displays them and records human decisions.
 * Nothing here sends email: outreach is drafted by a person after approval and then logged.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const money = (n, c) => n == null || n === '' ? '—' : `${c || 'USD'} ${Number(n).toLocaleString('en-SG', { maximumFractionDigits: 0 })}`;
  const arr = v => Array.isArray(v) ? v : String(v || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);
  const OS = () => window.__OS || { perms: new Set() };
  const can = p => OS().perms.has('*') || OS().perms.has(p);
  async function q(promise) { const r = await promise; if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; }
  const sb = () => OS().sb;

  const CRITERIA = [['sector', 'Sector', 20], ['stage', 'Stage', 15], ['cheque', 'Cheque', 15], ['geography', 'Geography', 15], ['instrument', 'Instrument', 10], ['traction', 'Traction', 10], ['mandate', 'Mandate / appetite', 10], ['relationship', 'Relationship', 5]];
  const BANDS = [['Exceptional match', 90, '#0a5c40'], ['Strong match', 80, '#1a6b4a'], ['Possible match', 70, '#7a5c00'], ['Do not recommend initially', 0, '#8c1d18']];
  const bandOf = n => (BANDS.find(b => (n || 0) >= b[1]) || BANDS[3]);
  const STATUS = { suggested: 'Suggested', shortlisted: 'Shortlisted', approved: 'Approved for outreach', contacted: 'Sent', interested: 'Interested', meeting: 'Meeting', due_diligence: 'Due diligence', term_sheet: 'Term sheet', declined: 'Declined', no_response: 'No response', invested: 'Invested', not_pursued: 'Not pursued', do_not_contact: 'Do not contact' };
  const SENT = ['contacted', 'interested', 'meeting', 'due_diligence', 'term_sheet', 'declined', 'no_response', 'invested'];
  const POSITIVE = ['interested', 'meeting', 'due_diligence', 'term_sheet', 'invested'];
  const DECLINE = [['sector', 'Sector outside mandate'], ['stage', 'Stage'], ['cheque_size', 'Cheque size'], ['geography', 'Geography'], ['traction', 'Not enough traction'], ['valuation', 'Valuation'], ['team', 'Team'], ['timing', 'Timing'], ['fund_capacity', 'Fund capacity / deployment'], ['conflict', 'Portfolio conflict'], ['no_reason', 'No reason given'], ['other', 'Other']];
  const INSTRUMENTS = ['Equity', 'Convertible / SAFE', 'Preferred equity', 'Venture debt', 'Revenue-based financing', 'Private credit', 'Secondary'];
  const TRACTION = [['', '—'], ['none', 'No requirement'], ['pre_revenue', 'Pre-revenue'], ['early_revenue', 'Early revenue'], ['product_market_fit', 'Product–market fit'], ['scaling', 'Scaling revenue'], ['profitable', 'Profitable']];
  const M = { raises: [], raiseId: null, matches: [], investors: {}, filter: { band: 'top', status: '', q: '', inactive: false } };

  // ── UI injection ──────────────────────────────────────────────────────────
  function inject() {
    if ($('panel-os-matching')) return;
    const g = $('os-cap-nav-group') || $('os-nav-group'); if (!g) return;
    const b = document.createElement('button'); b.className = 'nav-item'; b.setAttribute('onclick', "nav('os-matching')"); b.setAttribute('data-os-nav', 'os-matching');
    b.innerHTML = '<span class="nav-icon material-symbols-outlined">join_inner</span>Investor Matching<span class="nav-badge" id="nb-os-approve" style="display:none"></span>';
    g.appendChild(b); b.style.display = can('matches.read') ? '' : 'none';
    $('panel-dashboard').parentNode.insertAdjacentHTML('beforeend', PANEL);
    document.body.insertAdjacentHTML('beforeend', MODALS);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') panelMeta['os-matching'] = ['Investor Matching', 'Match score /100 — human approval before any outreach'];
    $('mm-decline').innerHTML = DECLINE.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('rf-instrument').innerHTML = '<option value="">—</option>' + INSTRUMENTS.map(x => `<option>${x}</option>`).join('');
    $('rf-traction').innerHTML = TRACTION.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('im2-traction').innerHTML = TRACTION.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('im2-instruments').innerHTML = INSTRUMENTS.map(x => `<label class="mt-opt"><input type="checkbox" value="${x}"/>${x}</label>`).join('');
    // investor modal gets a link to the mandate profile
    const foot = document.querySelector('#modal-investor .modal-footer');
    if (foot) foot.insertAdjacentHTML('afterbegin', '<button class="btn btn-ghost" style="margin-right:auto" onclick="mtOpenInvestor(document.getElementById(\'im-id\').value)">Mandate &amp; relationship</button>');
    // the old client-side matcher had direct email buttons: route "Find investors" to the governed engine instead
    window.matchForRaise = id => { nav('os-matching'); setTimeout(() => selectRaise(id), 60); };
    const oldTab = $('cap-tab-match');
    if (oldTab) oldTab.innerHTML = '<div class="card card-body" style="font-size:13px">Investor matching now runs in <b>Commercial OS → Investor Matching</b>, with a match score out of 100, approval before outreach and tracking of every company–investor combination. <button class="btn btn-primary btn-sm" style="margin-left:8px" onclick="nav(\'os-matching\')">Open Investor Matching</button></div>';
  }

  // ── Panel ─────────────────────────────────────────────────────────────────
  async function loadPanel() {
    inject();
    try {
      M.raises = await q(sb().from('deal_rooms').select('*').order('created_at', { ascending: false }));
      $('mt-raise').innerHTML = '<option value="">Select a capital raise…</option>' + M.raises.map(r => `<option value="${r.id}" ${r.id === M.raiseId ? 'selected' : ''}>${esc(r.name || r.company_name || 'Untitled')} — ${esc(r.stage || '')} ${r.target_raise ? '· ' + money(r.target_raise, r.currency) : ''}</option>`).join('');
      if (M.raiseId) await selectRaise(M.raiseId); else renderEmpty();
      pendingBadge();
    } catch (e) { notify('Could not load raises: ' + e.message, 'warn'); }
  }
  function renderEmpty() { $('mt-raise-card').innerHTML = ''; $('mt-body').innerHTML = '<div class="os-empty">Choose a capital raise to see investor matches.</div>'; $('mt-summary').innerHTML = ''; }
  async function selectRaise(id) {
    M.raiseId = id || null; if ($('mt-raise').value !== (id || '')) $('mt-raise').value = id || '';
    if (!id) return renderEmpty();
    const r = M.raises.find(x => x.id === id) || (await q(sb().from('deal_rooms').select('*').eq('id', id)))[0];
    if (!r) return renderEmpty();
    const missing = [!arr(r.sectors).length && 'sectors', !r.stage && 'stage', !r.target_raise && 'target raise', !(r.geography || r.hq_country) && 'geography', !(r.instrument || r.investment_type) && 'instrument', !r.traction_stage && r.annual_revenue == null && 'traction / revenue'].filter(Boolean);
    $('mt-raise-card').innerHTML = `<div class="mt-raise"><div><div style="font-weight:700;color:var(--ink);font-size:15px">${esc(r.name || r.company_name)}</div>
      <div class="mt-attrs">${[['Sectors', arr(r.sectors).join(', ')], ['Sub-sectors', arr(r.sub_sectors).join(', ')], ['Stage', r.stage], ['Instrument', r.instrument || r.investment_type], ['Target', money(r.target_raise, r.currency)], ['Min ticket', r.min_ticket ? money(r.min_ticket, r.currency) : ''], ['Geography', [r.hq_country, r.geography].filter(Boolean).join(' · ')], ['Revenue', r.annual_revenue != null ? money(r.annual_revenue, r.currency) : ''], ['Traction', (TRACTION.find(t => t[0] === r.traction_stage) || ['', ''])[1]], ['Needs a lead', r.lead_needed ? 'Yes' : '']].filter(x => x[1]).map(([k, v]) => `<span><b>${k}</b> ${esc(v)}</span>`).join('')}</div>
      ${missing.length ? `<div class="os-flag" style="margin-top:6px">Missing: ${missing.join(', ')} — scores will be provisional</div>` : ''}</div>
      <div style="display:flex;gap:8px;flex-shrink:0">${can('*') ? `<button class="btn btn-ghost" onclick="mtEditRaise('${r.id}')">Fundraising profile</button>` : ''}${can('matches.write') ? `<button class="btn btn-primary" id="mt-run" onclick="mtRun()"><span class="material-symbols-outlined" style="font-size:15px">calculate</span>Run matching</button>` : ''}</div></div>`;
    await loadMatches();
  }
  async function loadMatches() {
    if (!M.raiseId || !$('mt-body')) return;
    const rows = await q(sb().from('os_investor_matches').select('*').eq('raise_id', M.raiseId));
    M.matches = rows;
    const ids = [...new Set(rows.map(r => r.investor_id))].filter(i => !M.investors[i]);
    for (let k = 0; k < ids.length; k += 150) {
      (await q(sb().from('investors').select('*').in('id', ids.slice(k, k + 150)))).forEach(i => { M.investors[i.id] = i; });
    }
    render();
  }
  async function run() {
    if (!M.raiseId) return;
    const b = $('mt-run'); if (b) { b.disabled = true; b.textContent = 'Scoring…'; }
    try { const n = (await sb().rpc('os_compute_matches', { p_raise: M.raiseId })); if (n.error) throw new Error(n.error.message); notify(`Scored ${n.data != null ? n.data : ''} investors`); await loadMatches(); }
    catch (e) { notify('Matching failed: ' + e.message, 'warn'); }
    if (b) { b.disabled = false; b.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px">calculate</span>Run matching'; }
  }
  function rows() {
    const f = M.filter, s = f.q.toLowerCase();
    return M.matches.filter(m => {
      const i = M.investors[m.investor_id] || {};
      if (!f.inactive && i.active === false) return false;
      if (f.band === 'top' && (m.score_total || 0) < 70 && m.status === 'suggested') return false;
      if (f.band && f.band !== 'top' && m.band !== f.band) return false;
      if (f.status && (f.status === 'pipeline' ? m.status === 'suggested' || m.status === 'not_pursued' : m.status !== f.status)) return false;
      if (s && ![i.full_name, i.organization, i.investor_type, arr(i.focus_sectors).join(' '), i.notes].join(' ').toLowerCase().includes(s)) return false;
      return true;
    }).sort((a, b) => (b.score_total || 0) - (a.score_total || 0));
  }
  function render() {
    const all = M.matches, cnt = b => all.filter(m => m.band === b).length;
    $('mt-summary').innerHTML = all.length ? BANDS.map(([b, , c]) => `<button class="mt-band${M.filter.band === b ? ' on' : ''}" style="--c:${c}" onclick="mtFilter('band','${M.filter.band === b ? '' : b}')"><b>${cnt(b)}</b>${b}</button>`).join('')
      + `<span class="mt-sum-s">${all.filter(m => m.status === 'approved').length} awaiting send · ${all.filter(m => SENT.includes(m.status)).length} sent · ${all.filter(m => POSITIVE.includes(m.status)).length} positive</span>` : '';
    const list = rows();
    if (!all.length) { $('mt-body').innerHTML = `<div class="os-empty">No scores yet for this raise. ${can('matches.write') ? 'Click <b>Run matching</b> to score every investor in the directory.' : ''}</div>`; return; }
    $('mt-body').innerHTML = list.length ? `<div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th style="width:150px">Match score</th><th>Investor</th><th>Breakdown</th><th>Why / flags</th><th>Status</th><th></th></tr></thead><tbody>${list.map(rowHtml).join('')}</tbody></table></div>`
      : '<div class="os-empty">No matches in this view. Use the filters above — by default only scores of 70+ (and anything already in progress) are shown.</div>';
  }
  function rowHtml(m) {
    const i = M.investors[m.investor_id] || {}, [band, , color] = bandOf(m.score_total), bd = m.breakdown || {};
    const reasons = arr(bd.reasons).slice(0, 4), flags = arr(m.flags);
    return `<tr><td><div class="mt-score" style="--c:${color}"><b>${m.score_total != null ? m.score_total : '—'}</b><span>${esc(band)}</span></div></td>
      <td><div style="font-weight:700;color:var(--ink);cursor:pointer" onclick="mtOpenInvestor('${i.id}')">${esc(i.organization || i.full_name || '—')}</div><div style="font-size:11px;color:var(--white-muted)">${esc(i.full_name && i.organization ? i.full_name : '')}${i.investor_type ? ' · ' + esc(i.investor_type) : ''}${i.active === false ? ' · <b style="color:#b3261e">inactive</b>' : ''}</div>
        <div style="font-size:11px;color:var(--white-muted)">Relationship ${'●'.repeat(i.relationship_strength || 0)}${'○'.repeat(5 - (i.relationship_strength || 0))}${i.last_interaction_at ? ' · last contact ' + fmtDate(i.last_interaction_at) : ''}</div></td>
      <td><div class="mt-bars">${CRITERIA.map(([k, l, max]) => `<div title="${l}: ${bd[k] != null ? bd[k] : 0}/${max}"><i style="height:${Math.round(100 * (bd[k] || 0) / max)}%"></i><span>${l.split(' ')[0].slice(0, 4)}</span></div>`).join('')}</div></td>
      <td style="font-size:11px;max-width:260px">${reasons.map(r => `<div>✓ ${esc(r)}</div>`).join('')}${flags.map(f => `<span class="os-flag">${esc(f)}</span>`).join('')}</td>
      <td><span class="mt-status mt-s-${m.status}">${esc(STATUS[m.status] || m.status)}</span>${m.contacted_at ? `<div style="font-size:10.5px;color:var(--white-muted);margin-top:3px">Sent ${fmtDate(m.contacted_at)}${m.channel ? ' · ' + esc(m.channel) : ''}</div>` : ''}${m.approved_at && !m.contacted_at ? `<div style="font-size:10.5px;color:var(--white-muted);margin-top:3px">Approved ${fmtDate(m.approved_at)}</div>` : ''}${m.decline_reason ? `<div style="font-size:10.5px;color:#8c1d18;margin-top:3px">${esc((DECLINE.find(d => d[0] === m.decline_reason) || ['', m.decline_reason])[1])}</div>` : ''}</td>
      <td><div class="mt-acts">${actions(m)}</div></td></tr>`;
  }
  function actions(m) {
    const w = can('matches.write'), ap = can('outreach.approve'), b = (label, fn, cls) => `<button class="btn ${cls || 'btn-ghost'} btn-sm" onclick="${fn}">${label}</button>`;
    const out = [];
    if (['suggested', 'not_pursued'].includes(m.status) && w) out.push(b('Shortlist', `mtStatus('${m.id}','shortlisted')`));
    if (['suggested', 'shortlisted'].includes(m.status)) { if (ap) out.push(b('Approve outreach…', `mtApprove('${m.id}')`, 'btn-primary')); if (w) out.push(b('Not pursued', `mtStatus('${m.id}','not_pursued')`)); }
    if (m.status === 'approved' && w) { out.push(b('Draft intro', `mtDraft('${m.id}')`)); out.push(b('Mark as sent…', `mtSent('${m.id}')`, 'btn-primary')); }
    if (['contacted', 'no_response'].includes(m.status) && w) out.push(b('Record response…', `mtResponse('${m.id}')`, 'btn-primary'));
    if (['interested', 'meeting', 'due_diligence', 'term_sheet'].includes(m.status) && w) out.push(b('Update…', `mtResponse('${m.id}')`));
    if (m.contacted_at && !['declined', 'invested', 'do_not_contact'].includes(m.status) && w && window.capNewMeeting) out.push(b('Meeting…', `capNewMeeting({match_id:'${m.id}'})`));
    out.push(b('History', `mtHistory('${m.id}')`));
    return out.join(' ');
  }
  async function setStatus(id, status, extra) {
    try { await q(sb().from('os_investor_matches').update(Object.assign({ status }, extra || {})).eq('id', id)); notify(STATUS[status] || 'Updated'); await loadMatches(); pendingBadge(); if (window.capRefresh) window.capRefresh(); return true; }
    catch (e) { notify(e.message, 'warn'); return false; }
  }

  // ── Approval (human, before any outreach) ─────────────────────────────────
  async function openApprove(id) {
    const m = M.matches.find(x => x.id === id); if (!m) return;
    const i = M.investors[m.investor_id] || {}, r = M.raises.find(x => x.id === m.raise_id) || {};
    let prior = [];
    try { prior = (await q(sb().from('os_investor_matches').select('*').eq('investor_id', m.investor_id).eq('company_key', m.company_key))).filter(x => x.id !== id); } catch (e) { }
    const sentBefore = prior.filter(x => SENT.includes(x.status));
    $('ma-id').value = id; $('ma-note').value = ''; $('ma-repeat').checked = false;
    $('ma-repeat-wrap').style.display = sentBefore.length ? '' : 'none';
    $('ma-h').textContent = `${i.organization || i.full_name} ← ${r.name || r.company_name}`;
    const [band, , color] = bandOf(m.score_total), bd = m.breakdown || {};
    $('ma-body').innerHTML = `<div class="mt-score" style="--c:${color};margin-bottom:10px"><b>${m.score_total}</b><span>${band}</span></div>
      <table class="data-table" style="margin-bottom:10px">${CRITERIA.map(([k, l, max]) => `<tr><td style="font-size:12px">${l}</td><td style="font-size:12px;text-align:right"><b>${bd[k] != null ? bd[k] : 0}</b> / ${max}</td></tr>`).join('')}</table>
      ${arr(m.flags).map(f => `<span class="os-flag">${esc(f)}</span>`).join('')}
      ${sentBefore.length ? `<div class="mt-warn">Already sent this company before: ${sentBefore.map(x => `${esc(STATUS[x.status])} ${x.contacted_at ? 'on ' + fmtDate(x.contacted_at) : ''}${x.decline_reason ? ' (' + esc(x.decline_reason) + ')' : ''}`).join('; ')}</div>` : ''}
      ${(m.score_total || 0) < 70 ? '<div class="mt-warn">Score is below 70 (“Do not recommend initially”). Approval needs a written reason.</div>' : ''}
      <div style="font-size:12px;color:var(--white-dim);margin-top:8px">Approving does <b>not</b> send anything. A team member drafts and sends the introduction, then marks it as sent here. Only send company information the company has agreed to share, and only to investors who meet applicable eligibility requirements.</div>`;
    $('modal-mt-approve').style.display = 'flex';
  }
  async function doApprove() {
    const id = $('ma-id').value, note = $('ma-note').value.trim(), m = M.matches.find(x => x.id === id) || {};
    if ((m.score_total || 0) < 70 && note.length < 10) return notify('Give a reason for approving a score below 70', 'warn');
    if ($('ma-repeat-wrap').style.display !== 'none' && $('ma-repeat').checked && note.length < 10) return notify('Give a reason for re-sending this company', 'warn');
    if (await setStatus(id, 'approved', { approval_note: note || null, allow_repeat: $('ma-repeat').checked })) closeModal('modal-mt-approve');
  }
  function draft(id) {
    const m = M.matches.find(x => x.id === id), i = M.investors[m.investor_id] || {}, r = M.raises.find(x => x.id === m.raise_id) || {};
    const body = `Dear ${i.full_name ? i.full_name.split(' ')[0] : 'there'},\n\nI hope you are well. Given your focus on ${arr(i.focus_sectors).slice(0, 2).join(' and ') || 'this sector'}${arr(i.preferred_stages).length ? ' at ' + arr(i.preferred_stages).slice(0, 2).join('/') : ''}, I wanted to ask whether you would be open to an introduction to ${r.company_name || r.name}, which is raising a ${r.stage || ''} round${r.target_raise ? ' of ' + money(r.target_raise, r.currency) : ''}.\n\n[Two-line company summary agreed with the company]\n\nIf it is relevant, I can share a short brief; full materials follow only with the company's consent.\n\nBANAHUB provides advisory services only and does not make investment recommendations.\n\nBest regards,`;
    $('md-text').value = body; $('md-id').value = id; $('md-to').textContent = i.email || 'no email on file';
    $('md-mail').href = i.email ? `mailto:${encodeURI(i.email)}?subject=${encodeURIComponent('Introduction: ' + (r.company_name || r.name || ''))}&body=${encodeURIComponent(body)}` : '#';
    $('md-mail').style.display = i.email ? '' : 'none';
    $('modal-mt-draft').style.display = 'flex';
  }
  function openSent(id) { $('ms-id').value = id; $('ms-channel').value = 'email'; $('ms-note').value = ''; $('ms-intro').value = ''; sentToggle(); $('modal-mt-sent').style.display = 'flex'; }
  function sentToggle() { $('ms-intro-wrap').style.display = $('ms-channel').value === 'introducer' ? '' : 'none'; }
  // recorded as the first outreach touch: the database moves the record to "contacted" through the approval guard
  async function doSent() {
    const id = $('ms-id').value, ch = $('ms-channel').value, intro = $('ms-intro').value.trim();
    if (ch === 'introducer' && !intro) return notify('Name the introducer', 'warn');
    try {
      await q(sb().from('os_outreach').insert({ match_id: id, step_no: 0, channel: ch, status: 'sent', body: $('ms-note').value.trim() || null, introducer: ch === 'introducer' ? intro : null }));
      notify('Recorded as sent'); closeModal('modal-mt-sent'); await loadMatches(); pendingBadge(); if (window.capRefresh) window.capRefresh();
    } catch (e) { notify(e.message, 'warn'); }
  }
  function openResponse(id) {
    const m = M.matches.find(x => x.id === id) || ((window.__CAP || {}).matches || []).find(x => x.id === id) || {};
    const next = { contacted: 'interested', no_response: 'interested', interested: 'meeting', meeting: 'due_diligence', due_diligence: 'term_sheet', term_sheet: 'invested' }[m.status] || 'interested';
    $('mr-id').value = id; $('mr-status').value = next; $('mr-detail').value = ''; $('mr-amount').value = '';
    const r = (M.raises || []).find(x => x.id === m.raise_id) || {}; $('mr-cur').value = r.currency || 'USD';
    toggleDecline(); $('modal-mt-response').style.display = 'flex';
  }
  function toggleDecline() { $('mr-decline-wrap').style.display = $('mr-status').value === 'declined' ? '' : 'none'; $('mr-amount-wrap').style.display = $('mr-status').value === 'invested' ? '' : 'none'; }
  async function doResponse() {
    const id = $('mr-id').value, s = $('mr-status').value, extra = { notes: $('mr-detail').value.trim() || null };
    if (s === 'declined') { extra.decline_reason = $('mm-decline').value; extra.decline_detail = $('mr-detail').value.trim() || null; }
    if (s === 'invested') { const a = $('mr-amount').value.trim(); extra.committed_amount = a ? (typeof parseMoney === 'function' ? parseMoney(a) : Number(a)) : null; extra.committed_currency = $('mr-cur').value;
      if (!(extra.committed_amount > 0)) return notify('Record the amount committed', 'warn'); }
    if (await setStatus(id, s, extra)) closeModal('modal-mt-response');
  }
  async function history(id) {
    let rows = []; try { rows = await q(sb().from('os_activity').select('*').eq('entity_type', 'match').eq('entity_id', id).order('created_at', { ascending: false })); } catch (e) { }
    const m = M.matches.find(x => x.id === id) || {}, i = M.investors[m.investor_id] || {};
    $('mh-h').textContent = `History — ${i.organization || i.full_name || ''}`;
    $('mh-body').innerHTML = (m.approval_note ? `<div class="mt-warn" style="background:#eef6f1;border-color:#cfe3d7;color:var(--ink)">Approval note: ${esc(m.approval_note)}</div>` : '')
      + (rows.length ? rows.map(r => `<div class="os-h"><span class="material-symbols-outlined">history</span><div><div style="font-size:12px">${esc(r.body)}</div><div style="font-size:11px;color:var(--white-muted)">${new Date(r.created_at).toLocaleString('en-SG')}</div></div></div>`).join('') : '<div class="os-empty">No status changes yet — this match has only been scored.</div>');
    $('modal-mt-history').style.display = 'flex';
  }
  async function pendingBadge() {
    try { const n = (await q(sb().from('os_investor_matches').select('id').eq('status', 'shortlisted'))).length; const el = $('nb-os-approve'); if (el) { el.textContent = n; el.style.display = n && can('outreach.approve') ? '' : 'none'; } } catch (e) { }
  }

  // ── Investor mandate profile ──────────────────────────────────────────────
  async function openInvestor(id) {
    if (!id) return notify('Save the investor first', 'warn');
    inject();
    const i = M.investors[id] || (await q(sb().from('investors').select('*').eq('id', id)))[0]; if (!i) return;
    M.investors[id] = i;
    $('im2-id').value = id; $('im2-h').textContent = i.organization || i.full_name || 'Investor';
    const set = (k, v) => { $('im2-' + k).value = v == null ? '' : v; };
    set('type', i.investor_type); set('sectors', arr(i.focus_sectors).join(', ')); set('sub', arr(i.sub_sectors).join(', ')); set('stages', arr(i.preferred_stages).join(', '));
    set('geos', arr(i.invest_geographies).join(', ')); set('hq', i.geography); set('min', i.check_min); set('max', i.check_max); set('cur', i.check_currency || 'USD');
    set('rev', i.min_revenue); set('traction', i.traction_requirement || ''); set('lead', i.lead_follow || ''); set('coinvest', i.co_invest || '');
    set('esg', arr(i.esg_preferences).join(', ')); set('excl', arr(i.esg_exclusions).join(', ')); set('mandate', i.current_mandate); set('appetite', i.appetite || '');
    set('portfolio', arr(i.portfolio).join(', ')); set('rel', i.relationship_strength || 0); set('last', i.last_interaction_at ? String(i.last_interaction_at).slice(0, 10) : '');
    $('im2-active').checked = i.active !== false;
    $('im2-owner').innerHTML = '<option value="">Unassigned</option>' + (OS().people || []).map(p => `<option value="${p.id}" ${p.id === i.relationship_owner ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('');
    document.querySelectorAll('#im2-instruments input').forEach(c => { c.checked = arr(i.instruments).includes(c.value); });
    // historical responses across every raise
    let hist = []; try { hist = await q(sb().from('os_investor_matches').select('*').eq('investor_id', id)); } catch (e) { }
    const sent = hist.filter(h => h.contacted_at), pos = hist.filter(h => ['interested', 'meeting', 'invested'].includes(h.status)), dec = hist.filter(h => h.status === 'declined');
    $('im2-hist').innerHTML = `<div class="mt-kv"><span><b>${sent.length}</b> sent</span><span><b>${pos.length}</b> positive</span><span><b>${dec.length}</b> declined</span><span><b>${hist.filter(h => h.status === 'no_response').length}</b> no response</span><span><b>${hist.filter(h => h.status === 'invested').length}</b> invested</span></div>`
      + (dec.length ? `<div style="font-size:12px;margin-top:6px"><b>Decline reasons:</b> ${[...new Set(dec.map(d => (DECLINE.find(x => x[0] === d.decline_reason) || ['', d.decline_reason])[1]))].map(esc).join(', ')}</div>` : '')
      + (sent.length ? `<div style="margin-top:8px">${sent.sort((a, b) => b.contacted_at > a.contacted_at ? 1 : -1).map(h => { const r = M.raises.find(x => x.id === h.raise_id) || {}; return `<div class="os-mini" style="cursor:default"><b>${esc(r.name || r.company_name || h.company_key)}</b><div>${esc(STATUS[h.status])} · sent ${fmtDate(h.contacted_at)} · score ${h.score_total}${h.decline_detail ? ' · ' + esc(h.decline_detail) : ''}</div></div>`; }).join('')}</div>` : '<div class="os-empty" style="padding:6px 0">Not contacted through BANAHUB yet.</div>');
    $('im2-save').style.display = can('investors.write') || can('*') ? '' : 'none';
    $('modal-mt-investor').style.display = 'flex';
  }
  async function saveInvestor() {
    const id = $('im2-id').value, v = k => $('im2-' + k).value.trim(), num = k => v(k) === '' ? null : (typeof parseMoney === 'function' ? parseMoney(v(k)) : Number(v(k)));
    const norm = typeof normSectors === 'function' ? s => normSectors(arr(s).join(';')) : arr;
    const p = { investor_type: v('type') || null, focus_sectors: norm(v('sectors')), sub_sectors: arr(v('sub')), preferred_stages: arr(v('stages')), invest_geographies: arr(v('geos')),
      geography: v('hq') || null, check_min: num('min'), check_max: num('max'), check_currency: v('cur') || 'USD', min_revenue: num('rev'), traction_requirement: v('traction') || null,
      lead_follow: v('lead') || null, co_invest: v('coinvest') || null, esg_preferences: arr(v('esg')), esg_exclusions: arr(v('excl')), current_mandate: v('mandate') || null,
      appetite: v('appetite') || null, portfolio: arr(v('portfolio')), relationship_strength: Math.max(0, Math.min(5, +v('rel') || 0)), last_interaction_at: v('last') || null,
      active: $('im2-active').checked, relationship_owner: v('owner') || null, instruments: [...document.querySelectorAll('#im2-instruments input:checked')].map(c => c.value) };
    const before = M.investors[id] || {};
    if (p.focus_sectors.join('|') !== arr(before.focus_sectors).join('|')) p.sector_source = p.focus_sectors.length ? 'manual' : null;
    if (p.check_min != null && p.check_max != null && p.check_min > p.check_max) return notify('Minimum cheque is larger than maximum', 'warn');
    try { const row = await q(sb().from('investors').update(p).eq('id', id).select().single()); M.investors[id] = row || Object.assign(before, p); notify('Investor profile saved — run matching again to refresh scores'); closeModal('modal-mt-investor'); if (M.raiseId) render(); }
    catch (e) { notify('Save failed: ' + e.message, 'warn'); }
  }

  // ── Raise fundraising profile ─────────────────────────────────────────────
  function editRaise(id) {
    const r = M.raises.find(x => x.id === id) || {};
    $('rf-id').value = id; $('rf-h').textContent = r.name || r.company_name || 'Capital raise';
    const set = (k, v) => { $('rf-' + k).value = v == null ? '' : v; };
    set('sectors', arr(r.sectors).join(', ')); set('sub', arr(r.sub_sectors).join(', ')); set('stage', r.stage); set('instrument', r.instrument || r.investment_type || '');
    set('target', r.target_raise); set('min', r.min_ticket); set('cur', r.currency || 'USD'); set('hq', r.hq_country); set('geo', r.geography); set('rev', r.annual_revenue);
    set('growth', r.revenue_growth_pct); set('traction', r.traction_stage || ''); set('esg', arr(r.esg_profile).join(', ')); set('use', r.use_of_funds);
    $('rf-lead').checked = !!r.lead_needed;
    $('modal-mt-raise').style.display = 'flex';
  }
  async function saveRaise() {
    const id = $('rf-id').value, v = k => $('rf-' + k).value.trim(), num = k => v(k) === '' ? null : (typeof parseMoney === 'function' ? parseMoney(v(k)) : Number(v(k)));
    const norm = typeof normSectors === 'function' ? s => normSectors(arr(s).join(';')) : arr;
    const p = { sectors: norm(v('sectors')), sub_sectors: arr(v('sub')), stage: v('stage') || null, instrument: v('instrument') || null, investment_type: v('instrument') || null,
      target_raise: num('target'), min_ticket: num('min'), currency: v('cur') || 'USD', hq_country: v('hq') || null, geography: v('geo') || null, annual_revenue: num('rev'),
      revenue_growth_pct: v('growth') === '' ? null : Number(v('growth')), traction_stage: v('traction') || null, esg_profile: arr(v('esg')), use_of_funds: v('use') || null, lead_needed: $('rf-lead').checked };
    try { await q(sb().from('deal_rooms').update(p).eq('id', id)); notify('Fundraising profile saved'); closeModal('modal-mt-raise'); await loadPanel(); if (can('matches.write') && confirm('Re-run matching with the updated profile?')) run(); }
    catch (e) { notify('Save failed: ' + e.message, 'warn'); }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  const prevLoad = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'os-matching') return loadPanel(); return prevLoad && prevLoad(p); };
  const tryInject = () => { if ($('os-nav-group') && window.__OS && window.__OS.sb) { inject(); pendingBadge(); return true; } return false; };
  Object.assign(window, {
    mtSelectRaise: selectRaise, mtRun: run, mtFilter: (k, v) => { M.filter[k] = v; if (k === 'band') { const s = $('mt-band'); if (s) s.value = v; } render(); },
    mtStatus: (id, s) => setStatus(id, s), mtApprove: openApprove, mtDoApprove: doApprove, mtDraft: draft, mtSent: openSent, mtDoSent: doSent,
    mtResponse: openResponse, mtSentToggle: sentToggle, mtDoResponse: doResponse, mtToggleDecline: toggleDecline, mtHistory: history,
    mtOpenInvestor: openInvestor, mtSaveInvestor: saveInvestor, mtEditRaise: editRaise, mtSaveRaise: saveRaise, __MT: M,
  });

  const PANEL = `
  <div id="panel-os-matching" class="panel">
    <div class="page-header"><div><div class="page-title">Investor Matching</div><div class="page-sub">Match score /100 · 90+ Exceptional · 80–89 Strong · 70–79 Possible · below 70 not recommended initially</div></div></div>
    <div class="filter-bar" style="flex-wrap:wrap">
      <select id="mt-raise" class="f-input f-select" style="min-width:300px" onchange="mtSelectRaise(this.value)"></select>
      <select id="mt-band" class="f-input f-select" style="width:210px" onchange="mtFilter('band',this.value)"><option value="top">70+ and in progress</option><option value="">All scores</option><option>Exceptional match</option><option>Strong match</option><option>Possible match</option><option>Do not recommend initially</option></select>
      <select class="f-input f-select" style="width:190px" onchange="mtFilter('status',this.value)"><option value="">All statuses</option><option value="pipeline">Not yet actioned</option><option value="shortlisted">Shortlisted</option><option value="approved">Approved — to send</option><option value="contacted">Sent — awaiting reply</option><option value="interested">Interested</option><option value="meeting">Meeting</option><option value="declined">Declined</option><option value="no_response">No response</option><option value="invested">Invested</option></select>
      <input class="f-input" placeholder="Search investor…" style="max-width:220px" oninput="mtFilter('q',this.value)"/>
      <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" onchange="mtFilter('inactive',this.checked)"/>Include inactive</label>
    </div>
    <div id="mt-raise-card"></div>
    <div id="mt-summary" class="mt-summary"></div>
    <div class="card" id="mt-body"></div>
    <div style="font-size:11px;color:var(--white-muted);margin-top:10px">Weights: sector 20 · stage 15 · cheque 15 · geography 15 · instrument 10 · traction 10 · mandate / current appetite 10 · BANAHUB relationship 5. Missing investor data earns partial credit and is flagged as provisional. Nothing is sent automatically: outreach needs CEO approval, is sent by a person, and each company–investor combination is tracked so it is not sent twice.</div>
  </div>`;

  const MODALS = `
  <div id="modal-mt-approve" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-mt-approve')"><div class="modal" style="max-width:560px">
    <div class="modal-header"><div><div class="modal-title">Approve outreach</div><div class="modal-sub" id="ma-h"></div></div><button class="modal-close" onclick="closeModal('modal-mt-approve')">✕</button></div>
    <div class="modal-body"><input type="hidden" id="ma-id"/><div id="ma-body"></div>
      <div class="f-group" style="margin-top:12px"><label class="f-label" for="ma-note">Approval note</label><input id="ma-note" class="f-input" placeholder="Why this investor, and anything to say in the intro"/></div>
      <label id="ma-repeat-wrap" style="font-size:12px;display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="ma-repeat"/>Allow sending this company to this investor again (reason required)</label></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-mt-approve')">Cancel</button><button class="btn btn-primary" onclick="mtDoApprove()">Approve for outreach</button></div></div></div>
  <div id="modal-mt-draft" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-mt-draft')"><div class="modal" style="max-width:640px">
    <div class="modal-header"><div><div class="modal-title">Draft introduction</div><div class="modal-sub">To: <span id="md-to"></span> — edit before sending. Nothing is sent from here.</div></div><button class="modal-close" onclick="closeModal('modal-mt-draft')">✕</button></div>
    <div class="modal-body"><input type="hidden" id="md-id"/><textarea id="md-text" class="f-input" rows="14" style="width:100%;font-size:13px;line-height:1.5"></textarea></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('md-text').value);toast('Copied','success')">Copy</button><a id="md-mail" class="btn btn-ghost" target="_blank" rel="noopener">Open in my email</a><button class="btn btn-primary" onclick="closeModal('modal-mt-draft');mtSent(document.getElementById('md-id').value)">I've sent it — record</button></div></div></div>
  <div id="modal-mt-sent" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-mt-sent')"><div class="modal" style="max-width:460px">
    <div class="modal-header"><div class="modal-title">Record outreach</div><button class="modal-close" onclick="closeModal('modal-mt-sent')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:10px"><input type="hidden" id="ms-id"/>
      <div class="f-group"><label class="f-label" for="ms-channel">Sent via</label><select id="ms-channel" class="f-input f-select" onchange="mtSentToggle()"><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="event">Event</option><option value="introducer">Introducer</option><option value="other">Other</option></select></div>
      <div class="f-group" id="ms-intro-wrap"><label class="f-label" for="ms-intro">Introducer</label><input id="ms-intro" class="f-input" placeholder="Who made the introduction"/></div>
      <div class="f-group"><label class="f-label" for="ms-note">Note</label><input id="ms-note" class="f-input" placeholder="What was shared"/></div>
      <div style="font-size:11px;color:var(--white-muted)">Once recorded, this company cannot be sent to this investor again without a new, reasoned approval.</div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-mt-sent')">Cancel</button><button class="btn btn-primary" onclick="mtDoSent()">Record as sent</button></div></div></div>
  <div id="modal-mt-response" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-mt-response')"><div class="modal" style="max-width:460px">
    <div class="modal-header"><div class="modal-title">Investor response</div><button class="modal-close" onclick="closeModal('modal-mt-response')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:10px"><input type="hidden" id="mr-id"/>
      <div class="f-group"><label class="f-label" for="mr-status">Outcome</label><select id="mr-status" class="f-input f-select" onchange="mtToggleDecline()"><option value="interested">Interested</option><option value="meeting">Meeting arranged</option><option value="due_diligence">Due diligence</option><option value="term_sheet">Term sheet</option><option value="invested">Invested</option><option value="declined">Declined</option><option value="no_response">No response</option></select></div>
      <div class="f-group" id="mr-amount-wrap"><label class="f-label" for="mr-amount">Amount committed</label><div style="display:flex;gap:6px"><select id="mr-cur" class="f-input f-select" style="width:84px"><option>USD</option><option>SGD</option><option>EUR</option><option>GBP</option><option>AED</option><option>AUD</option><option>HKD</option></select><input id="mr-amount" class="f-input" placeholder="1.5m"/></div></div>
      <div class="f-group" id="mr-decline-wrap"><label class="f-label" for="mm-decline">Decline reason</label><select id="mm-decline" class="f-input f-select"></select></div>
      <div class="f-group"><label class="f-label" for="mr-detail">Detail</label><input id="mr-detail" class="f-input" placeholder="What they said"/></div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-mt-response')">Cancel</button><button class="btn btn-primary" onclick="mtDoResponse()">Save</button></div></div></div>
  <div id="modal-mt-history" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-mt-history')"><div class="modal" style="max-width:520px">
    <div class="modal-header"><div class="modal-title" id="mh-h">History</div><button class="modal-close" onclick="closeModal('modal-mt-history')">✕</button></div><div class="modal-body" id="mh-body"></div></div></div>
  <div id="modal-mt-investor" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-mt-investor')"><div class="modal modal-lg" style="max-width:1000px">
    <div class="modal-header"><div><div class="modal-title" id="im2-h">Investor</div><div class="modal-sub">Mandate, relationship and response history — drives the match score</div></div><button class="modal-close" onclick="closeModal('modal-mt-investor')">✕</button></div>
    <div class="modal-body os-split"><div style="display:flex;flex-direction:column;gap:10px;min-width:0"><input type="hidden" id="im2-id"/>
      <div class="f-grid">
        <div class="f-group"><label class="f-label" for="im2-type">Type</label><select id="im2-type" class="f-input f-select"><option value="">—</option><option>VC</option><option>Angel</option><option>Family Office</option><option>Private Equity</option><option>Corporate VC</option><option>Hedge Fund</option><option>LP / Fund of Funds</option><option>Accelerator</option><option>Bank / Debt</option><option>Sovereign / Government</option><option>Other</option></select></div>
        <div class="f-group"><label class="f-label" for="im2-appetite">Current appetite</label><select id="im2-appetite" class="f-input f-select"><option value="">Unknown</option><option value="active">Actively deploying</option><option value="selective">Selective</option><option value="paused">Paused</option><option value="not_deploying">Not deploying</option></select></div>
        <div class="f-group"><label class="f-label" for="im2-sectors">Sectors</label><input id="im2-sectors" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="im2-sub">Sub-sectors</label><input id="im2-sub" class="f-input" placeholder="e.g. payments, B2B lending"/></div>
        <div class="f-group"><label class="f-label" for="im2-stages">Stages</label><input id="im2-stages" class="f-input" placeholder="Seed, Series A"/></div>
        <div class="f-group"><label class="f-label" for="im2-geos">Invests in (geographies)</label><input id="im2-geos" class="f-input" placeholder="Southeast Asia, Singapore"/></div>
        <div class="f-group"><label class="f-label" for="im2-min">Min cheque</label><div style="display:flex;gap:6px"><select id="im2-cur" class="f-input f-select" style="width:84px"><option>USD</option><option>SGD</option><option>EUR</option><option>GBP</option><option>AED</option><option>AUD</option><option>HKD</option></select><input id="im2-min" class="f-input" placeholder="250k"/></div></div>
        <div class="f-group"><label class="f-label" for="im2-max">Max cheque</label><input id="im2-max" class="f-input" placeholder="2m"/></div>
        <div class="f-group"><label class="f-label" for="im2-rev">Revenue requirement (annual)</label><input id="im2-rev" class="f-input" placeholder="1m"/></div>
        <div class="f-group"><label class="f-label" for="im2-traction">Traction requirement</label><select id="im2-traction" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="im2-lead">Lead / follow</label><select id="im2-lead" class="f-input f-select"><option value="">Unknown</option><option value="lead">Leads</option><option value="follow">Follows only</option><option value="either">Either</option></select></div>
        <div class="f-group"><label class="f-label" for="im2-coinvest">Co-invest</label><select id="im2-coinvest" class="f-input f-select"><option value="">Unknown</option><option value="yes">Yes</option><option value="selective">Selective</option><option value="no">No</option></select></div>
        <div class="f-group"><label class="f-label" for="im2-esg">ESG preferences</label><input id="im2-esg" class="f-input" placeholder="e.g. climate impact, gender lens"/></div>
        <div class="f-group"><label class="f-label" for="im2-excl">Excluded sectors</label><input id="im2-excl" class="f-input" placeholder="e.g. Oil & Gas, Gaming"/></div>
        <div class="f-group"><label class="f-label" for="im2-hq">Based in (HQ)</label><input id="im2-hq" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="im2-owner">Relationship owner</label><select id="im2-owner" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="im2-rel">Relationship strength (0–5)</label><input id="im2-rel" type="number" min="0" max="5" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="im2-last">Last interaction</label><input id="im2-last" type="date" class="f-input"/></div>
      </div>
      <div class="f-group"><span class="f-label">Investment instruments</span><div id="im2-instruments" class="mt-opts"></div></div>
      <div class="f-group"><label class="f-label" for="im2-mandate">Current mandate</label><textarea id="im2-mandate" rows="2" class="f-input" placeholder="Fund, vintage, thesis, current priorities"></textarea></div>
      <div class="f-group"><label class="f-label" for="im2-portfolio">Portfolio (comma separated)</label><input id="im2-portfolio" class="f-input"/></div>
      <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="im2-active"/>Active — include in matching recommendations</label></div>
      <div style="min-width:0"><div class="os-box"><div class="os-box-h">Historical responses</div><div id="im2-hist"></div></div></div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-mt-investor')">Close</button><button class="btn btn-primary" id="im2-save" onclick="mtSaveInvestor()">Save profile</button></div></div></div>
  <div id="modal-mt-raise" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-mt-raise')"><div class="modal" style="max-width:760px">
    <div class="modal-header"><div><div class="modal-title" id="rf-h">Fundraising profile</div><div class="modal-sub">The company's side of the match</div></div><button class="modal-close" onclick="closeModal('modal-mt-raise')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:10px"><input type="hidden" id="rf-id"/>
      <div class="f-grid">
        <div class="f-group"><label class="f-label" for="rf-sectors">Sectors</label><input id="rf-sectors" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="rf-sub">Sub-sectors</label><input id="rf-sub" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="rf-stage">Round / stage</label><select id="rf-stage" class="f-input f-select"><option value="">—</option><option>Pre-seed</option><option>Seed</option><option>Series A</option><option>Series B</option><option>Series C+</option><option>Growth</option><option>Pre-IPO</option><option>Debt</option></select></div>
        <div class="f-group"><label class="f-label" for="rf-instrument">Instrument</label><select id="rf-instrument" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="rf-target">Target raise</label><div style="display:flex;gap:6px"><select id="rf-cur" class="f-input f-select" style="width:84px"><option>USD</option><option>SGD</option><option>EUR</option><option>GBP</option><option>AED</option><option>AUD</option></select><input id="rf-target" class="f-input" placeholder="5m"/></div></div>
        <div class="f-group"><label class="f-label" for="rf-min">Minimum ticket</label><input id="rf-min" class="f-input" placeholder="250k"/></div>
        <div class="f-group"><label class="f-label" for="rf-hq">HQ country</label><input id="rf-hq" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="rf-geo">Markets</label><input id="rf-geo" class="f-input" placeholder="Singapore, Indonesia"/></div>
        <div class="f-group"><label class="f-label" for="rf-rev">Annual revenue</label><input id="rf-rev" class="f-input" placeholder="3m"/></div>
        <div class="f-group"><label class="f-label" for="rf-growth">Revenue growth % (12m)</label><input id="rf-growth" type="number" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="rf-traction">Traction</label><select id="rf-traction" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="rf-esg">ESG profile</label><input id="rf-esg" class="f-input" placeholder="e.g. climate impact"/></div>
      </div>
      <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="rf-lead"/>Round still needs a lead investor</label>
      <div class="f-group"><label class="f-label" for="rf-use">Use of funds</label><textarea id="rf-use" rows="2" class="f-input"></textarea></div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-mt-raise')">Cancel</button><button class="btn btn-primary" onclick="mtSaveRaise()">Save</button></div></div></div>`;

  const CSS = `
  .mt-raise{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;margin-bottom:12px}
  .mt-attrs{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--white-dim);margin-top:6px}.mt-attrs b{color:var(--white-muted);font-weight:600;margin-right:3px}
  .mt-summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
  .mt-band{border:1px solid var(--c);background:#fff;color:var(--c);border-radius:8px;padding:6px 10px;font:600 12px var(--font-ui);cursor:pointer;display:flex;gap:6px;align-items:baseline}.mt-band b{font-size:16px}.mt-band.on{background:var(--c);color:#fff}
  .mt-sum-s{margin-left:auto;font-size:12px;color:var(--white-muted)}
  .mt-score{display:flex;flex-direction:column;border-left:4px solid var(--c);padding-left:8px}.mt-score b{font-size:22px;color:var(--c);line-height:1.1}.mt-score span{font-size:10.5px;font-weight:700;color:var(--c)}
  .mt-bars{display:flex;gap:4px;align-items:flex-end;height:44px}.mt-bars div{width:22px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative}
  .mt-bars i{display:block;width:12px;background:var(--emerald);border-radius:2px 2px 0 0;min-height:2px}.mt-bars span{font-size:8.5px;color:var(--white-muted);margin-top:2px}
  .mt-status{display:inline-block;font-size:10.5px;font-weight:700;border-radius:4px;padding:2px 7px;background:var(--surface-2,#eee);color:var(--ink)}
  .mt-s-shortlisted{background:#e8f0f8;color:#1a4d7a}.mt-s-approved{background:#fff4d6;color:#7a5c00}.mt-s-contacted{background:#e8f0ec;color:#0a5c40}
  .mt-s-interested,.mt-s-meeting,.mt-s-due_diligence,.mt-s-term_sheet,.mt-s-invested{background:#0a5c40;color:#fff}.mt-s-declined,.mt-s-do_not_contact{background:#fdecea;color:#8c1d18}.mt-s-not_pursued,.mt-s-no_response{opacity:.7}
  .mt-warn{background:#fff8e6;border:1px solid #f0dca0;color:#6b5000;border-radius:8px;padding:8px 10px;font-size:12px;margin:8px 0}
  .mt-opts{display:flex;flex-wrap:wrap;gap:6px}.mt-opt{font-size:12px;display:flex;gap:4px;align-items:center;border:1px solid var(--border);border-radius:6px;padding:4px 8px}
  .mt-acts{display:flex;flex-direction:column;gap:4px;min-width:150px}.mt-acts .btn{justify-content:center;white-space:nowrap}
  .mt-kv{display:flex;flex-wrap:wrap;gap:12px;font-size:12px}.mt-kv b{font-size:16px;color:var(--ink)}`;

  if (!tryInject()) { const t = setInterval(() => { if (tryInject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000); }
})();
