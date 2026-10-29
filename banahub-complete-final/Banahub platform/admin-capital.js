/* BANAHUB Capital OS — six screens inside Admin OS:
 * Capital Command Centre · Deal Pipeline · Investor CRM · Campaign Engine · Meeting Centre · Analytics
 * (Investor Matching lives in admin-match.js and sits in the same nav group.)
 * Rules carried from the database (16_capital_os.sql): no outreach without human approval, the system never
 * sends anything — each email / LinkedIn / introducer touch is drafted here, sent by a person, then recorded.
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
  async function q(promise) { const r = await promise; if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; }
  const DAY = 864e5, today = () => new Date(new Date().toDateString());
  const iso = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '—';
  const fmtDT = d => d ? new Date(d).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const FX = { USD: 1, SGD: 0.74, EUR: 1.08, GBP: 1.27, AED: 0.272, AUD: 0.66, HKD: 0.128, JPY: 0.0066, MYR: 0.22, IDR: 0.000063, INR: 0.012 };
  const usd = (n, c) => n == null || n === '' ? 0 : Number(n) * (FX[String(c || 'USD').toUpperCase()] || 1);
  const short = n => { n = Number(n) || 0; const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)); };
  const money = (n, c) => n == null || n === '' ? '—' : `${c || 'USD'} ${short(n)}`;
  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
  const person = id => (OS().people || []).find(p => p.id === id);
  const pname = id => { const p = person(id); return p ? (p.full_name || p.email) : id ? 'Team member' : 'Unassigned'; };
  const ownerOpts = sel => '<option value="">Unassigned</option>' + (OS().people || []).map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('');

  const STAGES = [['new', 'New'], ['screening', 'Screening'], ['ready', 'Ready'], ['campaign', 'Campaign'], ['investor_interest', 'Investor interest'], ['meeting', 'Meeting'], ['dd', 'DD'], ['negotiation', 'Negotiation'], ['closed', 'Closed']];
  const OFF = [['on_hold', 'On hold'], ['lost', 'Lost']];
  const stageLabel = s => ([...STAGES, ...OFF].find(x => x[0] === s) || [s, s || '—'])[1];
  const OPEN = r => !['closed', 'lost'].includes(r.pipeline_stage || 'new');
  const MSTAT = { suggested: 'Suggested', shortlisted: 'Shortlisted', approved: 'Approved', contacted: 'Sent', interested: 'Interested', meeting: 'Meeting', due_diligence: 'Due diligence', term_sheet: 'Term sheet', declined: 'Declined', no_response: 'No response', invested: 'Invested', not_pursued: 'Not pursued', do_not_contact: 'Do not contact' };
  const CH = { email: ['mail', 'Email'], linkedin: ['work', 'LinkedIn'], introducer: ['handshake', 'Introducer'], call: ['call', 'Call'], meeting: ['groups', 'Meeting'], event: ['event', 'Event'], other: ['more_horiz', 'Other'] };
  const DEFAULT_SEQ = [{ day: 0, channel: 'email', label: 'Introduction' }, { day: 3, channel: 'linkedin', label: 'LinkedIn connect' }, { day: 7, channel: 'email', label: 'Follow-up 1' }, { day: 14, channel: 'introducer', label: 'Introducer nudge' }, { day: 21, channel: 'email', label: 'Follow-up 2' }];
  const IN_PLAY = ['approved', 'contacted', 'no_response'];
  const C = { raises: [], matches: [], investors: {}, campaigns: [], outreach: [], meetings: [], loaded: 0, deals: { off: false }, crm: { q: '', type: '', shown: false, inactive: false, sort: 'score', limit: 100 }, camp: { open: null }, meet: { tab: 'upcoming' }, an: { raise: '', campaign: '', channel: '', days: '' } };

  // ── data ──────────────────────────────────────────────────────────────────
  async function load(force) {
    if (!force && Date.now() - C.loaded < 1500) return;
    const s = sb();
    const [raises, matches, invs, camps, outs, meets] = await Promise.all([
      q(s.from('deal_rooms').select('*').order('created_at', { ascending: false })),
      q(s.from('os_investor_matches').select('*')),
      q(s.from('investors').select('*')),
      q(s.from('os_campaigns').select('*').order('created_at', { ascending: false })).catch(() => []),
      q(s.from('os_outreach').select('*')).catch(() => []),
      q(s.from('os_meetings').select('*').order('meeting_at', { ascending: true })).catch(() => []),
    ]);
    C.raises = raises || []; C.matches = matches || []; C.campaigns = camps || []; C.outreach = outs || []; C.meetings = meets || [];
    C.investors = {}; (invs || []).forEach(i => { C.investors[i.id] = i; });
    C.loaded = Date.now();
    if (window.__MT) { window.__MT.raises = C.raises; Object.assign(window.__MT.investors, C.investors); }
  }
  const raise = id => C.raises.find(r => r.id === id) || {};
  const inv = id => C.investors[id] || {};
  const match = id => C.matches.find(m => m.id === id) || {};
  const raiseName = r => r.name || r.company_name || 'Untitled raise';
  const invName = i => i.organization || i.full_name || 'Investor';
  const seqOf = c => (Array.isArray(c.sequence) && c.sequence.length ? c.sequence : DEFAULT_SEQ);
  const touches = (mid, cid) => C.outreach.filter(o => o.match_id === mid && (cid === undefined || o.campaign_id === cid)).sort((a, b) => a.step_no - b.step_no);

  // next step due for a cohort member (null when the sequence has finished or the investor responded)
  function nextStep(m, c) {
    if (c.status !== 'active' || !IN_PLAY.includes(m.status) || m.replied_at) return null;
    const seq = seqOf(c), done = touches(m.id, c.id), doneSet = new Set(done.map(o => o.step_no));
    const i = seq.findIndex((_, k) => !doneSet.has(k)); if (i < 0) return null;
    const firstSent = done.filter(o => o.sent_at).sort((a, b) => a.sent_at > b.sent_at ? 1 : -1)[0];
    const base = firstSent ? new Date(new Date(firstSent.sent_at).toDateString()).getTime() - (seq[firstSent.step_no] || { day: 0 }).day * DAY : today().getTime() - seq[i].day * DAY;
    const due = new Date(base + seq[i].day * DAY);
    return { m, c, i, step: seq[i], due, overdue: due < today(), today: iso(due) === iso(today()) };
  }
  function queue(campaignId) {
    const out = [];
    C.campaigns.filter(c => !campaignId || c.id === campaignId).forEach(c => C.matches.filter(m => m.campaign_id === c.id).forEach(m => { const n = nextStep(m, c); if (n) out.push(n); }));
    return out.sort((a, b) => a.due - b.due);
  }
  const dueNow = () => queue().filter(n => n.due <= today() || n.today);

  // ── UI injection ──────────────────────────────────────────────────────────
  const SCREENS = [
    ['os-capital', 'rocket_launch', 'Capital Command Centre', 'Capital sought → mandates → targets → outreach → meetings → DD → term sheets → capital closed'],
    ['os-deals', 'view_kanban', 'Deal Pipeline', 'New → Screening → Ready → Campaign → Investor interest → Meeting → DD → Negotiation → Closed'],
    ['os-investors', 'account_balance', 'Investor CRM', 'Investor → mandate → score → relationship → deals shown → responses → meetings → investments'],
    ['os-campaigns', 'campaign', 'Campaign Engine', 'Deal → investor cohort → email → LinkedIn → introducer → follow-ups → replies'],
    ['os-meetings', 'event_available', 'Meeting Centre', 'Investor → company → date → meeting brief → notes → next action'],
    ['os-cap-analytics', 'monitoring', 'Capital Analytics', 'Contacted → opened → replied → interested → meetings → DD → terms → closed'],
  ];
  function inject() {
    if ($('os-cap-nav-group')) return true;
    const osg = $('os-nav-group'); if (!osg) return false;
    const g = document.createElement('div'); g.className = 'nav-group'; g.id = 'os-cap-nav-group';
    g.innerHTML = '<div class="nav-label">Capital</div>' + SCREENS.map(([id, ic, label]) => `<button class="nav-item" onclick="nav('${id}')" data-os-nav="${id}"><span class="nav-icon material-symbols-outlined">${ic}</span>${label}${id === 'os-campaigns' ? '<span class="nav-badge" id="nb-cap-due" style="display:none"></span>' : ''}${id === 'os-meetings' ? '<span class="nav-badge" id="nb-cap-meet" style="display:none"></span>' : ''}</button>`).join('');
    osg.parentNode.insertBefore(g, osg.nextSibling);
    placeMatching();
    g.style.display = can('matches.read') ? '' : 'none';
    $('panel-dashboard').parentNode.insertAdjacentHTML('beforeend', SCREENS.map(([id]) => `<div id="panel-${id}" class="panel"></div>`).join(''));
    document.body.insertAdjacentHTML('beforeend', MODALS);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const SUB = { 'os-capital': 'Capital overview', 'os-deals': 'Every raise by stage', 'os-investors': 'Mandates, relationships and responses', 'os-campaigns': 'Approved cohorts, sequences, follow-ups', 'os-meetings': 'Briefs, notes, next actions', 'os-cap-analytics': 'Investor funnel and conversion' };
    if (typeof panelMeta !== 'undefined') SCREENS.forEach(([id, , t]) => { panelMeta[id] = [t, SUB[id]]; });
    $('cr-stage').innerHTML = [...STAGES, ...OFF].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    badges();
    return true;
  }
  function placeMatching() { const g = $('os-cap-nav-group'), b = document.querySelector('[data-os-nav="os-matching"]'), crm = document.querySelector('#os-cap-nav-group [data-os-nav="os-investors"]');
    if (g && b && crm && crm.nextElementSibling !== b) g.insertBefore(b, crm.nextElementSibling); }
  async function badges() {
    try {
      await load();
      const d = dueNow().length, el = $('nb-cap-due'); if (el) { el.textContent = d; el.style.display = d ? '' : 'none'; }
      const m = C.meetings.filter(x => x.status === 'scheduled' && new Date(x.meeting_at) - Date.now() < 7 * DAY && new Date(x.meeting_at) > Date.now() - DAY).length, em = $('nb-cap-meet');
      if (em) { em.textContent = m; em.style.display = m ? '' : 'none'; }
    } catch (e) { }
  }
  const header = (id, actions) => { const s = SCREENS.find(x => x[0] === id); return `<div class="page-header"><div><div class="page-title">${s[2]}</div><div class="page-sub cap-chain">${s[3].split(' → ').map(x => `<span>${esc(x)}</span>`).join('<i>→</i>')}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${actions || ''}</div></div>`; };
  const guard = p => { if (!can('matches.read')) { $('panel-' + p).innerHTML = header(p) + '<div class="card os-empty">Your role does not include capital and investor data.</div>'; return false; } return true; };

  // ── 1. CAPITAL COMMAND CENTRE ─────────────────────────────────────────────
  async function renderCommand() {
    const P = $('panel-os-capital'); if (!guard('os-capital')) return;
    P.innerHTML = header('os-capital') + '<div class="os-empty">Loading…</div>';
    try { await load(true); } catch (e) { P.innerHTML = header('os-capital') + `<div class="card os-empty">Could not load capital data: ${esc(e.message)}. Migration 16 must be applied.</div>`; return; }
    const open = C.raises.filter(OPEN), openIds = new Set(open.map(r => r.id));
    const sought = open.reduce((a, r) => a + usd(r.target_raise, r.currency), 0);
    const closed = C.raises.reduce((a, r) => a + usd(r.raised_amount, r.currency), 0);
    const mOpen = C.matches.filter(m => openIds.has(m.raise_id));
    const now = Date.now(), up = C.meetings.filter(x => x.status === 'scheduled' && new Date(x.meeting_at) >= now - 36e5);
    const due = dueNow();
    const tiles = [
      ['Capital sought', short(sought), `${open.length} open raise${open.length === 1 ? '' : 's'} · indicative USD`, 'os-deals'],
      ['Active mandates', C.raises.filter(r => OPEN(r) && r.mandate_status === 'signed').length, `${C.raises.filter(r => OPEN(r) && r.mandate_status === 'proposed').length} proposed`, 'os-deals'],
      ['Investor targets', mOpen.filter(m => ['shortlisted', 'approved'].includes(m.status)).length, `${mOpen.filter(m => m.status === 'shortlisted').length} awaiting approval`, 'os-matching'],
      ['Outreach', C.matches.filter(m => m.contacted_at).length, `${due.length} follow-up${due.length === 1 ? '' : 's'} due`, 'os-campaigns', due.some(n => n.overdue)],
      ['Meetings', up.length, `upcoming · ${C.meetings.filter(x => x.status === 'held').length} held`, 'os-meetings'],
      ['DD', C.matches.filter(m => m.status === 'due_diligence').length, 'investors in due diligence', 'os-investors'],
      ['Term sheets', C.matches.filter(m => m.status === 'term_sheet').length, 'issued / in negotiation', 'os-investors'],
      ['Capital closed', short(closed), sought ? `${pct(closed, sought + closed)} of capital sought + closed` : 'across all raises', 'os-cap-analytics'],
    ];
    const attention = [];
    open.forEach(r => {
      if (!r.next_action) attention.push(['flag', `${raiseName(r)} has no next action`, `capOpenRaise('${r.id}')`]);
      else if (r.next_action_date && new Date(r.next_action_date) < today()) attention.push(['schedule', `${raiseName(r)}: “${r.next_action}” overdue since ${fmtD(r.next_action_date)}`, `capOpenRaise('${r.id}')`]);
    });
    const waiting = mOpen.filter(m => m.status === 'shortlisted').length;
    if (waiting && can('outreach.approve')) attention.push(['how_to_reg', `${waiting} shortlisted investor${waiting === 1 ? '' : 's'} awaiting your outreach approval`, "nav('os-matching')"]);
    if (due.length) attention.push(['send', `${due.length} campaign step${due.length === 1 ? '' : 's'} due to send today${due.some(n => n.overdue) ? ' (some overdue)' : ''}`, "nav('os-campaigns')"]);
    C.meetings.filter(x => x.status === 'scheduled' && new Date(x.meeting_at) < now - 2 * 36e5).forEach(x => attention.push(['edit_note', `Meeting with ${invName(inv(x.investor_id))} on ${fmtD(x.meeting_at)} — record notes and next action`, `capOpenMeeting('${x.id}')`]));
    C.meetings.filter(x => x.status === 'scheduled' && new Date(x.meeting_at) >= now && new Date(x.meeting_at) - now < 2 * DAY && !x.brief).forEach(x => attention.push(['description', `Brief missing for ${invName(inv(x.investor_id))} (${fmtDT(x.meeting_at)})`, `capOpenMeeting('${x.id}')`]));
    const rows = open.map(r => {
      const ms = C.matches.filter(m => m.raise_id === r.id), meets = C.meetings.filter(x => x.raise_id === r.id && x.status !== 'cancelled');
      const odue = r.next_action_date && new Date(r.next_action_date) < today();
      return `<tr onclick="capOpenRaise('${r.id}')" style="cursor:pointer"><td><b style="color:var(--ink)">${esc(raiseName(r))}</b><div style="font-size:11px;color:var(--white-muted)">${esc(r.stage || '')} · ${esc(pname(r.os_owner_id))}</div></td>
        <td><span class="cap-stage">${esc(stageLabel(r.pipeline_stage))}</span>${r.mandate_status === 'signed' ? '<div class="os-flag os-flag-info">Mandate signed</div>' : ''}</td>
        <td>${money(r.target_raise, r.currency)}</td><td>${ms.filter(m => ['shortlisted', 'approved'].includes(m.status)).length}</td><td>${ms.filter(m => m.contacted_at).length}</td>
        <td>${meets.length}</td><td>${ms.filter(m => m.status === 'due_diligence').length}</td><td>${ms.filter(m => m.status === 'term_sheet').length}</td>
        <td>${money(r.raised_amount || 0, r.currency)} <span style="color:var(--white-muted);font-size:11px">${r.target_raise ? pct(r.raised_amount || 0, r.target_raise) : ''}</span></td>
        <td style="font-size:12px">${r.next_action ? `<span class="${odue ? 'cap-od' : ''}">${esc(r.next_action)}${r.next_action_date ? ' · ' + fmtD(r.next_action_date) : ''}</span>` : '<span class="os-flag">No next action</span>'}</td></tr>`;
    }).join('');
    P.innerHTML = header('os-capital', can('raises.write') ? '<button class="btn btn-primary" onclick="capNewRaise()"><span class="material-symbols-outlined" style="font-size:15px">add</span>New raise</button>' : '') + `
      <div class="cap-flow">${tiles.map(([l, v, s, to, warn], k) => `<button class="cap-tile${warn ? ' warn' : ''}" onclick="nav('${to}')"><div class="cap-tile-n">${k + 1}</div><div class="cap-tile-l">${l}</div><div class="cap-tile-v">${/^(Capital)/.test(l) ? '<small>USD</small> ' : ''}${esc(v)}</div><div class="cap-tile-s">${esc(s)}</div></button>`).join('')}</div>
      <div class="os-dash-grid" style="margin-bottom:16px">
        <div class="card ${attention.length ? 'os-card-alert' : ''}"><div class="card-header"><div class="card-title">Needs attention <span class="os-count">${attention.length}</span></div></div><div class="card-body" style="padding-top:0">
          ${attention.length ? attention.slice(0, 14).map(([ic, t, fn]) => `<div class="os-h" style="cursor:pointer" onclick="${fn}"><span class="material-symbols-outlined">${ic}</span><div style="font-size:12px">${esc(t)}</div></div>`).join('') : '<div class="os-empty">Nothing overdue. Every open raise has a next action.</div>'}</div></div>
        <div class="card"><div class="card-header"><div class="card-title">Next meetings</div></div><div class="card-body" style="padding-top:0">${up.slice(0, 6).map(x => `<div class="os-mini" onclick="capOpenMeeting('${x.id}')"><b>${esc(invName(inv(x.investor_id)))}</b> × ${esc(raiseName(raise(x.raise_id)))}<div>${fmtDT(x.meeting_at)} · brief ${x.brief ? 'ready' : 'missing'}</div></div>`).join('') || '<div class="os-empty">None scheduled.</div>'}</div></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Open raises</div></div><div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Raise</th><th>Stage</th><th>Sought</th><th>Targets</th><th>Outreach</th><th>Meetings</th><th>DD</th><th>Terms</th><th>Closed</th><th>Next action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10"><div class="os-empty">No open raises. ${can('raises.write') ? 'Create one with <b>New raise</b>.' : ''}</div></td></tr>`}</tbody></table></div></div>`;
  }

  // ── 2. DEAL PIPELINE ──────────────────────────────────────────────────────
  async function renderDeals() {
    const P = $('panel-os-deals'); if (!guard('os-deals')) return;
    try { await load(true); } catch (e) { P.innerHTML = header('os-deals') + `<div class="card os-empty">${esc(e.message)}</div>`; return; }
    const cols = C.deals.off ? [...STAGES, ...OFF] : STAGES, w = can('raises.write');
    const card = r => {
      const ms = C.matches.filter(m => m.raise_id === r.id), odue = r.next_action_date && new Date(r.next_action_date) < today(), mt = C.meetings.filter(x => x.raise_id === r.id && x.status !== 'cancelled').length;
      return `<div class="os-card${!r.next_action || odue ? ' os-card-stalled' : ''}" ${w ? `draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${r.id}')"` : ''} onclick="capOpenRaise('${r.id}')">
        <div class="os-card-t">${esc(raiseName(r))}</div><div class="os-card-s">${esc([r.stage, r.instrument || r.investment_type].filter(Boolean).join(' · '))}</div>
        <div class="os-card-m"><b>${money(r.target_raise, r.currency)}</b>${r.raised_amount ? `<span style="color:var(--emerald)">${pct(r.raised_amount, r.target_raise)} closed</span>` : ''}${r.mandate_status === 'signed' ? '<span class="os-flag os-flag-info">Mandate</span>' : r.mandate_status === 'proposed' ? '<span class="os-flag os-flag-info">Mandate proposed</span>' : ''}</div>
        <div class="os-card-s" style="margin-top:4px">${ms.filter(m => ['shortlisted', 'approved'].includes(m.status)).length} targets · ${ms.filter(m => m.contacted_at).length} sent · ${mt} meetings</div>
        <div class="os-card-n${odue ? ' od' : ''}">${r.next_action ? esc(r.next_action) + (r.next_action_date ? ' · ' + fmtD(r.next_action_date) : '') : '<span class="os-flag">No next action</span>'}</div>
        <div class="os-card-s">${esc(pname(r.os_owner_id))}</div></div>`;
    };
    P.innerHTML = header('os-deals', `<label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" ${C.deals.off ? 'checked' : ''} onchange="capDealsOff(this.checked)"/>Show on hold &amp; lost</label>${w ? '<button class="btn btn-primary" onclick="capNewRaise()"><span class="material-symbols-outlined" style="font-size:15px">add</span>New raise</button>' : ''}`)
      + `<div class="cap-strip">${STAGES.map(([s, l], k) => { const n = C.raises.filter(r => (r.pipeline_stage || 'new') === s).length; return `${k ? '<i>→</i>' : ''}<button onclick="document.getElementById('cap-col-${s}').scrollIntoView({behavior:'smooth',inline:'start',block:'nearest'})" class="${n ? 'on' : ''}"><b>${n}</b>${l}</button>`; }).join('')}</div>
      <div class="os-board cap-board">${cols.map(([s, l]) => { const rs = C.raises.filter(r => (r.pipeline_stage || 'new') === s);
        return `<div class="os-col" id="cap-col-${s}" ${w ? `ondragover="event.preventDefault()" ondrop="capDrop(event,'${s}')"` : ''}><div class="os-col-h">${l} <span>${rs.length}</span><em>${rs.length ? 'USD ' + short(rs.reduce((a, r) => a + usd(r.target_raise, r.currency), 0)) : ''}</em></div>${rs.map(card).join('') || '<div class="os-col-empty">—</div>'}</div>`; }).join('')}</div>
      <div style="font-size:11px;color:var(--white-muted);margin-top:8px">Raises move forward automatically when investors are contacted, show interest, meet, enter DD or issue term sheets. Closing a raise is always a manual decision.</div>`;
  }
  async function drop(ev, stage) {
    ev.preventDefault(); const id = ev.dataTransfer.getData('text/plain'); if (!id) return;
    if (stage === 'lost') return openRaise(id, 'lost');
    try { await q(sb().from('deal_rooms').update({ pipeline_stage: stage }).eq('id', id)); notify('Moved to ' + stageLabel(stage)); refresh(); } catch (e) { notify(e.message, 'warn'); }
  }
  async function openRaise(id, forceStage) {
    await load(); const r = raise(id); if (!r.id) return;
    $('cr-id').value = id; $('cr-h').textContent = raiseName(r);
    $('cr-sub').textContent = [r.company_name, r.stage, money(r.target_raise, r.currency)].filter(Boolean).join(' · ');
    $('cr-stage').value = forceStage || r.pipeline_stage || 'new'; $('cr-mandate').value = r.mandate_status || 'none';
    $('cr-owner').innerHTML = ownerOpts(r.os_owner_id); $('cr-prob').value = r.probability != null ? r.probability : '';
    $('cr-na').value = r.next_action || ''; $('cr-nad').value = r.next_action_date || ''; $('cr-raised').value = r.raised_amount || ''; $('cr-cur').textContent = r.currency || 'USD';
    $('cr-lost').value = r.lost_reason || ''; lostToggle();
    const ms = C.matches.filter(m => m.raise_id === id);
    $('cr-funnel').innerHTML = [['Targets', ms.filter(m => ['shortlisted', 'approved'].includes(m.status)).length], ['Sent', ms.filter(m => m.contacted_at).length], ['Replied', ms.filter(m => m.replied_at).length], ['Meetings', ms.filter(m => m.meeting_at).length], ['DD', ms.filter(m => m.dd_at).length], ['Terms', ms.filter(m => m.term_sheet_at).length], ['Invested', ms.filter(m => m.status === 'invested').length]].map(([l, v]) => `<div><b>${v}</b>${l}</div>`).join('');
    $('cr-actions').innerHTML = [can('*') ? `<button class="btn btn-ghost btn-sm" onclick="closeModal('modal-cap-raise');mtEditRaise&&mtEditRaise('${id}')">Fundraising profile</button>` : '',
      `<button class="btn btn-ghost btn-sm" onclick="closeModal('modal-cap-raise');matchForRaise('${id}')">Investor matches</button>`,
      can('matches.write') ? `<button class="btn btn-ghost btn-sm" onclick="closeModal('modal-cap-raise');capNewCampaign('${id}')">New campaign</button>` : '',
      can('matches.write') ? `<button class="btn btn-ghost btn-sm" onclick="closeModal('modal-cap-raise');capNewMeeting({raise_id:'${id}'})">Schedule meeting</button>` : ''].join('');
    let hist = []; try { hist = await q(sb().from('os_activity').select('*').eq('entity_type', 'raise').eq('entity_id', id).order('created_at', { ascending: false })); } catch (e) { }
    $('cr-hist').innerHTML = hist.length ? hist.slice(0, 30).map(h => `<div class="os-h"><span class="material-symbols-outlined">history</span><div><div style="font-size:12px">${esc(h.body)}</div><div style="font-size:11px;color:var(--white-muted)">${new Date(h.created_at).toLocaleString('en-SG')}</div></div></div>`).join('') : '<div class="os-empty" style="padding:4px 0">No history yet.</div>';
    $('cr-save').style.display = can('raises.write') ? '' : 'none';
    $('modal-cap-raise').style.display = 'flex';
  }
  function lostToggle() { $('cr-lost-wrap').style.display = $('cr-stage').value === 'lost' ? '' : 'none'; }
  async function saveRaiseOps() {
    const id = $('cr-id').value, stage = $('cr-stage').value, num = v => v === '' ? null : (typeof parseMoney === 'function' ? parseMoney(v) : Number(v));
    const p = { pipeline_stage: stage, mandate_status: $('cr-mandate').value, os_owner_id: $('cr-owner').value || null, next_action: $('cr-na').value.trim() || null,
      next_action_date: $('cr-nad').value || null, raised_amount: num($('cr-raised').value.trim()), lost_reason: $('cr-lost').value.trim() || null };
    const prob = $('cr-prob').value; if (prob !== '' && Number(prob) !== raise(id).probability) p.probability = Math.max(0, Math.min(100, Number(prob)));
    if (stage === 'lost' && (!p.lost_reason || p.lost_reason.length < 3)) return notify('Record why this raise was lost', 'warn');
    if (!['closed', 'lost'].includes(stage) && !p.next_action) return notify('Every open raise needs a next action', 'warn');
    if (p.next_action && !p.next_action_date) return notify('Give the next action a date', 'warn');
    try { await q(sb().from('deal_rooms').update(p).eq('id', id)); notify('Raise updated'); closeModal('modal-cap-raise'); refresh(); } catch (e) { notify(e.message, 'warn'); }
  }
  function newRaise() {
    ['nr-name', 'nr-company', 'nr-sectors', 'nr-target', 'nr-min', 'nr-na'].forEach(i => { $(i).value = ''; });
    $('nr-stage').value = 'Seed'; $('nr-instr').value = 'Equity'; $('nr-cur').value = 'USD'; $('nr-owner').innerHTML = ownerOpts(OS().uid); $('nr-nad').value = iso(Date.now() + 2 * DAY);
    $('modal-cap-newraise').style.display = 'flex';
  }
  async function saveNewRaise() {
    const v = i => $(i).value.trim(), sectors = typeof normSectors === 'function' ? normSectors(v('nr-sectors')) : arr(v('nr-sectors'));
    const p = { name: v('nr-name') || null, company_name: v('nr-company') || null, sectors, industry: sectors.join(', ') || null, stage: $('nr-stage').value, instrument: $('nr-instr').value,
      investment_type: $('nr-instr').value, currency: $('nr-cur').value, target_raise: v('nr-target') ? parseMoney(v('nr-target')) : null, min_ticket: v('nr-min') ? parseMoney(v('nr-min')) : null,
      os_owner_id: $('nr-owner').value || null, next_action: v('nr-na') || 'Screen the company', next_action_date: $('nr-nad').value || iso(Date.now() + 2 * DAY), status: 'draft', pipeline_stage: 'new', created_by: OS().uid || null };
    if (!p.name && !p.company_name) return notify('Name the raise or the company', 'warn');
    if (!p.name) p.name = `${p.company_name} — ${p.stage}`;
    try { await q(sb().from('deal_rooms').insert(p)); notify('Raise created'); closeModal('modal-cap-newraise'); refresh(); } catch (e) { notify(e.message, 'warn'); }
  }

  // ── 3. INVESTOR CRM ───────────────────────────────────────────────────────
  async function renderCRM() {
    const P = $('panel-os-investors'); if (!guard('os-investors')) return;
    try { await load(true); } catch (e) { P.innerHTML = header('os-investors') + `<div class="card os-empty">${esc(e.message)}</div>`; return; }
    const f = C.crm, s = f.q.toLowerCase(), by = {};
    C.matches.forEach(m => { (by[m.investor_id] = by[m.investor_id] || []).push(m); });
    const meetBy = {}; C.meetings.forEach(x => { if (x.investor_id && x.status !== 'cancelled') (meetBy[x.investor_id] = meetBy[x.investor_id] || []).push(x); });
    let list = Object.values(C.investors).map(i => {
      const ms = by[i.id] || [], openMs = ms.filter(m => OPEN(raise(m.raise_id)));
      const best = openMs.slice().sort((a, b) => (b.score_total || 0) - (a.score_total || 0))[0];
      const inv$ = ms.filter(m => m.status === 'invested').reduce((a, m) => a + usd(m.committed_amount, m.committed_currency), 0);
      return { i, best, shown: ms.filter(m => m.contacted_at).length, replied: ms.filter(m => m.replied_at).length, pos: ms.filter(m => ['interested', 'meeting', 'due_diligence', 'term_sheet', 'invested'].includes(m.status)).length,
        dec: ms.filter(m => m.status === 'declined').length, meets: (meetBy[i.id] || []).length, invested: ms.filter(m => m.status === 'invested').length, inv$, live: ms.filter(m => ['due_diligence', 'term_sheet'].includes(m.status)) };
    });
    list = list.filter(x => (f.inactive || x.i.active !== false) && (!f.type || (f.type === '__review' ? x.i.type_needs_review : f.type === '__none' ? !x.i.investor_type : x.i.investor_type === f.type)) && (!f.shown || x.shown) &&
      (!s || [x.i.organization, x.i.full_name, x.i.email, arr(x.i.focus_sectors).join(' '), x.i.geography].join(' ').toLowerCase().includes(s)));
    const sorters = { score: (a, b) => ((b.best || {}).score_total || -1) - ((a.best || {}).score_total || -1), rel: (a, b) => (b.i.relationship_strength || 0) - (a.i.relationship_strength || 0),
      shown: (a, b) => b.shown - a.shown || b.replied - a.replied, last: (a, b) => String(b.i.last_interaction_at || '').localeCompare(String(a.i.last_interaction_at || '')), name: (a, b) => invName(a.i).localeCompare(invName(b.i)) };
    list.sort(sorters[f.sort] || sorters.score);
    const ORDER = ['VC', 'Angel', 'Family Office', 'Multi-Family Office', 'Private Equity', 'Hedge Fund', 'Fund of Funds', 'LP', 'Other'];
    const tcount = t => Object.values(C.investors).filter(i => i.investor_type === t).length;
    const types = ORDER.concat([...new Set(Object.values(C.investors).map(i => i.investor_type).filter(t => t && !ORDER.includes(t)))]);
    const total = list.length, rows = list.slice(0, f.limit);
    const dots = n => `<span class="cap-dots">${'●'.repeat(n || 0)}<i>${'●'.repeat(5 - (n || 0))}</i></span>`;
    const cheque = i => (i.check_min || i.check_max) ? `${money(i.check_min, i.check_currency)}–${short(i.check_max)}` : '';
    P.innerHTML = header('os-investors') + `
      <div class="filter-bar" style="flex-wrap:wrap"><input class="f-input" style="max-width:260px" placeholder="Search investor, sector, email…" value="${esc(f.q)}" oninput="capCrm('q',this.value)"/>
        <select class="f-input f-select" style="width:180px" onchange="capCrm('type',this.value)"><option value="">All categories</option>${types.map(t => `<option value="${esc(t)}" ${t === f.type ? 'selected' : ''}>${esc(t)} (${tcount(t)})</option>`).join('')}<option value="__review" ${f.type === '__review' ? 'selected' : ''}>Category to confirm (${Object.values(C.investors).filter(i => i.type_needs_review).length})</option><option value="__none" ${f.type === '__none' ? 'selected' : ''}>Uncategorised (${Object.values(C.investors).filter(i => !i.investor_type).length})</option></select>
        <select class="f-input f-select" style="width:200px" onchange="capCrm('sort',this.value)">${[['score', 'Sort: best match score'], ['rel', 'Sort: relationship'], ['shown', 'Sort: deals shown'], ['last', 'Sort: last interaction'], ['name', 'Sort: name']].map(([v, l]) => `<option value="${v}" ${v === f.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" ${f.shown ? 'checked' : ''} onchange="capCrm('shown',this.checked)"/>Shown a deal</label>
        <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" ${f.inactive ? 'checked' : ''} onchange="capCrm('inactive',this.checked)"/>Include inactive</label>
        <span style="margin-left:auto;font-size:12px;color:var(--white-muted)">${total} investors</span></div>
      <div class="card" style="overflow-x:auto"><table class="data-table os-table cap-crm"><thead><tr><th>Investor</th><th>Mandate</th><th>Score</th><th>Relationship</th><th>Deals shown</th><th>Responses</th><th>Meetings</th><th>Investments</th></tr></thead><tbody>
      ${rows.map(x => { const i = x.i, b = x.best;
        return `<tr onclick="mtOpenInvestor('${i.id}')" style="cursor:pointer">
          <td><b style="color:var(--ink)">${esc(invName(i))}</b><div class="cap-sub">${esc([i.full_name !== i.organization ? i.full_name : '', i.investor_type, i.investor_subtype].filter(Boolean).join(' · '))}${i.type_needs_review ? ' · <b style="color:#7a5c00">confirm category</b>' : ''}${i.active === false ? ' · <b style="color:#b3261e">inactive</b>' : ''}</div></td>
          <td class="cap-sub" style="max-width:230px">${esc(arr(i.focus_sectors).slice(0, 3).join(', ') || '—')}<div>${esc([arr(i.preferred_stages).slice(0, 2).join('/'), cheque(i)].filter(Boolean).join(' · '))}</div>${i.appetite ? `<div>${esc({ active: 'Actively deploying', selective: 'Selective', paused: 'Paused', not_deploying: 'Not deploying' }[i.appetite] || i.appetite)}</div>` : ''}</td>
          <td>${b ? `<b class="cap-score" style="--c:${b.score_total >= 90 ? '#0a5c40' : b.score_total >= 80 ? '#1a6b4a' : b.score_total >= 70 ? '#7a5c00' : '#8c1d18'}">${b.score_total}</b><div class="cap-sub">${esc(raiseName(raise(b.raise_id)))}</div>` : '<span class="cap-sub">—</span>'}</td>
          <td>${dots(i.relationship_strength)}<div class="cap-sub">${esc(i.relationship_owner ? pname(i.relationship_owner) : '')}${i.last_interaction_at ? ' · ' + fmtD(i.last_interaction_at) : ''}</div></td>
          <td><b>${x.shown}</b></td>
          <td class="cap-sub"><b style="color:var(--ink)">${x.replied}</b> replied${x.pos ? ` · <span style="color:var(--emerald)">${x.pos} positive</span>` : ''}${x.dec ? ` · ${x.dec} declined` : ''}${x.live.length ? `<div>${x.live.map(m => esc(MSTAT[m.status])).join(', ')}</div>` : ''}</td>
          <td><b>${x.meets}</b></td>
          <td>${x.invested ? `<b>${x.invested}</b><div class="cap-sub">USD ${short(x.inv$)}</div>` : '<span class="cap-sub">—</span>'}</td></tr>`; }).join('') || '<tr><td colspan="8"><div class="os-empty">No investors match.</div></td></tr>'}
      </tbody></table>${total > f.limit ? `<div class="os-more" onclick="capCrm('limit',${f.limit + 200})">Show ${Math.min(200, total - f.limit)} more</div>` : ''}</div>`;
  }

  // ── 4. CAMPAIGN ENGINE ────────────────────────────────────────────────────
  const chainCounts = c => {
    const ms = C.matches.filter(m => m.campaign_id === c.id), ts = C.outreach.filter(o => o.campaign_id === c.id && o.status === 'sent');
    return [['Deal', raiseName(raise(c.raise_id))], ['Investor cohort', ms.length], ['Email', ts.filter(o => o.channel === 'email' && o.step_no === 0).length + ts.filter(o => o.channel === 'email' && o.step_no > 0).length],
      ['LinkedIn', ts.filter(o => o.channel === 'linkedin').length], ['Introducer', ts.filter(o => o.channel === 'introducer').length], ['Follow-ups', ts.filter(o => o.step_no > 0).length], ['Replies', ms.filter(m => m.replied_at).length]];
  };
  async function renderCampaigns() {
    const P = $('panel-os-campaigns'); if (!guard('os-campaigns')) return;
    try { await load(true); } catch (e) { P.innerHTML = header('os-campaigns') + `<div class="card os-empty">${esc(e.message)}</div>`; return; }
    if (C.camp.open && C.campaigns.some(c => c.id === C.camp.open)) return renderCampaign(C.camp.open);
    const due = dueNow(), w = can('matches.write');
    P.innerHTML = header('os-campaigns', w ? '<button class="btn btn-primary" onclick="capNewCampaign()"><span class="material-symbols-outlined" style="font-size:15px">add</span>New campaign</button>' : '') + `
      <div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Today's queue <span class="os-count">${due.length}</span></div><div style="font-size:11px;color:var(--white-muted)">Draft → send it yourself → mark as sent. Nothing is sent automatically.</div></div>${queueTable(due)}</div>
      <div class="cap-camps">${C.campaigns.map(c => `<div class="card cap-camp" onclick="capOpenCampaign('${c.id}')"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><div style="font-weight:700;color:var(--ink)">${esc(c.name)}</div><div class="cap-sub">${esc(pname(c.owner_id))} · ${seqOf(c).length} steps</div></div><span class="cap-cst cap-cst-${c.status}">${esc(c.status)}</span></div>
        <div class="cap-cchain">${chainCounts(c).map(([l, v], k) => `${k ? '<i>→</i>' : ''}<div><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div></div>`).join('') || `<div class="card os-empty">No campaigns yet. A campaign takes an approved investor cohort for one raise through an email → LinkedIn → introducer → follow-up sequence. ${w ? 'Click <b>New campaign</b>.' : ''}</div>`}</div>`;
    P.querySelectorAll('.cap-camp .cap-cchain div:first-child b').forEach(b => { b.style.fontSize = '12px'; });
  }
  function queueTable(list, inCampaign) {
    if (!list.length) return '<div class="os-empty">Nothing due. Steps appear here on the day they are due.</div>';
    return `<div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Due</th><th>Investor</th>${inCampaign ? '' : '<th>Campaign</th>'}<th>Step</th><th>Status</th><th></th></tr></thead><tbody>${list.map(n => {
      const i = inv(n.m.investor_id), ok = n.m.approved_by || n.m.status !== 'shortlisted';
      return `<tr><td class="${n.overdue ? 'cap-od' : ''}">${n.overdue ? 'Overdue · ' : ''}${n.today ? 'Today' : fmtD(n.due)}</td><td><b style="color:var(--ink)">${esc(invName(i))}</b><div class="cap-sub">${esc(i.full_name || '')}</div></td>
        ${inCampaign ? '' : `<td class="cap-sub">${esc(n.c.name)}</td>`}<td><span class="material-symbols-outlined cap-ic">${CH[n.step.channel][0]}</span> ${esc(n.step.label || CH[n.step.channel][1])}<div class="cap-sub">Step ${n.i + 1} of ${seqOf(n.c).length}</div></td>
        <td><span class="mt-status mt-s-${n.m.status}">${esc(MSTAT[n.m.status])}</span></td>
        <td style="white-space:nowrap">${can('matches.write') ? `<button class="btn btn-primary btn-sm" onclick="capTouch('${n.m.id}','${n.c.id}',${n.i})" ${ok ? '' : 'disabled'}>Draft &amp; send…</button> <button class="btn btn-ghost btn-sm" onclick="capSkip('${n.m.id}','${n.c.id}',${n.i})">Skip</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  async function renderCampaign(id) {
    const P = $('panel-os-campaigns'), c = C.campaigns.find(x => x.id === id); if (!c) { C.camp.open = null; return renderCampaigns(); }
    C.camp.open = id;
    const seq = seqOf(c), ms = C.matches.filter(m => m.campaign_id === id).sort((a, b) => (b.score_total || 0) - (a.score_total || 0)), w = can('matches.write');
    const chip = (m, k) => {
      const t = touches(m.id, id).find(o => o.step_no === k);
      if (t && t.status === 'skipped') return '<span class="cap-step skip" title="Skipped">–</span>';
      if (t) return `<span class="cap-step sent${t.replied_at ? ' rep' : t.opened_at ? ' opn' : ''}" title="${esc(CH[t.channel][1])} sent ${fmtD(t.sent_at)}${t.opened_at ? ' · opened' : ''}${t.replied_at ? ' · replied' : ''}">${t.replied_at ? '↩' : '✓'}</span>`;
      const n = nextStep(m, c); if (n && n.i === k) return `<span class="cap-step due${n.overdue ? ' od' : ''}" title="Due ${fmtD(n.due)}">${n.today ? '•' : fmtD(n.due)}</span>`;
      return '<span class="cap-step"></span>';
    };
    const lastSent = m => touches(m.id).filter(o => o.sent_at).sort((a, b) => a.sent_at > b.sent_at ? -1 : 1)[0];
    P.innerHTML = header('os-campaigns', `<button class="btn btn-ghost" onclick="capCloseCampaign()">← All campaigns</button>${w ? `<button class="btn btn-ghost" onclick="capEditCampaign('${id}')">Sequence &amp; templates</button><button class="btn btn-primary" onclick="capAddCohort('${id}')">Add investors</button>` : ''}`) + `
      <div class="card" style="padding:14px 16px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><div><div style="font-weight:700;font-size:16px;color:var(--ink)">${esc(c.name)}</div><div class="cap-sub">${esc(raiseName(raise(c.raise_id)))} · ${esc(pname(c.owner_id))}</div></div>
        ${w ? `<select class="f-input f-select" style="width:150px" onchange="capCampaignStatus('${id}',this.value)">${['draft', 'active', 'paused', 'completed'].map(s => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>` : `<span class="cap-cst cap-cst-${c.status}">${c.status}</span>`}</div>
        <div class="cap-cchain">${chainCounts(c).slice(1).map(([l, v], k) => `${k ? '<i>→</i>' : ''}<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
        ${c.status !== 'active' ? '<div class="os-flag os-flag-info" style="margin-top:8px">Set the campaign to Active to queue its steps.</div>' : ''}</div>
      <div class="card" style="margin-bottom:12px"><div class="card-header"><div class="card-title">Due now</div></div>${queueTable(queue(id).filter(n => n.due <= today() || n.today), true)}</div>
      <div class="card" style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Investor</th><th>Score</th><th>Status</th>${seq.map((s, k) => `<th style="text-align:center" title="Day ${s.day}"><span class="material-symbols-outlined cap-ic">${CH[s.channel][0]}</span><div class="cap-sub">D${s.day}</div></th>`).join('')}<th>Reply</th><th></th></tr></thead><tbody>
      ${ms.map(m => { const i = inv(m.investor_id), ls = lastSent(m);
        return `<tr><td><b style="color:var(--ink);cursor:pointer" onclick="mtOpenInvestor('${i.id}')">${esc(invName(i))}</b><div class="cap-sub">${esc(i.email || i.linkedin_url || '')}</div></td><td><b>${m.score_total != null ? m.score_total : '—'}</b></td>
          <td><span class="mt-status mt-s-${m.status}">${esc(MSTAT[m.status])}</span>${!m.approved_by && ['suggested', 'shortlisted'].includes(m.status) ? '<div class="os-flag">Needs approval</div>' : ''}</td>
          ${seq.map((_, k) => `<td style="text-align:center">${chip(m, k)}</td>`).join('')}
          <td class="cap-sub">${m.replied_at ? `<b style="color:var(--emerald)">Replied ${fmtD(m.replied_at)}</b>` : m.opened_at ? 'Opened' : ls ? 'Awaiting' : ''}</td>
          <td style="white-space:nowrap">${!m.approved_by && ['suggested', 'shortlisted'].includes(m.status) && can('outreach.approve') ? `<button class="btn btn-primary btn-sm" onclick="capApprove('${m.id}')">Approve…</button> ` : ''}
            ${w && ls && !m.replied_at && ls.channel === 'email' && !ls.opened_at ? `<button class="btn btn-ghost btn-sm" onclick="capOpened('${ls.id}')">Opened</button> ` : ''}
            ${w && ls && !m.replied_at ? `<button class="btn btn-ghost btn-sm" onclick="capReply('${ls.id}')">Reply…</button> ` : ''}
            ${w && m.replied_at && ['contacted', 'no_response'].includes(m.status) ? `<button class="btn btn-primary btn-sm" onclick="capOutcome('${m.id}')">Record outcome…</button> ` : ''}
            ${w && !m.contacted_at ? `<button class="btn btn-ghost btn-sm" title="Remove from cohort" onclick="capRemoveCohort('${m.id}')">✕</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="${seq.length + 5}"><div class="os-empty">No investors in this cohort yet. ${w ? 'Click <b>Add investors</b> to pick from this raise’s matches.' : ''}</div></td></tr>`}
      </tbody></table></div>`;
  }
  function newCampaign(raiseId) {
    $('cc-id').value = ''; $('cc-h').textContent = 'New campaign';
    $('cc-raise').innerHTML = C.raises.filter(OPEN).map(r => `<option value="${r.id}" ${r.id === raiseId ? 'selected' : ''}>${esc(raiseName(r))}</option>`).join('');
    $('cc-raise').disabled = false;
    const r = raise(raiseId || $('cc-raise').value);
    $('cc-name').value = r.id ? `${r.company_name || raiseName(r)} — wave 1` : '';
    $('cc-intro').value = ''; fillTemplates(DEFAULT_SEQ, {});
    $('modal-cap-campaign').style.display = 'flex';
  }
  function editCampaign(id) {
    const c = C.campaigns.find(x => x.id === id); if (!c) return;
    $('cc-id').value = id; $('cc-h').textContent = 'Sequence & templates';
    $('cc-raise').innerHTML = `<option value="${c.raise_id}">${esc(raiseName(raise(c.raise_id)))}</option>`; $('cc-raise').disabled = true;
    $('cc-name').value = c.name; $('cc-intro').value = c.introducer || ''; fillTemplates(seqOf(c), c);
    $('modal-cap-campaign').style.display = 'flex';
  }
  const T_EMAIL = 'Dear {first_name},\n\nGiven {investor_org}\'s focus on {sector}, I wanted to ask whether you would be open to an introduction to {company}, which is raising a {stage} round of {target}.\n\n[Two-line company summary agreed with the company]\n\nIf it is relevant, I can share a short brief; full materials follow only with the company\'s consent.\n\nBANAHUB provides advisory services only and does not make investment recommendations.\n\nBest regards,';
  const T_LI = 'Hi {first_name} — I work with {company} on its {stage} round ({sector}). Given {investor_org}\'s focus, would you be open to a short intro? Happy to share a brief.';
  const T_FU = 'Dear {first_name},\n\nFollowing up on my note about {company}\'s {stage} round. Would a short brief be useful, or is it outside your current mandate? Either answer helps.\n\nBest regards,';
  const T_INTRO = 'Hi {introducer} — would you be comfortable introducing me to {first_name} at {investor_org}? I am working with {company} on its {stage} round of {target} and it fits their {sector} focus. Happy to send a forwardable blurb.';
  function fillTemplates(seq, c) {
    $('cc-seq').innerHTML = seq.map((s, k) => seqRow(s, k)).join('');
    $('cc-subj').value = c.email_subject || 'Introduction: {company} ({stage}, {sector})'; $('cc-email').value = c.email_body || T_EMAIL; $('cc-li').value = c.linkedin_body || T_LI;
  }
  const seqRow = (s, k) => `<div class="cap-seqrow"><span class="cap-sub">${k + 1}</span><input type="number" min="0" class="f-input" value="${s.day}" title="Day"/><select class="f-input f-select">${['email', 'linkedin', 'introducer', 'call'].map(ch => `<option value="${ch}" ${ch === s.channel ? 'selected' : ''}>${CH[ch][1]}</option>`).join('')}</select><input class="f-input" value="${esc(s.label || '')}" placeholder="Label"/><button class="btn btn-ghost btn-sm" onclick="this.parentNode.remove()">✕</button></div>`;
  function addSeqRow() { const n = $('cc-seq').children.length, last = $('cc-seq').lastElementChild; const day = last ? +last.querySelector('input').value + 7 : 0; $('cc-seq').insertAdjacentHTML('beforeend', seqRow({ day, channel: 'email', label: 'Follow-up ' + n }, n)); }
  async function saveCampaign() {
    const id = $('cc-id').value, seq = [...$('cc-seq').children].map(r => { const [d, l] = r.querySelectorAll('input'); return { day: Math.max(0, +d.value || 0), channel: r.querySelector('select').value, label: l.value.trim() }; }).sort((a, b) => a.day - b.day);
    if (!seq.length) return notify('Add at least one step', 'warn');
    if (seq.some(s => s.channel === 'introducer') && !$('cc-intro').value.trim()) return notify('Name the default introducer for the introducer step (you can change it per investor)', 'warn');
    const p = { name: $('cc-name').value.trim(), sequence: seq, email_subject: $('cc-subj').value.trim(), email_body: $('cc-email').value, linkedin_body: $('cc-li').value, introducer: $('cc-intro').value.trim() || null };
    if (!p.name) return notify('Name the campaign', 'warn');
    try {
      if (id) await q(sb().from('os_campaigns').update(p).eq('id', id));
      else { p.raise_id = $('cc-raise').value; p.status = 'draft'; p.owner_id = OS().uid || null; const row = await q(sb().from('os_campaigns').insert(p).select().single()); C.camp.open = row && row.id; }
      notify('Campaign saved'); closeModal('modal-cap-campaign'); await load(true); renderCampaigns();
      if (!id && C.camp.open) addCohort(C.camp.open);
    } catch (e) { notify(e.message, 'warn'); }
  }
  async function campaignStatus(id, s) {
    if (s === 'active' && !C.matches.some(m => m.campaign_id === id)) { notify('Add investors before activating', 'warn'); return renderCampaign(id); }
    try { await q(sb().from('os_campaigns').update({ status: s }).eq('id', id)); notify('Campaign ' + s); await load(true); renderCampaign(id); badges(); } catch (e) { notify(e.message, 'warn'); }
  }
  function addCohort(id) {
    const c = C.campaigns.find(x => x.id === id); if (!c) return;
    const sentCo = new Set(C.matches.filter(m => m.contacted_at && m.raise_id !== c.raise_id).map(m => m.company_key + '|' + m.investor_id));
    const pool = C.matches.filter(m => m.raise_id === c.raise_id && !m.campaign_id && ['suggested', 'shortlisted', 'approved'].includes(m.status) && !m.contacted_at && inv(m.investor_id).active !== false)
      .sort((a, b) => (b.score_total || 0) - (a.score_total || 0));
    $('ca-id').value = id;
    $('ca-list').innerHTML = pool.length ? pool.map(m => { const i = inv(m.investor_id), rep = sentCo.has(m.company_key + '|' + m.investor_id);
      return `<label class="cap-pick"><input type="checkbox" value="${m.id}" ${m.score_total >= 70 && !rep ? 'checked' : ''}/><b class="cap-score" style="--c:${m.score_total >= 80 ? '#0a5c40' : m.score_total >= 70 ? '#7a5c00' : '#8c1d18'}">${m.score_total != null ? m.score_total : '—'}</b><span><b style="color:var(--ink)">${esc(invName(i))}</b> <span class="cap-sub">${esc(MSTAT[m.status])}${rep ? ' · already sent this company before' : ''}</span></span></label>`; }).join('')
      : '<div class="os-empty">No eligible investors. Run matching for this raise first (Investor Matching), or every match is already in a campaign.</div>';
    $('modal-cap-cohort').style.display = 'flex';
  }
  async function saveCohort() {
    const id = $('ca-id').value, ids = [...document.querySelectorAll('#ca-list input:checked')].map(x => x.value);
    if (!ids.length) return notify('Pick at least one investor', 'warn');
    try {
      for (const mid of ids) { const m = match(mid); await q(sb().from('os_investor_matches').update(Object.assign({ campaign_id: id }, m.status === 'suggested' ? { status: 'shortlisted' } : {})).eq('id', mid)); }
      notify(`${ids.length} added — each still needs outreach approval before anything is sent`); closeModal('modal-cap-cohort'); await load(true); renderCampaign(id);
    } catch (e) { notify(e.message, 'warn'); }
  }
  async function removeCohort(mid) {
    try { await q(sb().from('os_investor_matches').update({ campaign_id: null }).eq('id', mid)); await load(true); renderCampaign(C.camp.open); } catch (e) { notify(e.message, 'warn'); }
  }
  const merge = (t, m, c, intro) => {
    const i = inv(m.investor_id), r = raise(m.raise_id);
    const v = { first_name: (i.full_name || '').split(' ')[0] || 'there', investor_org: invName(i), company: r.company_name || raiseName(r), stage: r.stage || '', target: money(r.target_raise, r.currency),
      sector: arr(r.sectors).slice(0, 2).join(' / ') || 'this sector', introducer: intro || (c && c.introducer) || '', sender: (person(OS().uid) || {}).full_name || '' };
    return String(t || '').replace(/\{(\w+)\}/g, (a, k) => v[k] != null ? v[k] : a);
  };
  function openTouch(mid, cid, k) {
    const m = match(mid), c = C.campaigns.find(x => x.id === cid) || {}, step = seqOf(c)[k], i = inv(m.investor_id);
    if (!m.approved_by && ['suggested', 'shortlisted'].includes(m.status)) return notify('Approve outreach for this investor first', 'warn');
    $('ct-mid').value = mid; $('ct-cid').value = cid; $('ct-k').value = k; $('ct-ch').value = step.channel;
    $('ct-h').textContent = `${step.label || CH[step.channel][1]} — ${invName(i)}`;
    const isEmail = step.channel === 'email', fu = k > 0 && isEmail;
    $('ct-to').textContent = step.channel === 'linkedin' ? (i.linkedin_url || 'no LinkedIn URL on file') : step.channel === 'introducer' ? 'via introducer' : (i.email || 'no email on file');
    $('ct-intro-wrap').style.display = step.channel === 'introducer' ? '' : 'none'; $('ct-intro').value = c.introducer || m.introducer || '';
    $('ct-subj-wrap').style.display = isEmail ? '' : 'none';
    $('ct-subj').value = merge((fu ? 'Re: ' : '') + (c.email_subject || 'Introduction: {company}'), m, c);
    $('ct-body').value = merge(step.channel === 'linkedin' ? (c.linkedin_body || T_LI) : step.channel === 'introducer' ? T_INTRO : fu ? T_FU : (c.email_body || T_EMAIL), m, c);
    const open = $('ct-open');
    if (isEmail && i.email) { open.style.display = ''; open.textContent = 'Open in my email'; open.href = `mailto:${encodeURI(i.email)}?subject=${encodeURIComponent($('ct-subj').value)}&body=${encodeURIComponent($('ct-body').value)}`; }
    else if (step.channel === 'linkedin' && i.linkedin_url) { open.style.display = ''; open.textContent = 'Open LinkedIn profile'; open.href = i.linkedin_url; }
    else open.style.display = 'none';
    $('ct-li-warn').style.display = step.channel === 'linkedin' && $('ct-body').value.length > 300 ? '' : 'none';
    $('modal-cap-touch').style.display = 'flex';
  }
  async function saveTouch(status) {
    const mid = $('ct-mid').value, cid = $('ct-cid').value || null, k = +$('ct-k').value, ch = $('ct-ch').value;
    const p = { match_id: mid, campaign_id: cid, step_no: k, channel: ch, status, subject: ch === 'email' ? $('ct-subj').value : null, body: $('ct-body').value, introducer: ch === 'introducer' ? $('ct-intro').value.trim() || null : null };
    if (status === 'sent' && ch === 'introducer' && !p.introducer) return notify('Name the introducer', 'warn');
    try { await q(sb().from('os_outreach').insert(p)); notify(status === 'sent' ? 'Recorded as sent' : 'Step skipped'); closeModal('modal-cap-touch'); await afterChange(); } catch (e) { notify(e.message, 'warn'); }
  }
  async function skip(mid, cid, k) {
    const c = C.campaigns.find(x => x.id === cid) || {};
    try { await q(sb().from('os_outreach').insert({ match_id: mid, campaign_id: cid, step_no: k, channel: seqOf(c)[k].channel, status: 'skipped' })); notify('Step skipped'); await afterChange(); } catch (e) { notify(e.message, 'warn'); }
  }
  async function opened(oid) { try { await q(sb().from('os_outreach').update({ opened_at: new Date().toISOString() }).eq('id', oid)); const o = C.outreach.find(x => x.id === oid); if (o) { const m = match(o.match_id); m.opened_at = m.opened_at || new Date().toISOString(); } notify('Marked opened'); await afterChange(); } catch (e) { notify(e.message, 'warn'); } }
  function replyOpen(oid) { $('cy-id').value = oid; $('cy-note').value = ''; $('modal-cap-reply').style.display = 'flex'; }
  async function saveReply() {
    const oid = $('cy-id').value, o = C.outreach.find(x => x.id === oid) || {}, now = new Date().toISOString();
    try {
      await q(sb().from('os_outreach').update({ replied_at: now, reply_note: $('cy-note').value.trim() || null }).eq('id', oid));
      const m = match(o.match_id); m.replied_at = m.replied_at || now; m.opened_at = m.opened_at || now;
      closeModal('modal-cap-reply'); notify('Reply recorded — now record the outcome');
      if (window.mtResponse) window.mtResponse(o.match_id);
      await afterChange();
    } catch (e) { notify(e.message, 'warn'); }
  }
  function approve(mid) { if (window.__MT) { const m = match(mid); if (!window.__MT.matches.some(x => x.id === mid)) window.__MT.matches.push(m); Object.assign(window.__MT.investors, C.investors); window.__MT.raises = C.raises; } window.mtApprove && window.mtApprove(mid); }
  function outcome(mid) { if (window.__MT && !window.__MT.matches.some(x => x.id === mid)) window.__MT.matches.push(match(mid)); window.mtResponse && window.mtResponse(mid); }

  // ── 5. MEETING CENTRE ─────────────────────────────────────────────────────
  async function renderMeetings() {
    const P = $('panel-os-meetings'); if (!guard('os-meetings')) return;
    try { await load(true); } catch (e) { P.innerHTML = header('os-meetings') + `<div class="card os-empty">${esc(e.message)}</div>`; return; }
    const now = Date.now(), t = C.meet.tab;
    const needs = x => x.status === 'scheduled' && new Date(x.meeting_at) < now - 2 * 36e5;
    const tabs = { upcoming: x => x.status === 'scheduled' && !needs(x), update: needs, past: x => ['held', 'no_show', 'cancelled'].includes(x.status), all: () => true };
    let list = C.meetings.filter(tabs[t]); if (t !== 'upcoming') list = list.slice().sort((a, b) => a.meeting_at > b.meeting_at ? -1 : 1);
    const cnt = k => C.meetings.filter(tabs[k]).length;
    let lastDay = '';
    P.innerHTML = header('os-meetings', can('matches.write') ? '<button class="btn btn-primary" onclick="capNewMeeting({})"><span class="material-symbols-outlined" style="font-size:15px">add</span>New meeting</button>' : '') + `
      <div class="tabs" style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">${[['upcoming', 'Upcoming'], ['update', 'Needs notes'], ['past', 'Past'], ['all', 'All']].map(([k, l]) => `<button class="btn ${k === t ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="capMeetTab('${k}')">${l} <span class="os-count">${cnt(k)}</span></button>`).join('')}</div>
      <div class="card" style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Investor</th><th>Company</th><th>Date</th><th>Meeting brief</th><th>Notes</th><th>Next action</th><th></th></tr></thead><tbody>
      ${list.map(x => { const i = inv(x.investor_id), r = raise(x.raise_id), day = new Date(x.meeting_at).toDateString(), sep = t === 'upcoming' && day !== lastDay; lastDay = day;
        const od = x.next_action_date && new Date(x.next_action_date) < today();
        return `${sep ? `<tr class="cap-day"><td colspan="7">${new Date(x.meeting_at).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}</td></tr>` : ''}<tr onclick="capOpenMeeting('${x.id}')" style="cursor:pointer">
          <td><b style="color:var(--ink)">${esc(invName(i))}</b><div class="cap-sub">${esc(i.full_name !== i.organization ? i.full_name || '' : '')}</div></td>
          <td>${esc(r.id ? (r.company_name || raiseName(r)) : '—')}<div class="cap-sub">${esc({ intro: 'Intro', pitch: 'Pitch', follow_up: 'Follow-up', dd: 'DD session', negotiation: 'Negotiation', other: 'Other' }[x.meeting_type] || '')}</div></td>
          <td style="white-space:nowrap">${fmtDT(x.meeting_at)}<div class="cap-sub">${esc(x.status === 'scheduled' ? (needs(x) ? 'Awaiting outcome' : x.location || '') : { held: 'Held', no_show: 'No-show', cancelled: 'Cancelled' }[x.status])}</div></td>
          <td>${x.brief ? '<span class="cap-ok">Ready</span>' : '<span class="os-flag">Missing</span>'}</td>
          <td class="cap-sub" style="max-width:220px">${x.notes ? esc(x.notes.slice(0, 90)) + (x.notes.length > 90 ? '…' : '') : x.status === 'held' || needs(x) ? '<span class="os-flag">No notes</span>' : '—'}</td>
          <td style="font-size:12px">${x.next_action ? `<span class="${od ? 'cap-od' : ''}">${esc(x.next_action)}${x.next_action_date ? ' · ' + fmtD(x.next_action_date) : ''}</span>` : '—'}</td>
          <td style="white-space:nowrap">${x.outcome ? `<span class="cap-out cap-out-${x.outcome}">${x.outcome}</span>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="7"><div class="os-empty">No meetings here.</div></td></tr>'}
      </tbody></table></div>`;
  }
  function invOptions(sel, raiseId) {
    const onRaise = new Set(C.matches.filter(m => m.raise_id === raiseId && m.contacted_at).map(m => m.investor_id));
    const all = Object.values(C.investors).sort((a, b) => (onRaise.has(b.id) - onRaise.has(a.id)) || invName(a).localeCompare(invName(b)));
    return '<option value="">Choose investor…</option>' + all.map(i => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(invName(i))}${onRaise.has(i.id) ? ' ★' : ''}</option>`).join('');
  }
  async function newMeeting(pre) {
    await load(); pre = pre || {};
    const m = pre.match_id ? match(pre.match_id) : {};
    fillMeeting({ id: '', investor_id: pre.investor_id || m.investor_id || '', raise_id: pre.raise_id || m.raise_id || '', meeting_at: null, duration_min: 45, meeting_type: 'intro', status: 'scheduled' });
  }
  async function openMeeting(id) { await load(); const x = C.meetings.find(y => y.id === id); if (x) fillMeeting(x); }
  function fillMeeting(x) {
    $('cm-id').value = x.id || ''; $('cm-h').textContent = x.id ? 'Meeting' : 'New meeting';
    $('cm-raise').innerHTML = '<option value="">— no raise —</option>' + C.raises.map(r => `<option value="${r.id}" ${r.id === x.raise_id ? 'selected' : ''}>${esc(raiseName(r))}</option>`).join('');
    $('cm-inv').innerHTML = invOptions(x.investor_id, x.raise_id);
    const d = x.meeting_at ? new Date(x.meeting_at) : new Date(Date.now() + DAY);
    if (!x.meeting_at) d.setHours(10, 0, 0, 0);
    $('cm-at').value = `${iso(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('cm-dur').value = x.duration_min || 45; $('cm-type').value = x.meeting_type || 'intro'; $('cm-loc').value = x.location || ''; $('cm-att').value = x.attendees || '';
    $('cm-status').value = x.status || 'scheduled'; $('cm-brief').value = x.brief || ''; $('cm-notes').value = x.notes || ''; $('cm-outcome').value = x.outcome || '';
    $('cm-na').value = x.next_action || ''; $('cm-nad').value = x.next_action_date || '';
    $('cm-del').style.display = x.id && can('*') ? '' : 'none'; $('cm-save').style.display = can('matches.write') ? '' : 'none';
    meetStatusToggle();
    $('modal-cap-meeting').style.display = 'flex';
  }
  function meetStatusToggle() { const held = $('cm-status').value === 'held'; $('cm-na-l').textContent = held ? 'Next action (required)' : 'Next action'; }
  function genBrief() {
    const i = inv($('cm-inv').value), r = raise($('cm-raise').value); if (!i.id) return notify('Choose the investor first', 'warn');
    const m = C.matches.find(x => x.investor_id === i.id && x.raise_id === r.id) || {}, bd = m.breakdown || {};
    const hist = C.matches.filter(x => x.investor_id === i.id && x.contacted_at && x.id !== m.id);
    const ts = m.id ? touches(m.id).filter(o => o.sent_at) : [];
    const prev = C.meetings.filter(x => x.investor_id === i.id && x.status === 'held' && x.id !== $('cm-id').value);
    const L = [];
    L.push(`MEETING BRIEF — ${invName(i)}${r.id ? ' × ' + (r.company_name || raiseName(r)) : ''}`, `${$('cm-at').value.replace('T', ' ')} · ${$('cm-type').selectedOptions[0].text}${$('cm-loc').value ? ' · ' + $('cm-loc').value : ''}`, '');
    L.push('INVESTOR', `• ${[i.full_name, i.title].filter(Boolean).join(', ') || '—'} — ${i.investor_type || 'type unknown'}${i.geography ? ', based in ' + i.geography : ''}`,
      `• Focus: ${arr(i.focus_sectors).join(', ') || 'not recorded'}${arr(i.sub_sectors).length ? ' (' + arr(i.sub_sectors).join(', ') + ')' : ''}`,
      `• Stages: ${arr(i.preferred_stages).join(', ') || '—'} · Cheque: ${i.check_min || i.check_max ? money(i.check_min, i.check_currency) + ' – ' + short(i.check_max) : 'not recorded'} · Instruments: ${arr(i.instruments).join(', ') || '—'}`,
      `• Leads/follows: ${i.lead_follow || 'unknown'} · Appetite: ${i.appetite || 'unknown'}${i.current_mandate ? '\n• Current mandate: ' + i.current_mandate : ''}`,
      `• Portfolio: ${arr(i.portfolio).slice(0, 8).join(', ') || 'not recorded'}`,
      `• Relationship: ${i.relationship_strength || 0}/5${i.relationship_owner ? ' (owner ' + pname(i.relationship_owner) + ')' : ''}${i.last_interaction_at ? ' · last contact ' + fmtD(i.last_interaction_at) : ''}`, '');
    if (r.id) L.push('COMPANY & RAISE', `• ${r.company_name || raiseName(r)} — ${r.stage || ''} ${r.instrument || r.investment_type || ''}, target ${money(r.target_raise, r.currency)}${r.min_ticket ? ', min ticket ' + money(r.min_ticket, r.currency) : ''}`,
      `• Sectors: ${arr(r.sectors).join(', ') || '—'} · HQ ${r.hq_country || r.geography || '—'}`, `• Traction: ${r.annual_revenue != null ? 'revenue ' + money(r.annual_revenue, r.currency) : 'revenue not recorded'}${r.revenue_growth_pct != null ? ', growth ' + r.revenue_growth_pct + '%' : ''}${r.traction_stage ? ', ' + r.traction_stage.replace(/_/g, ' ') : ''}`,
      r.use_of_funds ? `• Use of funds: ${r.use_of_funds}` : '', '');
    if (m.id) L.push(`FIT — match score ${m.score_total}/100 (${m.band || ''})`, ...arr(bd.reasons).map(x => '• ' + x), ...arr(m.flags).map(x => '⚠ ' + x),
      `• Status: ${MSTAT[m.status]}${m.contacted_at ? ', sent ' + fmtD(m.contacted_at) + (m.channel ? ' via ' + m.channel : '') : ''}${m.introducer ? ', introduced by ' + m.introducer : ''}`,
      ...ts.map(o => `  – ${fmtD(o.sent_at)} ${CH[o.channel][1]}${o.replied_at ? ' → replied' + (o.reply_note ? ': ' + o.reply_note : '') : ''}`), '');
    if (hist.length || prev.length) L.push('HISTORY WITH BANAHUB', ...hist.map(x => `• ${raiseName(raise(x.raise_id))}: ${MSTAT[x.status]}${x.decline_reason ? ' (' + x.decline_reason.replace(/_/g, ' ') + ')' : ''}`), ...prev.map(x => `• Met ${fmtD(x.meeting_at)}: ${x.notes ? x.notes.slice(0, 120) : 'no notes'}`), '');
    L.push('OBJECTIVES', '• Confirm mandate fit (stage, cheque, geography, instrument) and current deployment appetite', '• Understand their process, timeline and decision makers', '• Agree a concrete next step', '',
      'QUESTIONS TO ASK', '• What would you need to see to take this to IC?', '• Do you lead, or who do you typically co-invest with?', '• Any portfolio conflicts we should know about?', '',
      'REMINDER: share only materials the company has approved. BANAHUB provides advisory services and does not make investment recommendations.');
    $('cm-brief').value = L.filter((x, k, a) => !(x === '' && a[k - 1] === '')).join('\n');
  }
  async function saveMeeting() {
    const id = $('cm-id').value, at = $('cm-at').value;
    const p = { investor_id: $('cm-inv').value || null, raise_id: $('cm-raise').value || null, meeting_at: at ? new Date(at).toISOString() : null, duration_min: +$('cm-dur').value || 45,
      meeting_type: $('cm-type').value, location: $('cm-loc').value.trim() || null, attendees: $('cm-att').value.trim() || null, status: $('cm-status').value, brief: $('cm-brief').value.trim() || null,
      notes: $('cm-notes').value.trim() || null, outcome: $('cm-outcome').value || null, next_action: $('cm-na').value.trim() || null, next_action_date: $('cm-nad').value || null };
    if (!p.investor_id) return notify('Choose the investor', 'warn');
    if (!p.meeting_at) return notify('Set the date and time', 'warn');
    if (p.status === 'held' && (!p.next_action || !p.next_action_date)) return notify('A held meeting needs a next action and a date', 'warn');
    if (p.raise_id) { const m = C.matches.find(x => x.investor_id === p.investor_id && x.raise_id === p.raise_id); if (m) p.match_id = m.id; }
    if (!id) { p.owner_id = OS().uid || null; }
    try {
      if (id) await q(sb().from('os_meetings').update(p).eq('id', id)); else await q(sb().from('os_meetings').insert(p));
      notify('Meeting saved'); closeModal('modal-cap-meeting'); await afterChange();
    } catch (e) { notify(e.message, 'warn'); }
  }
  async function delMeeting() { const id = $('cm-id').value; if (!id || !confirm('Delete this meeting?')) return; try { await q(sb().from('os_meetings').delete().eq('id', id)); closeModal('modal-cap-meeting'); await afterChange(); } catch (e) { notify(e.message, 'warn'); } }
  function ics() {
    const i = inv($('cm-inv').value), r = raise($('cm-raise').value), at = new Date($('cm-at').value); if (isNaN(at)) return notify('Set the date first', 'warn');
    const end = new Date(at.getTime() + (+$('cm-dur').value || 45) * 6e4), f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const e = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BANAHUB//Admin OS//EN', 'BEGIN:VEVENT', `UID:${$('cm-id').value || Date.now()}@banahub.com`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(at)}`, `DTEND:${f(end)}`,
      `SUMMARY:${e(invName(i) + (r.id ? ' × ' + (r.company_name || raiseName(r)) : ''))}`, `LOCATION:${e($('cm-loc').value)}`, `DESCRIPTION:${e($('cm-brief').value.slice(0, 1500))}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = 'banahub-meeting.ics'; document.body.appendChild(a); a.click(); a.remove();
  }

  // ── 6. ANALYTICS ──────────────────────────────────────────────────────────
  const FUNNEL = [['contacted_at', 'Contacted'], ['opened_at', 'Opened'], ['replied_at', 'Replied'], ['interested_at', 'Interested'], ['meeting_at', 'Meetings'], ['dd_at', 'DD'], ['term_sheet_at', 'Terms'], ['invested_at', 'Closed']];
  async function renderAnalytics() {
    const P = $('panel-os-cap-analytics'); if (!guard('os-cap-analytics')) return;
    try { await load(true); } catch (e) { P.innerHTML = header('os-cap-analytics') + `<div class="card os-empty">${esc(e.message)}</div>`; return; }
    const f = C.an, since = f.days ? Date.now() - (+f.days) * DAY : 0;
    const rows = C.matches.filter(m => m.contacted_at && (!f.raise || m.raise_id === f.raise) && (!f.campaign || m.campaign_id === f.campaign) && (!f.channel || m.channel === f.channel) && new Date(m.contacted_at).getTime() >= since);
    const n = k => rows.filter(m => m[k]).length, base = rows.length;
    const capital = rows.filter(m => m.status === 'invested').reduce((a, m) => a + usd(m.committed_amount, m.committed_currency), 0);
    const med = (a, b) => { const d = rows.filter(m => m[a] && m[b]).map(m => (new Date(m[b]) - new Date(m[a])) / DAY).sort((x, y) => x - y); return d.length ? (d[Math.floor(d.length / 2)]).toFixed(1) + ' days' : '—'; };
    const funnel = FUNNEL.map(([k, l], j) => { const v = n(k), prev = j ? n(FUNNEL[j - 1][0]) : v;
      return `<div class="cap-fun" title="${l}: ${v} of ${base} contacted (${pct(v, base)})${j ? ' · ' + pct(v, prev) + ' of ' + FUNNEL[j - 1][1].toLowerCase() : ''}"><div class="cap-fun-l">${l}${k === 'opened_at' ? '<span title="Only where the open was recorded"> *</span>' : ''}</div><div class="cap-fun-bar"><i style="width:${base ? Math.max(v ? 2 : 0, 100 * v / base) : 0}%"></i></div><div class="cap-fun-v"><b>${v}</b> <span>${pct(v, base)}</span></div><div class="cap-fun-c">${j ? '↳ ' + pct(v, prev) : ''}</div></div>`; }).join('');
    const group = (keyFn, label) => {
      const g = {}; rows.forEach(m => { const k = keyFn(m) || '—'; (g[k] = g[k] || []).push(m); });
      const list = Object.entries(g).sort((a, b) => b[1].length - a[1].length);
      return `<div class="card"><div class="card-header"><div class="card-title">By ${label}</div></div><div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>${label[0].toUpperCase() + label.slice(1)}</th><th>Contacted</th><th>Replied</th><th>Meetings</th><th>DD</th><th>Closed</th><th>Capital</th></tr></thead><tbody>${list.map(([k, ms]) => { const c = x => ms.filter(m => m[x]).length;
        return `<tr><td>${esc(k)}</td><td>${ms.length}</td><td>${c('replied_at')} <span class="cap-sub">${pct(c('replied_at'), ms.length)}</span></td><td>${c('meeting_at')} <span class="cap-sub">${pct(c('meeting_at'), ms.length)}</span></td><td>${c('dd_at')}</td><td>${c('invested_at')}</td><td>USD ${short(ms.filter(m => m.status === 'invested').reduce((a, m) => a + usd(m.committed_amount, m.committed_currency), 0))}</td></tr>`; }).join('') || '<tr><td colspan="7"><div class="os-empty">No data</div></td></tr>'}</tbody></table></div></div>`;
    };
    const declines = {}; rows.filter(m => m.status === 'declined').forEach(m => { declines[m.decline_reason || 'other'] = (declines[m.decline_reason || 'other'] || 0) + 1; });
    const dmax = Math.max(1, ...Object.values(declines));
    P.innerHTML = header('os-cap-analytics') + `
      <div class="filter-bar" style="flex-wrap:wrap">
        <select class="f-input f-select" style="width:240px" onchange="capAn('raise',this.value)"><option value="">All raises</option>${C.raises.map(r => `<option value="${r.id}" ${r.id === f.raise ? 'selected' : ''}>${esc(raiseName(r))}</option>`).join('')}</select>
        <select class="f-input f-select" style="width:220px" onchange="capAn('campaign',this.value)"><option value="">All campaigns</option>${C.campaigns.map(c => `<option value="${c.id}" ${c.id === f.campaign ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select class="f-input f-select" style="width:170px" onchange="capAn('channel',this.value)"><option value="">All first channels</option>${Object.entries(CH).map(([k, [, l]]) => `<option value="${k}" ${k === f.channel ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="f-input f-select" style="width:160px" onchange="capAn('days',this.value)">${[['', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']].map(([v, l]) => `<option value="${v}" ${v === f.days ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="os-kpis">${[['Contacted', base], ['Reply rate', pct(n('replied_at'), base)], ['Meeting rate', pct(n('meeting_at'), base)], ['Closed', n('invested_at')], ['Capital closed', 'USD ' + short(capital)], ['Median time to reply', med('contacted_at', 'replied_at')], ['Median time to meeting', med('contacted_at', 'meeting_at')]]
        .map(([l, v]) => `<div class="os-kpi"><div class="os-kpi-l">${l}</div><div class="os-kpi-v">${esc(v)}</div></div>`).join('')}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Investor funnel</div><div class="cap-sub">Share of contacted · ↳ conversion from the previous stage</div></div><div class="card-body">${base ? funnel : '<div class="os-empty">No outreach recorded for this filter yet.</div>'}
        <div class="cap-sub" style="margin-top:8px">* Opens are counted only where someone recorded them (outreach is sent from your own email, so opens are not tracked automatically). A reply always counts as opened.</div></div></div>
      <div class="os-dash-grid">${group(m => (CH[m.channel] || [, m.channel])[1], 'channel')}${group(m => inv(m.investor_id).investor_type, 'investor type')}${group(m => raiseName(raise(m.raise_id)), 'raise')}${group(m => (C.campaigns.find(c => c.id === m.campaign_id) || {}).name || 'No campaign', 'campaign')}
        <div class="card"><div class="card-header"><div class="card-title">Decline reasons</div></div><div class="card-body">${Object.entries(declines).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="os-pipe-row" style="cursor:default"><div class="os-pipe-l">${esc(k.replace(/_/g, ' '))}</div><div class="os-pipe-bar"><i style="width:${100 * v / dmax}%"></i></div><div class="os-pipe-v">${v}</div></div>`).join('') || '<div class="os-empty">No declines recorded.</div>'}</div></div></div>`;
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  const RENDER = { 'os-capital': renderCommand, 'os-deals': renderDeals, 'os-investors': renderCRM, 'os-campaigns': renderCampaigns, 'os-meetings': renderMeetings, 'os-cap-analytics': renderAnalytics };
  function current() { return typeof currentPanel !== 'undefined' ? currentPanel : null; }
  async function refresh() { C.loaded = 0; const p = current(); if (RENDER[p]) await RENDER[p](); badges(); }
  async function afterChange() { C.loaded = 0; await load(true); const p = current(); if (RENDER[p]) await RENDER[p](); badges(); }
  window.capRefresh = afterChange;
  const prevLoad = window.loadPanel;
  window.loadPanel = function (p) { if (RENDER[p]) { inject(); return RENDER[p](); } return prevLoad && prevLoad(p); };
  Object.assign(window, {
    capOpenRaise: openRaise, capSaveRaise: saveRaiseOps, capLostToggle: lostToggle, capNewRaise: newRaise, capSaveNewRaise: saveNewRaise, capDrop: drop,
    capDealsOff: v => { C.deals.off = v; renderDeals(); },
    capCrm: (k, v) => { C.crm[k] = v; if (k !== 'limit') C.crm.limit = 100; renderCRM(); },
    capNewCampaign: id => { inject(); load().then(() => newCampaign(id)); }, capEditCampaign: editCampaign, capSaveCampaign: saveCampaign, capAddSeq: addSeqRow,
    capOpenCampaign: id => { C.camp.open = id; renderCampaign(id); }, capCloseCampaign: () => { C.camp.open = null; renderCampaigns(); }, capCampaignStatus: campaignStatus,
    capAddCohort: addCohort, capSaveCohort: saveCohort, capRemoveCohort: removeCohort, capTouch: openTouch, capSaveTouch: saveTouch, capSkip: skip,
    capOpened: opened, capReply: replyOpen, capSaveReply: saveReply, capApprove: approve, capOutcome: outcome,
    capNewMeeting: pre => { inject(); newMeeting(pre); }, capOpenMeeting: openMeeting, capSaveMeeting: saveMeeting, capDelMeeting: delMeeting, capGenBrief: genBrief, capIcs: ics, capMeetStatus: meetStatusToggle, capMeetRaise: () => { $('cm-inv').innerHTML = invOptions($('cm-inv').value, $('cm-raise').value); },
    capMeetTab: t => { C.meet.tab = t; renderMeetings(); }, capAn: (k, v) => { C.an[k] = v; renderAnalytics(); }, __CAP: C,
  });

  const MODALS = `
  <div id="modal-cap-raise" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-cap-raise')"><div class="modal modal-lg" style="max-width:900px">
    <div class="modal-header"><div><div class="modal-title" id="cr-h">Raise</div><div class="modal-sub" id="cr-sub"></div></div><button class="modal-close" onclick="closeModal('modal-cap-raise')">✕</button></div>
    <div class="modal-body os-split"><div style="display:flex;flex-direction:column;gap:10px;min-width:0"><input type="hidden" id="cr-id"/>
      <div class="cap-mini-funnel" id="cr-funnel"></div>
      <div class="f-grid">
        <div class="f-group"><label class="f-label" for="cr-stage">Pipeline stage</label><select id="cr-stage" class="f-input f-select" onchange="capLostToggle()"></select></div>
        <div class="f-group"><label class="f-label" for="cr-mandate">Mandate</label><select id="cr-mandate" class="f-input f-select"><option value="none">No mandate</option><option value="proposed">Proposed</option><option value="signed">Signed</option><option value="ended">Ended</option></select></div>
        <div class="f-group"><label class="f-label" for="cr-owner">Owner</label><select id="cr-owner" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="cr-prob">Probability %</label><input id="cr-prob" type="number" min="0" max="100" class="f-input" placeholder="from stage"/></div>
        <div class="f-group"><label class="f-label" for="cr-na">Next action</label><input id="cr-na" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="cr-nad">Next action date</label><input id="cr-nad" type="date" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="cr-raised">Capital closed (<span id="cr-cur">USD</span>)</label><input id="cr-raised" class="f-input" placeholder="added automatically when investors invest"/></div>
      </div>
      <div class="f-group" id="cr-lost-wrap"><label class="f-label" for="cr-lost">Why was it lost?</label><input id="cr-lost" class="f-input"/></div>
      <div id="cr-actions" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
      <div style="min-width:0"><div class="os-box"><div class="os-box-h">History</div><div id="cr-hist"></div></div></div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-cap-raise')">Close</button><button class="btn btn-primary" id="cr-save" onclick="capSaveRaise()">Save</button></div></div></div>
  <div id="modal-cap-newraise" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-cap-newraise')"><div class="modal" style="max-width:680px">
    <div class="modal-header"><div class="modal-title">New capital raise</div><button class="modal-close" onclick="closeModal('modal-cap-newraise')">✕</button></div>
    <div class="modal-body"><div class="f-grid">
      <div class="f-group"><label class="f-label" for="nr-company">Company</label><input id="nr-company" class="f-input"/></div>
      <div class="f-group"><label class="f-label" for="nr-name">Raise name</label><input id="nr-name" class="f-input" placeholder="defaults to Company — Stage"/></div>
      <div class="f-group"><label class="f-label" for="nr-sectors">Sectors</label><input id="nr-sectors" class="f-input" placeholder="Fintech, SaaS"/></div>
      <div class="f-group"><label class="f-label" for="nr-stage">Round</label><select id="nr-stage" class="f-input f-select"><option>Pre-seed</option><option>Seed</option><option>Series A</option><option>Series B</option><option>Series C+</option><option>Growth</option><option>Pre-IPO</option><option>Debt</option></select></div>
      <div class="f-group"><label class="f-label" for="nr-instr">Instrument</label><select id="nr-instr" class="f-input f-select"><option>Equity</option><option>Convertible / SAFE</option><option>Preferred equity</option><option>Venture debt</option><option>Revenue-based financing</option><option>Private credit</option><option>Secondary</option></select></div>
      <div class="f-group"><label class="f-label" for="nr-target">Target raise</label><div style="display:flex;gap:6px"><select id="nr-cur" class="f-input f-select" style="width:84px"><option>USD</option><option>SGD</option><option>EUR</option><option>GBP</option><option>AED</option><option>AUD</option></select><input id="nr-target" class="f-input" placeholder="5m"/></div></div>
      <div class="f-group"><label class="f-label" for="nr-min">Minimum ticket</label><input id="nr-min" class="f-input" placeholder="250k"/></div>
      <div class="f-group"><label class="f-label" for="nr-owner">Owner</label><select id="nr-owner" class="f-input f-select"></select></div>
      <div class="f-group"><label class="f-label" for="nr-na">Next action</label><input id="nr-na" class="f-input" placeholder="Screen the company"/></div>
      <div class="f-group"><label class="f-label" for="nr-nad">Next action date</label><input id="nr-nad" type="date" class="f-input"/></div>
    </div><div class="cap-sub" style="margin-top:8px">Add traction, geography and ESG later under <b>Fundraising profile</b> — matching uses them.</div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-cap-newraise')">Cancel</button><button class="btn btn-primary" onclick="capSaveNewRaise()">Create raise</button></div></div></div>
  <div id="modal-cap-campaign" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-cap-campaign')"><div class="modal modal-lg" style="max-width:860px">
    <div class="modal-header"><div><div class="modal-title" id="cc-h">New campaign</div><div class="modal-sub">Merge fields: {first_name} {investor_org} {company} {stage} {target} {sector} {introducer}</div></div><button class="modal-close" onclick="closeModal('modal-cap-campaign')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:10px"><input type="hidden" id="cc-id"/>
      <div class="f-grid"><div class="f-group"><label class="f-label" for="cc-raise">Deal</label><select id="cc-raise" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="cc-name">Campaign name</label><input id="cc-name" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="cc-intro">Default introducer</label><input id="cc-intro" class="f-input" placeholder="Name of the person making warm intros"/></div></div>
      <div class="os-box"><div class="os-box-h">Sequence <button class="btn btn-ghost btn-sm" onclick="capAddSeq()">+ Step</button></div><div class="cap-seqrow cap-sub" style="font-weight:700"><span>#</span><span>Day</span><span>Channel</span><span>Label</span><span></span></div><div id="cc-seq"></div>
        <div class="cap-sub">Steps stop for an investor as soon as they reply or respond.</div></div>
      <div class="f-group"><label class="f-label" for="cc-subj">Email subject</label><input id="cc-subj" class="f-input"/></div>
      <div class="f-group"><label class="f-label" for="cc-email">Introduction email</label><textarea id="cc-email" rows="8" class="f-input"></textarea></div>
      <div class="f-group"><label class="f-label" for="cc-li">LinkedIn note (under 300 characters)</label><textarea id="cc-li" rows="3" class="f-input"></textarea></div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-cap-campaign')">Cancel</button><button class="btn btn-primary" onclick="capSaveCampaign()">Save campaign</button></div></div></div>
  <div id="modal-cap-cohort" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-cap-cohort')"><div class="modal" style="max-width:620px">
    <div class="modal-header"><div><div class="modal-title">Investor cohort</div><div class="modal-sub">From this raise's matches, best score first. 70+ pre-selected.</div></div><button class="modal-close" onclick="closeModal('modal-cap-cohort')">✕</button></div>
    <div class="modal-body"><input type="hidden" id="ca-id"/><div id="ca-list" style="max-height:55vh;overflow:auto"></div>
      <div class="cap-sub" style="margin-top:8px">Adding an investor does not approve outreach. Each one still needs CEO approval before any step can be sent.</div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-cap-cohort')">Cancel</button><button class="btn btn-primary" onclick="capSaveCohort()">Add to cohort</button></div></div></div>
  <div id="modal-cap-touch" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-cap-touch')"><div class="modal" style="max-width:640px">
    <div class="modal-header"><div><div class="modal-title" id="ct-h">Send</div><div class="modal-sub">To: <span id="ct-to"></span> — edit, send it yourself, then record it here.</div></div><button class="modal-close" onclick="closeModal('modal-cap-touch')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:10px"><input type="hidden" id="ct-mid"/><input type="hidden" id="ct-cid"/><input type="hidden" id="ct-k"/><input type="hidden" id="ct-ch"/>
      <div class="f-group" id="ct-intro-wrap"><label class="f-label" for="ct-intro">Introducer</label><input id="ct-intro" class="f-input"/></div>
      <div class="f-group" id="ct-subj-wrap"><label class="f-label" for="ct-subj">Subject</label><input id="ct-subj" class="f-input"/></div>
      <div class="f-group"><label class="f-label" for="ct-body">Message</label><textarea id="ct-body" rows="11" class="f-input" style="font-size:13px;line-height:1.5"></textarea></div>
      <div class="os-flag" id="ct-li-warn">LinkedIn connection notes are limited to 300 characters</div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('ct-body').value);toast('Copied','success')">Copy</button><a id="ct-open" class="btn btn-ghost" target="_blank" rel="noopener">Open</a><button class="btn btn-ghost" onclick="capSaveTouch('skipped')">Skip step</button><button class="btn btn-primary" onclick="capSaveTouch('sent')">I've sent it — record</button></div></div></div>
  <div id="modal-cap-reply" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-cap-reply')"><div class="modal" style="max-width:460px">
    <div class="modal-header"><div class="modal-title">Record reply</div><button class="modal-close" onclick="closeModal('modal-cap-reply')">✕</button></div>
    <div class="modal-body"><input type="hidden" id="cy-id"/><div class="f-group"><label class="f-label" for="cy-note">What did they say?</label><textarea id="cy-note" rows="3" class="f-input"></textarea></div><div class="cap-sub" style="margin-top:6px">The sequence stops for this investor. Next you'll record the outcome (interested, meeting, declined…).</div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-cap-reply')">Cancel</button><button class="btn btn-primary" onclick="capSaveReply()">Save reply</button></div></div></div>
  <div id="modal-cap-meeting" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-cap-meeting')"><div class="modal modal-lg" style="max-width:1000px">
    <div class="modal-header"><div class="modal-title" id="cm-h">Meeting</div><button class="modal-close" onclick="closeModal('modal-cap-meeting')">✕</button></div>
    <div class="modal-body os-split"><div style="display:flex;flex-direction:column;gap:10px;min-width:0"><input type="hidden" id="cm-id"/>
      <div class="f-grid">
        <div class="f-group"><label class="f-label" for="cm-inv">Investor</label><select id="cm-inv" class="f-input f-select"></select></div>
        <div class="f-group"><label class="f-label" for="cm-raise">Company / raise</label><select id="cm-raise" class="f-input f-select" onchange="capMeetRaise()"></select></div>
        <div class="f-group"><label class="f-label" for="cm-at">Date &amp; time</label><input id="cm-at" type="datetime-local" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="cm-dur">Minutes</label><input id="cm-dur" type="number" min="5" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="cm-type">Type</label><select id="cm-type" class="f-input f-select"><option value="intro">Intro</option><option value="pitch">Pitch</option><option value="follow_up">Follow-up</option><option value="dd">DD session</option><option value="negotiation">Negotiation</option><option value="other">Other</option></select></div>
        <div class="f-group"><label class="f-label" for="cm-loc">Location / link</label><input id="cm-loc" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="cm-att">Attendees</label><input id="cm-att" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="cm-status">Status</label><select id="cm-status" class="f-input f-select" onchange="capMeetStatus()"><option value="scheduled">Scheduled</option><option value="held">Held</option><option value="no_show">No-show</option><option value="cancelled">Cancelled</option></select></div>
      </div>
      <div class="f-group"><label class="f-label" for="cm-notes">Notes</label><textarea id="cm-notes" rows="5" class="f-input"></textarea></div>
      <div class="f-grid"><div class="f-group"><label class="f-label" for="cm-outcome">Outcome</label><select id="cm-outcome" class="f-input f-select"><option value="">—</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select></div>
        <div class="f-group"><label class="f-label" for="cm-na" id="cm-na-l">Next action</label><input id="cm-na" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="cm-nad">Next action date</label><input id="cm-nad" type="date" class="f-input"/></div></div></div>
      <div style="min-width:0;display:flex;flex-direction:column;gap:6px"><div class="os-box-h" style="margin:0">Meeting brief <button class="btn btn-ghost btn-sm" onclick="capGenBrief()">Generate from records</button></div>
        <textarea id="cm-brief" rows="22" class="f-input" style="font-size:12px;line-height:1.45;font-family:ui-monospace,Menlo,monospace" placeholder="Generate a brief from the investor profile, match score, outreach history and raise — then edit."></textarea></div></div>
    <div class="modal-footer"><button class="btn btn-ghost" id="cm-del" style="margin-right:auto;color:#b3261e" onclick="capDelMeeting()">Delete</button><button class="btn btn-ghost" onclick="capIcs()">Add to calendar (.ics)</button><button class="btn btn-ghost" onclick="closeModal('modal-cap-meeting')">Close</button><button class="btn btn-primary" id="cm-save" onclick="capSaveMeeting()">Save meeting</button></div></div></div>`;

  const CSS = `
  .cap-chain{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.cap-chain i{font-style:normal;color:var(--white-muted);opacity:.6}
  .cap-flow{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;margin-bottom:16px}@media(max-width:1300px){.cap-flow{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:640px){.cap-flow{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .cap-tile{position:relative;text-align:left;background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:12px;cursor:pointer;font:inherit;min-width:0}.cap-tile:hover{border-color:var(--emerald)}
  .cap-tile.warn{border-color:rgba(179,38,30,.35);background:#fff8f7}
  .cap-tile-n{position:absolute;top:6px;right:8px;font-size:10px;font-weight:800;color:var(--white-muted)}
  .cap-tile-l{font-size:11px;font-weight:700;color:var(--white-muted);text-transform:uppercase;letter-spacing:.05em}.cap-tile-v{font-size:19px;font-weight:800;color:var(--ink);margin-top:4px;white-space:nowrap}.cap-tile-v small{font-size:11px;font-weight:700;color:var(--white-muted)}.cap-tile-s{font-size:11px;color:var(--white-muted);margin-top:2px}
  .cap-stage{display:inline-block;font-size:11px;font-weight:700;background:#e8f0ec;color:#0a5c40;border-radius:4px;padding:2px 7px}
  .cap-od{color:#b3261e;font-weight:700}.cap-sub{font-size:11px;color:var(--white-muted)}.cap-ok{font-size:11px;font-weight:700;color:var(--emerald)}
  .cap-dots{letter-spacing:1px;font-size:10px;color:var(--emerald)}.cap-dots i{font-style:normal;color:var(--border)}
  .cap-score{font-size:16px;color:var(--c)}.cap-ic{font-size:15px;vertical-align:-3px;color:var(--white-dim)}
  .cap-camps{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}@media(max-width:640px){.cap-camps{grid-template-columns:minmax(0,1fr)}}
  .cap-camp{padding:14px 16px;cursor:pointer}.cap-camp:hover{border-color:var(--emerald)}
  .cap-cchain{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}.cap-cchain div{display:flex;flex-direction:column;align-items:center;min-width:54px;background:var(--surface-2,#f4f3ee);border-radius:6px;padding:5px 8px}
  .cap-cchain b{font-size:16px;color:var(--ink);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cap-cchain span{font-size:10px;color:var(--white-muted)}.cap-cchain i{font-style:normal;color:var(--white-muted)}
  .cap-cst{font-size:10.5px;font-weight:700;text-transform:capitalize;border-radius:4px;padding:2px 7px;background:#eee}.cap-cst-active{background:#0a5c40;color:#fff}.cap-cst-paused{background:#fff4d6;color:#7a5c00}
  .cap-step{display:inline-flex;min-width:22px;height:22px;align-items:center;justify-content:center;border-radius:6px;font-size:11px;font-weight:700;border:1px dashed var(--border);color:var(--white-muted);padding:0 4px}
  .cap-step.sent{border:0;background:#e8f0ec;color:#0a5c40}.cap-step.opn{background:#d3e7dc}.cap-step.rep{background:#0a5c40;color:#fff}.cap-step.skip{border-style:solid}
  .cap-step.due{border:1px solid #7a5c00;color:#7a5c00;background:#fff8e6}.cap-step.due.od{border-color:#b3261e;color:#b3261e;background:#fdecea}
  .cap-seqrow{display:grid;grid-template-columns:24px 80px 150px minmax(0,1fr) 40px;gap:6px;align-items:center;margin-bottom:6px}
  .cap-pick{display:flex;gap:10px;align-items:center;padding:7px 4px;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer}
  .cap-day td{background:var(--surface-2,#f4f3ee);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--emerald-deep)}
  .cap-out{font-size:10.5px;font-weight:700;border-radius:4px;padding:2px 7px;text-transform:capitalize}.cap-out-positive{background:#0a5c40;color:#fff}.cap-out-neutral{background:#eee}.cap-out-negative{background:#fdecea;color:#8c1d18}
  .cap-mini-funnel{display:flex;gap:6px;flex-wrap:wrap}.cap-mini-funnel div{display:flex;flex-direction:column;align-items:center;background:var(--surface-2,#f4f3ee);border-radius:6px;padding:5px 10px;font-size:10px;color:var(--white-muted)}.cap-mini-funnel b{font-size:16px;color:var(--ink)}
  .cap-fun{display:grid;grid-template-columns:110px minmax(0,1fr) 110px 70px;gap:10px;align-items:center;padding:5px 0;font-size:12px}
  .cap-fun-l{font-weight:700;color:var(--ink)}.cap-fun-bar{height:18px;background:var(--surface-2,#f0f0f0);border-radius:4px;overflow:hidden}.cap-fun-bar i{display:block;height:100%;background:var(--emerald);border-radius:0 4px 4px 0}
  .cap-fun-v b{font-size:14px;color:var(--ink)}.cap-fun-v span,.cap-fun-c{color:var(--white-muted);font-size:11px}
  @media(max-width:640px){.cap-fun{grid-template-columns:80px minmax(0,1fr) 70px}.cap-fun-c{display:none}.cap-seqrow{grid-template-columns:20px 60px 110px minmax(0,1fr) 34px}}
  .cap-board{grid-auto-columns:minmax(190px,1fr)}
  .cap-strip{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:12px}.cap-strip i{font-style:normal;color:var(--white-muted);font-size:11px}
  .cap-strip button{border:1px solid var(--border);background:#fff;border-radius:6px;padding:4px 8px;font:600 11px var(--font-ui);color:var(--white-muted);cursor:pointer;display:flex;gap:5px;align-items:baseline}
  .cap-strip button b{font-size:14px;color:var(--white-muted)}.cap-strip button.on{border-color:var(--emerald);color:var(--ink)}.cap-strip button.on b{color:var(--emerald)}
  #os-cap-nav-group .nav-item{position:relative}`;

  const tryInject = () => { if ($('os-nav-group') && window.__OS && window.__OS.sb) { inject(); placeMatching(); return true; } return false; };
  if (!tryInject()) { const t = setInterval(() => { if (tryInject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000); }
  const pm = setInterval(placeMatching, 1000); setTimeout(() => clearInterval(pm), 30000);
})();
