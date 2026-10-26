/* BANAHUB Commercial OS — Phase 1
 * Revenue dashboard, Sales Opportunities, Companies, Contacts, Tasks, Lead Qualification Score,
 * Roles & Access. Data lives in os_* tables; every read/write goes through Supabase RLS
 * (least privilege), so the UI only decides what to show, never what is allowed.
 * Loaded after the inline admin script; hooks enterOS / loadPanel.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const addDays = (n, from) => { const d = from ? new Date(from) : new Date(); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const fmtDate = d => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
  const ago = d => { if (!d) return '—'; const h = (Date.now() - new Date(d)) / 36e5; return h < 1 ? 'just now' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
  const money = (n, c) => n == null || n === '' ? '—' : `${c || 'SGD'} ${Number(n).toLocaleString('en-SG', { maximumFractionDigits: 0 })}`;
  // admin.html declares these with let/const, so they are globals but not window properties
  const AU = () => (typeof ADMIN_USER !== 'undefined' && ADMIN_USER) || {};
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));

  // ── Reference data ────────────────────────────────────────────────────────
  const STAGES = [['lead', 'Lead'], ['qualified', 'Qualified'], ['discovery', 'Discovery'], ['proposal', 'Proposal'], ['negotiation', 'Negotiation'], ['won', 'Won'], ['on_hold', 'On hold'], ['lost', 'Lost'], ['disqualified', 'Disqualified']];
  const OPEN_STAGES = ['lead', 'qualified', 'discovery', 'proposal', 'negotiation'];
  const STAGE_PROB = { lead: 10, qualified: 20, discovery: 30, proposal: 50, negotiation: 70, won: 100, lost: 0, disqualified: 0 };
  const TYPES = [['advisory_mandate', 'Paid advisory mandate'], ['market_entry', 'Market-entry project'], ['capital_readiness', 'Capital-readiness project'], ['partnership', 'Strategic partnership'], ['portfolio_retainer', 'Portfolio advisory retainer'], ['investor_introduction', 'Eligible investor introduction'], ['success_fee', 'Success fee']];
  const FEES = [['', '—'], ['fixed', 'Fixed fee'], ['retainer', 'Retainer'], ['success_fee', 'Success fee'], ['fixed_plus_success', 'Fixed + success fee'], ['hourly', 'Hourly'], ['tbc', 'To be confirmed']];
  const ROLES = [['ceo_admin', 'CEO / Admin'], ['bd', 'Business Development'], ['advisor', 'Advisor'], ['ai_marketing', 'AI / Marketing Team'], ['finance', 'Finance'], ['partner_agent', 'Partner / Agent']];
  const CRITERIA = [
    ['strategic_fit', 'Strategic fit', 15, 'Fits BANAHUB pillars, target markets and the kind of work we want'],
    ['budget', 'Budget', 15, 'Budget allocated or clearly available for advisory fees'],
    ['urgency', 'Urgency', 15, 'Timeline or trigger event (launch, raise, board deadline)'],
    ['decision_maker', 'Decision-maker access', 10, 'Talking to the person who signs'],
    ['market_expansion', 'Market expansion need', 10, 'Needs Singapore / ASEAN entry or cross-border expansion'],
    ['gtm_need', 'GTM need', 10, 'Needs go-to-market, partnerships or channel work'],
    ['capital_readiness', 'Capital readiness', 10, 'Evidence, materials and team ready for capital conversations'],
    ['commercial_potential', 'Commercial potential', 10, 'Fee size, retainer or follow-on potential'],
    ['network_relevance', 'BANAHUB network relevance', 5, 'Our partners and investors are relevant to their need'],
  ];
  const classify = n => n >= 80 ? 'Priority A' : n >= 60 ? 'Priority B' : n >= 40 ? 'Nurture' : 'Disqualify / self-service';
  const CLASS_COLOR = { 'Priority A': '#0a5c40', 'Priority B': '#1a4d7a', 'Nurture': '#7a5c00', 'Disqualify / self-service': '#8c1d18' };
  const stageLabel = s => (STAGES.find(x => x[0] === s) || [s, s])[1];
  const typeLabel = s => (TYPES.find(x => x[0] === s) || [s, s || '—'])[1];
  const roleLabel = s => (ROLES.find(x => x[0] === s) || [s, s || '—'])[1];
  const statusOf = o => o.status || (o.stage === 'won' ? 'won' : ['lost', 'disqualified'].includes(o.stage) ? 'closed' : o.stage === 'on_hold' ? 'on_hold' : 'open');
  // Same rules as the database view, so flags are consistent everywhere
  function flags(o) {
    const open = statusOf(o) === 'open', t = today();
    const f = {
      noNext: open && (!String(o.next_action || '').trim() || !o.next_action_date),
      overdue: open && !!o.next_action_date && o.next_action_date < t,
      noOwner: open && !o.owner_id,
      stale: open && !!o.last_activity_at && (Date.now() - new Date(o.last_activity_at)) > 14 * 864e5,
    };
    f.stalled = f.noNext || f.overdue || f.noOwner || f.stale;
    return f;
  }
  const flagChips = o => { const f = flags(o); return [f.noNext && 'No next action', f.overdue && 'Overdue', f.noOwner && 'No owner', f.stale && 'No activity 14d+'].filter(Boolean).map(x => `<span class="os-flag">${x}</span>`).join(''); };
  const classBadge = c => c ? `<span class="os-class" style="--c:${CLASS_COLOR[c] || '#555'}">${esc(c)}</span>` : '<span class="os-class os-class-none">Unscored</span>';

  // ── State ─────────────────────────────────────────────────────────────────
  const OS = { sb: null, uid: null, role: null, perms: new Set(), people: [], staff: [], opps: [], companies: [], contacts: [], tasks: [], view: 'board', taskTab: 'mine' };
  const can = p => OS.perms.has('*') || OS.perms.has(p);
  const person = id => OS.people.find(p => p.id === id);
  const personName = id => { const p = person(id); return p ? (p.full_name || p.email) : id ? 'Team member' : 'Unassigned'; };
  async function q(promise) { const r = await promise; if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; }

  async function osInit() {
    OS.sb = await window.getBanaSupabaseClient();
    OS.uid = AU().id || null;
    try { OS.role = (await OS.sb.rpc('os_role')).data || (AU().role === 'admin' ? 'ceo_admin' : null); }
    catch (e) { OS.role = AU().role === 'admin' ? 'ceo_admin' : null; }
    try { (await q(OS.sb.from('os_role_permissions').select('role,perm').eq('role', OS.role))).forEach(r => OS.perms.add(r.perm)); } catch (e) { if (OS.role === 'ceo_admin') OS.perms.add('*'); }
    if (OS.role === 'ceo_admin') OS.perms.add('*');
    await loadPeople();
    injectUI();
    applyRoleVisibility();
  }
  async function loadPeople() {
    try { OS.staff = await q(OS.sb.from('os_staff').select('*')); } catch (e) { OS.staff = []; }
    const ids = [...new Set(OS.staff.map(s => s.user_id).concat(OS.uid ? [OS.uid] : []))];
    let users = [];
    try { users = ids.length ? await q(OS.sb.from('users').select('id,full_name,email,role').in('id', ids)) : []; } catch (e) { users = []; }
    const me = AU(); if (me.id && !users.some(u => u.id === me.id)) users.push({ id: me.id, full_name: me.full_name, email: me.email, role: me.role });
    OS.people = users.map(u => Object.assign({}, u, { os_role: u.role === 'admin' ? 'ceo_admin' : ((OS.staff.find(s => s.user_id === u.id && s.active) || {}).role || null) })).filter(u => u.os_role);
  }
  const ownerOptions = sel => '<option value="">Unassigned</option>' + OS.people.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.full_name || p.email)} — ${esc(roleLabel(p.os_role))}</option>`).join('');

  // ── UI injection ──────────────────────────────────────────────────────────
  const NAV = [
    ['os-dashboard', 'insights', 'Revenue Dashboard', null],
    ['os-opps', 'trending_up', 'Sales Opportunities', 'opps'],
    ['os-companies', 'domain', 'Companies', 'companies'],
    ['os-contacts', 'contacts', 'Contacts', 'contacts'],
    ['os-tasks', 'task_alt', 'Tasks', null],
  ];
  function injectUI() {
    if ($('os-nav-group')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    // sidebar
    const first = document.querySelector('#sidebar .nav-group');
    const g = document.createElement('div'); g.className = 'nav-group'; g.id = 'os-nav-group';
    g.innerHTML = '<div class="nav-label">Commercial OS</div>' + NAV.map(([id, ic, label]) =>
      `<button class="nav-item" onclick="nav('${id}')" data-os-nav="${id}"><span class="nav-icon material-symbols-outlined">${ic}</span>${label}${id === 'os-dashboard' ? '<span class="nav-badge" id="nb-os-stalled" style="display:none"></span>' : ''}${id === 'os-tasks' ? '<span class="nav-badge" id="nb-os-tasks" style="display:none"></span>' : ''}</button>`).join('');
    first.parentNode.insertBefore(g, first);
    const sys = [...document.querySelectorAll('#sidebar .nav-label')].find(l => /system/i.test(l.textContent));
    if (sys) { const b = document.createElement('button'); b.className = 'nav-item'; b.setAttribute('onclick', "nav('os-roles')"); b.innerHTML = '<span class="nav-icon material-symbols-outlined">admin_panel_settings</span>Roles &amp; Access'; sys.parentNode.appendChild(b); }
    // the old CRM is superseded by Companies / Contacts / Opportunities (its records were migrated)
    const oldCrm = [...document.querySelectorAll('#sidebar .nav-item')].find(b => b.getAttribute('onclick') === "nav('crm')"); if (oldCrm) oldCrm.style.display = 'none';
    // relabel the old dashboard
    const oldDash = [...document.querySelectorAll('#sidebar .nav-item')].find(b => b.getAttribute('onclick') === "nav('dashboard')");
    if (oldDash) [...oldDash.childNodes].filter(n => n.nodeType === 3 && /dashboard/i.test(n.textContent)).forEach(n => { n.textContent = 'Website & Members'; });
    // panels
    const host = $('panel-dashboard').parentNode;
    host.insertAdjacentHTML('beforeend', PANELS);
    document.body.insertAdjacentHTML('beforeend', MODALS);
    Object.assign(typeof panelMeta !== 'undefined' ? panelMeta : {}, {
      'os-dashboard': ['Revenue Dashboard', 'Priority opportunities, stalled deals and next actions'],
      'os-opps': ['Sales Opportunities', 'Pipeline — every open deal needs an owner, a next action and a date'],
      'os-companies': ['Companies', 'Accounts, relationships and their next actions'],
      'os-contacts': ['Contacts', 'People at companies, partners and investors'],
      'os-tasks': ['Tasks', 'Follow-ups and next actions'],
      'os-roles': ['Roles & Access', 'Least-privilege roles for the team'],
    });
    $('oo-type').innerHTML = TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('oo-stage').innerHTML = STAGES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('oo-fee').innerHTML = FEES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('os-o-stage-f').innerHTML = '<option value="">All stages</option><option value="open">Open only</option>' + STAGES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('os-o-type-f').innerHTML = '<option value="">All types</option>' + TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('os-o-class-f').innerHTML = '<option value="">All priorities</option>' + ['Priority A', 'Priority B', 'Nurture', 'Disqualify / self-service', 'Unscored'].map(c => `<option>${c}</option>`).join('');
    $('osr-role').innerHTML = ROLES.filter(r => r[0] !== 'ceo_admin').map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('os-sc-rows').innerHTML = CRITERIA.map(([k, l, max, hint]) => `<div class="os-sc-row"><div><div style="font-weight:600;font-size:13px">${l} <span style="color:var(--white-muted);font-weight:500">/ ${max}</span></div><div style="font-size:11px;color:var(--white-muted)">${hint}</div></div>
      <input type="range" min="0" max="${max}" value="0" id="os-sc-${k}" oninput="this.nextElementSibling.value=this.value;osScoreTotal()"/><input type="number" min="0" max="${max}" value="0" class="f-input" style="width:64px;padding:4px 8px" oninput="this.value=Math.max(0,Math.min(${max},+this.value||0));this.previousElementSibling.value=this.value;osScoreTotal()"/></div>`).join('');
  }
  function applyRoleVisibility() {
    const ceo = OS.role === 'ceo_admin';
    // Legacy website / member / finance modules: CEO only
    document.querySelectorAll('#sidebar .nav-group').forEach(g => { if (g.id !== 'os-nav-group' && !ceo) g.style.display = 'none'; });
    NAV.forEach(([id, , , area]) => {
      const b = document.querySelector(`[data-os-nav="${id}"]`); if (!b) return;
      const ok = !area || (area === 'opps' ? (can('opps.read_all') || can('opps.write') || can('referrals.read')) : area === 'companies' ? (can('companies.read_all') || can('companies.write') || can('opps.write') || can('referrals.read')) : (can('contacts.read_all') || can('contacts.write') || can('opps.write') || can('referrals.read')));
      b.style.display = ok ? '' : 'none';
    });
    document.querySelectorAll('[data-os-perm]').forEach(el => { el.style.display = el.getAttribute('data-os-perm').split('|').some(can) ? '' : 'none'; });
    const rb = document.querySelector(`#sidebar [onclick="nav('os-roles')"]`); if (rb) rb.style.display = ceo ? '' : 'none';
    const badge = document.querySelector('.sidebar-badge'); if (badge && OS.role) badge.textContent = roleLabel(OS.role);
  }

  // ── Loaders ───────────────────────────────────────────────────────────────
  async function loadOpps() { OS.opps = await q(OS.sb.from('os_opportunities_v').select('*').order('updated_at', { ascending: false })); return OS.opps; }
  async function loadCompanies() { OS.companies = await q(OS.sb.from('os_companies').select('*').order('name')); return OS.companies; }
  async function loadContacts() { OS.contacts = await q(OS.sb.from('os_contacts').select('*').order('full_name')); return OS.contacts; }
  async function loadTasks() { OS.tasks = await q(OS.sb.from('os_tasks').select('*').order('due_date', { ascending: true })); return OS.tasks; }
  const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { notify('Could not load: ' + e.message, 'warn'); console.error(e); } };

  // ── Dashboard ─────────────────────────────────────────────────────────────
  const loadDash = safe(async function () {
    await Promise.all([loadOpps(), loadTasks()]);
    const open = OS.opps.filter(o => statusOf(o) === 'open'), t = today();
    const qStart = (() => { const d = new Date(); return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).toISOString(); })();
    const won = OS.opps.filter(o => o.stage === 'won' && o.won_at && o.won_at >= qStart);
    const stalled = open.filter(o => flags(o).stalled);
    const pending = OS.opps.filter(o => o.has_pending_score);
    const myTasks = OS.tasks.filter(x => x.status === 'open' && (x.assignee_id === OS.uid || (!x.assignee_id && x.created_by === OS.uid)));
    const dueNow = myTasks.filter(x => x.due_date && x.due_date <= t);
    const showVal = can('opps.value');
    const sum = (rows, k) => rows.reduce((a, o) => a + (Number(o[k]) || 0), 0);
    $('os-kpis').innerHTML = [
      showVal && ['Weighted pipeline', money(sum(open, 'weighted_value')), 'Open value × probability', 'account_balance_wallet'],
      showVal && ['Won this quarter', money(sum(won, 'value')), `${won.length} deal${won.length === 1 ? '' : 's'}`, 'workspace_premium'],
      ['Open opportunities', open.length, showVal ? money(sum(open, 'value')) + ' unweighted' : '', 'trending_up'],
      ['Stalled', stalled.length, 'No next action, overdue, no owner or idle 14d+', 'report', stalled.length ? 'warn' : ''],
      ['Scores to approve', pending.length, 'AI / form suggestions awaiting a human', 'rule', pending.length ? 'warn' : ''],
      ['My actions due', dueNow.length, `${myTasks.length} open task${myTasks.length === 1 ? '' : 's'}`, 'event_upcoming', dueNow.length ? 'warn' : ''],
    ].filter(Boolean).map(([l, v, s, ic, w]) => `<div class="os-kpi${w ? ' os-kpi-warn' : ''}"><div class="os-kpi-l"><span class="material-symbols-outlined">${ic}</span>${l}</div><div class="os-kpi-v">${esc(v)}</div><div class="os-kpi-s">${esc(s)}</div></div>`).join('');
    const list = (rows, empty) => rows.length ? `<table class="data-table os-table"><thead><tr><th>Opportunity</th><th>Stage</th>${showVal ? '<th>Value</th>' : ''}<th>Next action</th><th>Owner</th></tr></thead><tbody>${rows.slice(0, 12).map(o => oppRow(o, showVal)).join('')}</tbody></table>${rows.length > 12 ? `<div class="os-more" onclick="osOppFilter('${''}')">+ ${rows.length - 12} more</div>` : ''}` : `<div class="os-empty">${empty}</div>`;
    const byScore = c => open.filter(o => o.score_class === c).sort((a, b) => (b.score_total || 0) - (a.score_total || 0));
    $('os-dash-a').innerHTML = list(byScore('Priority A'), 'No Priority A opportunities. Score your open opportunities to see them here.');
    $('os-dash-b').innerHTML = list(byScore('Priority B'), 'No Priority B opportunities.');
    $('os-dash-stalled').innerHTML = list(stalled.sort((a, b) => (a.next_action_date || '0') < (b.next_action_date || '0') ? -1 : 1), 'Nothing stalled — every open opportunity has an owner, a dated next action and recent activity.');
    $('os-dash-dq').innerHTML = list(OS.opps.filter(o => o.stage === 'disqualified' || (o.score_class === 'Disqualify / self-service' && statusOf(o) !== 'won')), 'No disqualified opportunities.');
    ['a', 'b', 'stalled', 'dq'].forEach(k => { const n = { a: byScore('Priority A').length, b: byScore('Priority B').length, stalled: stalled.length, dq: OS.opps.filter(o => o.stage === 'disqualified' || o.score_class === 'Disqualify / self-service').length }[k]; $('os-dash-n-' + k).textContent = n; });
    // pipeline by stage
    const max = Math.max(1, ...OPEN_STAGES.map(s => showVal ? sum(open.filter(o => o.stage === s), 'value') : open.filter(o => o.stage === s).length));
    $('os-dash-pipe').innerHTML = OPEN_STAGES.map(s => { const rows = open.filter(o => o.stage === s); const v = showVal ? sum(rows, 'value') : rows.length;
      return `<div class="os-pipe-row" onclick="osOppFilter('${s}')"><div class="os-pipe-l">${stageLabel(s)} <span>${rows.length}</span></div><div class="os-pipe-bar"><i style="width:${Math.round(v / max * 100)}%"></i></div><div class="os-pipe-v">${showVal ? money(v) : rows.length}</div></div>`; }).join('');
    $('os-dash-tasks').innerHTML = myTasks.length ? myTasks.slice(0, 10).map(taskRow).join('') : '<div class="os-empty">No open tasks assigned to you.</div>';
    setBadges(stalled.length, dueNow.length);
  });
  function setBadges(stalled, due) {
    const s = $('nb-os-stalled'), d = $('nb-os-tasks');
    if (s) { s.textContent = stalled; s.style.display = stalled ? '' : 'none'; }
    if (d) { d.textContent = due; d.style.display = due ? '' : 'none'; }
  }
  function oppRow(o, showVal) {
    const f = flags(o);
    return `<tr onclick="osOpenOpp('${o.id}')" style="cursor:pointer"><td><div style="font-weight:600;color:var(--ink)">${esc(o.title)}</div><div style="font-size:11px;color:var(--white-muted)">${esc(o.company_name || '')}${o.company_name ? ' · ' : ''}${esc(typeLabel(o.opp_type))}</div><div style="margin-top:3px">${classBadge(o.score_class)}${o.has_pending_score ? '<span class="os-flag os-flag-info">Score to approve</span>' : ''}${flagChips(o)}</div></td>
      <td style="font-size:12px">${esc(stageLabel(o.stage))}</td>${showVal ? `<td style="font-size:12px;white-space:nowrap">${money(o.value, o.currency)}<div style="font-size:11px;color:var(--white-muted)">${o.probability != null ? o.probability + '%' : ''}</div></td>` : ''}
      <td style="font-size:12px;max-width:240px">${o.next_action ? esc(o.next_action) : '<span style="color:#b3261e">— none —</span>'}<div style="font-size:11px;color:${f.overdue ? '#b3261e' : 'var(--white-muted)'}">${o.next_action_date ? fmtDate(o.next_action_date) : 'no date'}</div></td>
      <td style="font-size:12px">${esc(o.owner_name || personName(o.owner_id))}</td></tr>`;
  }

  // ── Opportunities ─────────────────────────────────────────────────────────
  const loadOppsPanel = safe(async function () { await Promise.all([loadOpps(), loadCompanies()]); renderOpps(); });
  function oppRows() {
    const s = ($('os-o-search').value || '').toLowerCase(), st = $('os-o-stage-f').value, ty = $('os-o-type-f').value, cl = $('os-o-class-f').value, mine = $('os-o-mine').checked, stl = $('os-o-stalled').checked;
    return OS.opps.filter(o => (!s || [o.title, o.company_name, o.contact_name, o.next_action, o.notes].join(' ').toLowerCase().includes(s))
      && (!st || (st === 'open' ? statusOf(o) === 'open' : o.stage === st)) && (!ty || o.opp_type === ty)
      && (!cl || (cl === 'Unscored' ? !o.score_class : o.score_class === cl)) && (!mine || o.owner_id === OS.uid) && (!stl || flags(o).stalled));
  }
  function renderOpps() {
    const rows = oppRows(), showVal = can('opps.value');
    $('os-o-count').textContent = `${rows.length} shown · ${rows.filter(o => flags(o).stalled).length} stalled`;
    $('os-o-view').textContent = OS.view === 'board' ? 'Table view' : 'Board view';
    if (OS.view === 'table') {
      $('os-o-body').innerHTML = rows.length ? `<div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Opportunity</th><th>Stage</th>${showVal ? '<th>Value</th>' : ''}<th>Next action</th><th>Owner</th></tr></thead><tbody>${rows.map(o => oppRow(o, showVal)).join('')}</tbody></table></div>` : '<div class="os-empty">No opportunities match.</div>';
      return;
    }
    const cols = OPEN_STAGES.concat(['won', 'on_hold', 'lost', 'disqualified']);
    $('os-o-body').innerHTML = `<div class="os-board">${cols.map(s => { const r = rows.filter(o => o.stage === s);
      return `<div class="os-col" ondragover="event.preventDefault()" ondrop="osDrop(event,'${s}')"><div class="os-col-h">${stageLabel(s)} <span>${r.length}</span>${showVal ? `<em>${money(r.reduce((a, o) => a + (+o.value || 0), 0))}</em>` : ''}</div>
        ${r.map(o => `<div class="os-card${flags(o).stalled ? ' os-card-stalled' : ''}" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${o.id}')" onclick="osOpenOpp('${o.id}')">
          <div class="os-card-t">${esc(o.title)}</div><div class="os-card-s">${esc(o.company_name || typeLabel(o.opp_type))}</div>
          <div class="os-card-m">${showVal && o.value != null ? `<b>${money(o.value, o.currency)}</b>` : ''}${classBadge(o.score_class)}</div>
          <div class="os-card-n${flags(o).overdue ? ' od' : ''}">${o.next_action ? '→ ' + esc(o.next_action) + (o.next_action_date ? ' · ' + fmtDate(o.next_action_date) : '') : '<span class="os-flag">No next action</span>'}</div>
          ${flags(o).noOwner || flags(o).stale ? `<div>${flagChips(o)}</div>` : ''}</div>`).join('') || '<div class="os-col-empty">—</div>'}</div>`; }).join('')}</div>`;
  }
  async function dropStage(ev, stage) {
    ev.preventDefault(); const id = ev.dataTransfer.getData('text/plain'); const o = OS.opps.find(x => x.id === id); if (!o || o.stage === stage) return;
    if (!can('opps.write')) return notify('Your role cannot change stages', 'warn');
    if (stage === 'lost') return osOpenOpp(id, { stage: 'lost' });
    try { await q(OS.sb.from('os_opportunities').update({ stage }).eq('id', id)); notify(`Moved to ${stageLabel(stage)}`); await loadOpps(); renderOpps(); }
    catch (e) { notify('Update failed: ' + e.message, 'warn'); }
  }

  // ── Opportunity modal ─────────────────────────────────────────────────────
  let cur = null;
  async function openOpp(id, preset) {
    if (!OS.companies.length) await loadCompanies().catch(() => {});
    if (!OS.contacts.length) await loadContacts().catch(() => {});
    const o = id ? (OS.opps.find(x => x.id === id) || (await q(OS.sb.from('os_opportunities_v').select('*').eq('id', id)))[0]) : Object.assign({ stage: 'lead', opp_type: 'advisory_mandate', currency: 'SGD', owner_id: OS.uid }, preset || {});
    cur = Object.assign({}, o, id ? preset || {} : {});
    $('oo-title-h').textContent = id ? o.title : 'New opportunity';
    $('oo-sub').innerHTML = id ? `${classBadge(o.score_class)} ${flagChips(o)} <span style="color:var(--white-muted)">Created ${fmtDate(o.created_at)} · updated ${ago(o.updated_at)}</span>` : 'Every open opportunity needs an owner, a next action and a date.';
    $('oo-id').value = id || '';
    $('oo-title').value = cur.title || '';
    $('oo-company').innerHTML = '<option value="">— none —</option><option value="__new">+ New company…</option>' + OS.companies.map(c => `<option value="${c.id}" ${c.id === cur.company_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    $('oo-company-new').style.display = 'none'; $('oo-company-new').value = '';
    fillContacts(cur.company_id, cur.contact_id);
    $('oo-type').value = cur.opp_type || 'advisory_mandate'; $('oo-stage').value = cur.stage || 'lead';
    $('oo-owner').innerHTML = ownerOptions(cur.owner_id);
    $('oo-value').value = cur.value != null ? cur.value : ''; $('oo-currency').value = cur.currency || 'SGD';
    $('oo-prob').value = cur.probability != null ? cur.probability : (STAGE_PROB[cur.stage] != null ? STAGE_PROB[cur.stage] : '');
    $('oo-close').value = cur.expected_close || ''; $('oo-fee').value = cur.fee_structure || '';
    $('oo-next').value = cur.next_action || ''; $('oo-next-date').value = cur.next_action_date || '';
    $('oo-lost').value = cur.lost_reason || ''; $('oo-notes').value = cur.notes || '';
    toggleLost();
    const showVal = can('opps.value');
    document.querySelectorAll('.oo-val').forEach(el => el.style.display = showVal ? '' : 'none');
    const editable = can('opps.write') || (!id && can('referrals.create'));
    document.querySelectorAll('#modal-os-opp .oo-edit').forEach(el => { el.disabled = !editable; });
    $('oo-save').style.display = editable ? '' : 'none';
    $('oo-delete').style.display = id && OS.role === 'ceo_admin' ? '' : 'none';
    $('oo-side').style.display = id ? '' : 'none';
    if (id) { renderScores(); loadHistory('opportunity', id, 'oo-history'); loadEntityTasks('opportunity', id, 'oo-tasks'); }
    $('modal-os-opp').style.display = 'flex';
  }
  function fillContacts(companyId, sel) {
    const list = OS.contacts.filter(c => !companyId || c.company_id === companyId);
    $('oo-contact').innerHTML = '<option value="">— none —</option>' + list.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.full_name)}${c.title ? ' — ' + esc(c.title) : ''}</option>`).join('');
  }
  function toggleLost() { $('oo-lost-wrap').style.display = $('oo-stage').value === 'lost' ? '' : 'none'; }
  async function saveOpp() {
    const id = $('oo-id').value, stage = $('oo-stage').value, isOpen = OPEN_STAGES.includes(stage);
    const p = {
      title: $('oo-title').value.trim(), opp_type: $('oo-type').value, stage, owner_id: $('oo-owner').value || null,
      contact_id: $('oo-contact').value || null, expected_close: $('oo-close').value || null, fee_structure: $('oo-fee').value || null,
      next_action: $('oo-next').value.trim() || null, next_action_date: $('oo-next-date').value || null, notes: $('oo-notes').value.trim() || null,
      lost_reason: stage === 'lost' ? ($('oo-lost').value.trim() || null) : null,
    };
    if (can('opps.value')) { p.value = $('oo-value').value === '' ? null : Number($('oo-value').value); p.currency = $('oo-currency').value || 'SGD'; p.probability = $('oo-prob').value === '' ? null : Math.max(0, Math.min(100, +$('oo-prob').value)); }
    if (!p.title) return notify('Give the opportunity a title', 'warn');
    if (stage === 'lost' && !p.lost_reason) return notify('A lost opportunity needs a reason', 'warn');
    if (isOpen && (!p.next_action || !p.next_action_date) && !confirm('This open opportunity has no next action and date, so it will be flagged as stalled. Save anyway?')) return;
    try {
      let companyId = $('oo-company').value;
      if (companyId === '__new') {
        const name = $('oo-company-new').value.trim(); if (!name) return notify('Enter the new company name', 'warn');
        companyId = (await q(OS.sb.from('os_companies').insert({ name, owner_id: p.owner_id || OS.uid }).select().single())).id;
      }
      p.company_id = companyId || null;
      if (id) {
        // keep probability in step with stage unless the user changed it themselves
        const before = OS.opps.find(x => x.id === id) || {};
        if (p.stage !== before.stage && String(p.probability) === String(before.probability)) delete p.probability;
        await q(OS.sb.from('os_opportunities').update(p).eq('id', id));
      } else {
        if (!can('opps.write')) { p.referred_by = OS.uid; p.stage = 'lead'; delete p.owner_id; }
        const row = await q(OS.sb.from('os_opportunities').insert(p).select().single());
        $('oo-id').value = row.id;
      }
      notify(id ? 'Opportunity updated' : 'Opportunity created');
      closeM('modal-os-opp'); await loadOpps(); refreshCurrent();
    } catch (e) { notify('Save failed: ' + e.message, 'warn'); }
  }
  async function deleteOpp() {
    const id = $('oo-id').value; if (!id || !confirm('Delete this opportunity and its history? This cannot be undone.')) return;
    try { await q(OS.sb.from('os_opportunities').delete().eq('id', id)); notify('Deleted'); closeM('modal-os-opp'); await loadOpps(); refreshCurrent(); } catch (e) { notify('Delete failed: ' + e.message, 'warn'); }
  }

  // ── Lead score ────────────────────────────────────────────────────────────
  async function renderScores() {
    const id = $('oo-id').value; if (!id) return;
    let rows = [];
    try { rows = await q(OS.sb.from('os_lead_scores').select('*').eq('opportunity_id', id).order('created_at', { ascending: false })); } catch (e) { rows = []; }
    const appr = rows.find(r => r.status === 'approved'), pend = rows.filter(r => r.status === 'suggested');
    const src = s => ({ ai: 'AI', form_rules: 'Form rules', human: 'Team' }[s] || s);
    const breakdown = r => CRITERIA.map(([k, l, max]) => `<span title="${l}">${l.split(' ')[0]} ${r[k] || 0}/${max}</span>`).join(' · ');
    const total = r => r.final_total != null ? r.final_total : (r.override_total != null ? r.override_total : CRITERIA.reduce((a, [k]) => a + (+r[k] || 0), 0));
    const cls = r => r.classification || classify(total(r));
    $('oo-score').innerHTML = (appr ? `<div class="os-score-cur"><div class="os-score-n" style="--c:${CLASS_COLOR[cls(appr)]}">${total(appr)}<small>/100</small></div><div>${classBadge(cls(appr))}<div style="font-size:11px;color:var(--white-muted);margin-top:4px">Approved ${fmtDate(appr.approved_at)} by ${esc(personName(appr.approved_by))} · ${src(appr.source)}${appr.override_total != null ? ` · <b>override</b> from ${appr.total != null ? appr.total : '—'}: ${esc(appr.override_reason)}` : ''}</div><div class="os-score-bd">${breakdown(appr)}</div></div></div>`
      : '<div class="os-empty" style="padding:10px">No approved score yet.</div>')
      + pend.map(r => `<div class="os-score-pend"><div><b>${total(r)}/100</b> ${classBadge(cls(r))} <span style="font-size:11px;color:var(--white-muted)">suggested by ${src(r.source)} · ${ago(r.created_at)}</span><div class="os-score-bd">${breakdown(r)}</div>${r.rationale ? `<div style="font-size:11px;margin-top:3px">${esc(r.rationale)}</div>` : ''}</div>
        ${can('scores.approve') ? `<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-primary btn-sm" onclick="osScoreStatus('${r.id}','approved')">Approve</button><button class="btn btn-ghost btn-sm" onclick="osScoreStatus('${r.id}','rejected')">Reject</button><button class="btn btn-ghost btn-sm" onclick='osScoreEdit(${JSON.stringify(Object.fromEntries(CRITERIA.map(c => [c[0], r[c[0]] || 0])))})'>Adjust</button></div>` : ''}</div>`).join('');
    $('oo-score-btn').style.display = can('opps.write') ? '' : 'none';
  }
  function scoreEdit(vals) {
    CRITERIA.forEach(([k]) => { const v = vals ? vals[k] || 0 : 0; $('os-sc-' + k).value = v; $('os-sc-' + k).nextElementSibling.value = v; });
    $('os-sc-ovr').checked = false; $('os-sc-ovr-wrap').style.display = 'none'; $('os-sc-ovr-total').value = ''; $('os-sc-reason').value = ''; $('os-sc-rationale').value = '';
    $('os-sc-approve').style.display = can('scores.approve') ? '' : 'none';
    $('os-sc-ovr-row').style.display = can('scores.override') ? '' : 'none';
    scoreTotal(); $('modal-os-score').style.display = 'flex';
  }
  function scoreTotal() {
    const t = CRITERIA.reduce((a, [k]) => a + (+$('os-sc-' + k).value || 0), 0);
    const ov = $('os-sc-ovr').checked && $('os-sc-ovr-total').value !== '' ? Math.max(0, Math.min(100, +$('os-sc-ovr-total').value)) : null;
    const fin = ov != null ? ov : t;
    $('os-sc-total').innerHTML = `<span style="font-size:28px;font-weight:800;color:${CLASS_COLOR[classify(fin)]}">${fin}</span><span style="color:var(--white-muted)">/100</span> ${classBadge(classify(fin))}${ov != null ? `<div style="font-size:11px;color:var(--white-muted)">Calculated ${t} → override ${ov}</div>` : ''}`;
  }
  async function saveScore(approve) {
    const id = $('oo-id').value; if (!id) return;
    const p = { opportunity_id: id, source: 'human', status: approve ? 'approved' : 'suggested', rationale: $('os-sc-rationale').value.trim() || null };
    CRITERIA.forEach(([k]) => { p[k] = +$('os-sc-' + k).value || 0; });
    if ($('os-sc-ovr').checked) {
      if ($('os-sc-ovr-total').value === '') return notify('Enter the override score', 'warn');
      const reason = $('os-sc-reason').value.trim(); if (reason.length < 10) return notify('An override needs a reason (at least 10 characters)', 'warn');
      p.override_total = Math.max(0, Math.min(100, +$('os-sc-ovr-total').value)); p.override_reason = reason;
    }
    try { await q(OS.sb.from('os_lead_scores').insert(p)); notify(approve ? 'Score approved' : 'Score saved as a suggestion'); closeM('modal-os-score'); await afterScore(id); }
    catch (e) { notify('Score not saved: ' + e.message, 'warn'); }
  }
  async function scoreStatus(sid, status) {
    try { await q(OS.sb.from('os_lead_scores').update({ status }).eq('id', sid)); notify(status === 'approved' ? 'Score approved' : 'Suggestion rejected'); await afterScore($('oo-id').value); }
    catch (e) { notify('Failed: ' + e.message, 'warn'); }
  }
  async function afterScore(id) {
    await loadOpps(); const o = OS.opps.find(x => x.id === id);
    if (o) $('oo-sub').innerHTML = `${classBadge(o.score_class)} ${flagChips(o)}`;
    renderScores(); loadHistory('opportunity', id, 'oo-history'); refreshCurrent(true);
  }

  // ── History & notes ───────────────────────────────────────────────────────
  async function loadHistory(type, id, el) {
    let rows = []; try { rows = await q(OS.sb.from('os_activity').select('*').eq('entity_type', type).eq('entity_id', id).order('created_at', { ascending: false }).limit(100)); } catch (e) { }
    const ic = { note: 'sticky_note_2', call: 'call', email: 'mail', meeting: 'groups', change: 'edit', score: 'rule', system: 'add_circle' };
    $(el).innerHTML = rows.length ? rows.map(r => `<div class="os-h"><span class="material-symbols-outlined">${ic[r.kind] || 'circle'}</span><div><div style="font-size:12px;color:var(--ink)">${esc(r.body || r.kind)}</div><div style="font-size:11px;color:var(--white-muted)">${esc(personName(r.actor_id))} · ${new Date(r.created_at).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div></div>`).join('') : '<div class="os-empty" style="padding:10px">No history yet.</div>';
  }
  async function addNote(type, idEl, kindEl, bodyEl, histEl) {
    const id = $(idEl).value, body = $(bodyEl).value.trim(); if (!id || !body) return;
    try { await q(OS.sb.from('os_activity').insert({ entity_type: type, entity_id: id, kind: $(kindEl).value, body, actor_id: OS.uid })); $(bodyEl).value = ''; loadHistory(type, id, histEl); }
    catch (e) { notify('Not saved: ' + e.message, 'warn'); }
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  function taskRow(x) {
    const od = x.status === 'open' && x.due_date && x.due_date < today(), dueToday = x.status === 'open' && x.due_date === today();
    const link = x.entity_type === 'opportunity' ? `osOpenOpp('${x.entity_id}')` : x.entity_type === 'company' ? `osOpenCompany('${x.entity_id}')` : x.entity_type === 'contact' ? `osOpenContact('${x.entity_id}')` : '';
    const rel = x.entity_type === 'opportunity' ? (OS.opps.find(o => o.id === x.entity_id) || {}).title : x.entity_type === 'company' ? (OS.companies.find(c => c.id === x.entity_id) || {}).name : '';
    return `<div class="os-task${x.status !== 'open' ? ' done' : ''}"><input type="checkbox" ${x.status === 'done' ? 'checked' : ''} onchange="osTaskDone('${x.id}',this.checked)" title="Mark done"/>
      <div style="flex:1;min-width:0;cursor:pointer" onclick="osOpenTask('${x.id}')"><div style="font-size:13px;color:var(--ink);font-weight:600">${esc(x.title)}</div>
      <div style="font-size:11px;color:var(--white-muted)">${rel ? `<a onclick="event.stopPropagation();${link}" style="color:var(--emerald);cursor:pointer">${esc(rel)}</a> · ` : ''}${esc(personName(x.assignee_id))}${x.priority === 'high' ? ' · <b style="color:#b3261e">High</b>' : ''}</div></div>
      <div style="font-size:11px;white-space:nowrap;font-weight:700;color:${od ? '#b3261e' : dueToday ? '#7a5c00' : 'var(--white-muted)'}">${x.due_date ? (od ? 'Overdue · ' : dueToday ? 'Today · ' : '') + fmtDate(x.due_date) : 'No date'}</div></div>`;
  }
  const loadTasksPanel = safe(async function () { await Promise.all([loadTasks(), loadOpps().catch(() => []), loadCompanies().catch(() => [])]); renderTasks(); });
  function renderTasks() {
    const tab = OS.taskTab, t = today();
    let rows = OS.tasks.filter(x => tab === 'done' ? x.status !== 'open' : x.status === 'open');
    if (tab === 'mine') rows = rows.filter(x => x.assignee_id === OS.uid || (!x.assignee_id && x.created_by === OS.uid));
    $('os-t-tabs').innerHTML = [['mine', 'My open tasks'], ['all', 'All open'], ['done', 'Completed']].filter(([k]) => k !== 'all' || can('tasks.read_all'))
      .map(([k, l]) => `<button class="s-tab${tab === k ? ' active' : ''}" onclick="osTaskTab('${k}')">${l}</button>`).join('');
    const groups = tab === 'done' ? [['Completed', rows]] : [['Overdue', rows.filter(x => x.due_date && x.due_date < t)], ['Today', rows.filter(x => x.due_date === t)], ['Upcoming', rows.filter(x => x.due_date && x.due_date > t)], ['No date', rows.filter(x => !x.due_date)]];
    $('os-t-body').innerHTML = groups.filter(g => g[1].length).map(([l, r]) => `<div class="os-t-group">${l} <span>${r.length}</span></div>${r.map(taskRow).join('')}`).join('') || '<div class="os-empty">No tasks here.</div>';
  }
  async function loadEntityTasks(type, id, el) {
    let rows = []; try { rows = await q(OS.sb.from('os_tasks').select('*').eq('entity_type', type).eq('entity_id', id).order('due_date', { ascending: true })); } catch (e) { }
    $(el).innerHTML = (rows.filter(x => x.status === 'open').map(taskRow).join('') || '<div class="os-empty" style="padding:8px">No open tasks.</div>')
      + `<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="osNewTask('${type}','${id}')"><span class="material-symbols-outlined" style="font-size:15px">add_task</span>Add task</button>`;
  }
  function openTask(id, preset) {
    const x = id ? OS.tasks.find(t => t.id === id) || {} : Object.assign({ priority: 'normal', assignee_id: OS.uid, due_date: addDays(1) }, preset || {});
    $('ot-id').value = id || ''; $('ot-title').value = x.title || ''; $('ot-due').value = x.due_date || ''; $('ot-priority').value = x.priority || 'normal';
    $('ot-assignee').innerHTML = ownerOptions(x.assignee_id); $('ot-notes').value = x.notes || ''; $('ot-status').value = x.status || 'open';
    $('ot-entity').value = JSON.stringify({ t: x.entity_type || null, i: x.entity_id || null });
    $('ot-h').textContent = id ? 'Edit task' : 'New task';
    $('modal-os-task').style.display = 'flex';
  }
  async function saveTask() {
    const id = $('ot-id').value, ent = JSON.parse($('ot-entity').value || '{}');
    const p = { title: $('ot-title').value.trim(), due_date: $('ot-due').value || null, priority: $('ot-priority').value, assignee_id: $('ot-assignee').value || null, notes: $('ot-notes').value.trim() || null, status: $('ot-status').value };
    if (!p.title) return notify('Task needs a title', 'warn');
    if (!id) { p.entity_type = ent.t; p.entity_id = ent.i; }
    try {
      if (id) await q(OS.sb.from('os_tasks').update(p).eq('id', id)); else await q(OS.sb.from('os_tasks').insert(p));
      // a dated task on an opportunity with no next action becomes its next action
      if (!id && ent.t === 'opportunity' && p.due_date) {
        const o = OS.opps.find(x => x.id === ent.i);
        if (o && can('opps.write') && (!o.next_action || !o.next_action_date)) await q(OS.sb.from('os_opportunities').update({ next_action: p.title, next_action_date: p.due_date }).eq('id', ent.i));
      }
      notify('Task saved'); closeM('modal-os-task'); await loadTasks();
      if (ent.t && $('modal-os-opp').style.display === 'flex') loadEntityTasks(ent.t, ent.i, 'oo-tasks');
      if (ent.t === 'company' && $('modal-os-company').style.display === 'flex') loadEntityTasks('company', ent.i, 'oc-tasks');
      refreshCurrent(true);
    } catch (e) { notify('Task not saved: ' + e.message, 'warn'); }
  }
  async function taskDone(id, done) {
    try { await q(OS.sb.from('os_tasks').update({ status: done ? 'done' : 'open' }).eq('id', id)); await loadTasks();
      const t = OS.tasks.find(x => x.id === id);
      if (done && t && t.entity_type === 'opportunity') notify('Done — set the next action on the opportunity so it does not stall', 'success'); else notify(done ? 'Task completed' : 'Task reopened');
      refreshCurrent(true);
      if ($('modal-os-opp').style.display === 'flex' && t) loadEntityTasks(t.entity_type, t.entity_id, 'oo-tasks');
    } catch (e) { notify('Failed: ' + e.message, 'warn'); }
  }

  // ── Companies & contacts ──────────────────────────────────────────────────
  const companyFlags = c => c.status === 'active' && (!String(c.next_action || '').trim() || !c.next_action_date) ? '<span class="os-flag">No next action</span>' : c.status === 'active' && c.next_action_date && c.next_action_date < today() ? '<span class="os-flag">Overdue</span>' : '';
  const loadCompaniesPanel = safe(async function () { await Promise.all([loadCompanies(), loadOpps().catch(() => []), loadContacts().catch(() => [])]); renderCompanies(); });
  function renderCompanies() {
    const s = ($('os-c-search').value || '').toLowerCase(), rel = $('os-c-rel-f').value;
    const rows = OS.companies.filter(c => (!s || [c.name, c.country, (c.sectors || []).join(' '), (c.industries || []).join(' '), c.notes].join(' ').toLowerCase().includes(s)) && (!rel || c.relationship === rel));
    $('os-c-count').textContent = `${rows.length} companies`;
    $('os-c-body').innerHTML = rows.length ? `<div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Company</th><th>Relationship</th><th>Industry</th><th>Open opportunities</th><th>Next action</th><th>Owner</th></tr></thead><tbody>${rows.map(c => {
      const op = OS.opps.filter(o => o.company_id === c.id && statusOf(o) === 'open');
      return `<tr style="cursor:pointer" onclick="osOpenCompany('${c.id}')"><td><div style="font-weight:600;color:var(--ink)">${esc(c.name)}</div><div style="font-size:11px;color:var(--white-muted)">${esc(c.country || '')}${c.status !== 'active' ? ' · ' + esc(c.status) : ''}</div>${companyFlags(c)}</td>
        <td style="font-size:12px;text-transform:capitalize">${esc(String(c.relationship || '').replace(/_/g, ' '))}</td><td style="font-size:12px">${esc((c.industries || []).join(', ') || '—')}</td>
        <td style="font-size:12px">${op.length}${can('opps.value') && op.length ? ' · ' + money(op.reduce((a, o) => a + (+o.value || 0), 0)) : ''}</td>
        <td style="font-size:12px">${esc(c.next_action || '—')}<div style="font-size:11px;color:var(--white-muted)">${fmtDate(c.next_action_date)}</div></td><td style="font-size:12px">${esc(personName(c.owner_id))}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="os-empty">No companies yet. They are created from enquiries, opportunities or here.</div>';
  }
  async function openCompany(id) {
    if (!OS.contacts.length) await loadContacts().catch(() => {});
    const c = id ? OS.companies.find(x => x.id === id) || (await q(OS.sb.from('os_companies').select('*').eq('id', id)))[0] || {} : { relationship: 'prospect', status: 'active', owner_id: OS.uid };
    $('oc-id').value = id || ''; $('oc-h').textContent = id ? c.name : 'New company';
    ['name', 'website', 'country', 'stage', 'revenue_band', 'next_action', 'notes'].forEach(k => { $('oc-' + k).value = c[k] || ''; });
    $('oc-next_action_date').value = c.next_action_date || ''; $('oc-sectors').value = (c.sectors || []).join(', ');
    $('oc-relationship').value = c.relationship || 'prospect'; $('oc-status').value = c.status || 'active'; $('oc-owner').innerHTML = ownerOptions(c.owner_id);
    $('oc-industries').textContent = (c.industries || []).join(' · ') || 'Set automatically from sectors';
    $('oc-side').style.display = id ? '' : 'none';
    if (id) {
      $('oc-contacts').innerHTML = OS.contacts.filter(x => x.company_id === id).map(x => `<div class="os-mini" onclick="osOpenContact('${x.id}')"><b>${esc(x.full_name)}</b>${x.is_decision_maker ? ' <span class="os-flag os-flag-info">Decision maker</span>' : ''}<div>${esc(x.title || '')}${x.email ? ' · ' + esc(x.email) : ''}</div></div>`).join('') + `<button class="btn btn-ghost btn-sm" onclick="osOpenContact(null,'${id}')">+ Contact</button>`;
      $('oc-opps').innerHTML = OS.opps.filter(o => o.company_id === id).map(o => `<div class="os-mini" onclick="closeModal('modal-os-company');osOpenOpp('${o.id}')"><b>${esc(o.title)}</b> ${classBadge(o.score_class)}<div>${esc(stageLabel(o.stage))}${can('opps.value') && o.value != null ? ' · ' + money(o.value, o.currency) : ''}</div></div>`).join('') + `<button class="btn btn-ghost btn-sm" onclick="closeModal('modal-os-company');osOpenOpp(null,{company_id:'${id}'})">+ Opportunity</button>`;
      loadHistory('company', id, 'oc-history'); loadEntityTasks('company', id, 'oc-tasks');
    }
    $('oc-save').style.display = can('companies.write') || can('opps.write') ? '' : 'none';
    $('modal-os-company').style.display = 'flex';
  }
  async function saveCompany() {
    const id = $('oc-id').value;
    const p = { name: $('oc-name').value.trim(), website: $('oc-website').value.trim() || null, country: $('oc-country').value.trim() || null, stage: $('oc-stage').value.trim() || null,
      revenue_band: $('oc-revenue_band').value.trim() || null, relationship: $('oc-relationship').value, status: $('oc-status').value, owner_id: $('oc-owner').value || null,
      next_action: $('oc-next_action').value.trim() || null, next_action_date: $('oc-next_action_date').value || null, notes: $('oc-notes').value.trim() || null,
      sectors: $('oc-sectors').value.split(/[,;]/).map(x => x.trim()).filter(Boolean) };
    if (!p.name) return notify('Company name required', 'warn');
    if (typeof normSectors === 'function') p.sectors = normSectors(p.sectors.join(';'));
    try { if (id) await q(OS.sb.from('os_companies').update(p).eq('id', id)); else await q(OS.sb.from('os_companies').insert(p)); notify('Company saved'); closeM('modal-os-company'); await loadCompanies(); refreshCurrent(true); }
    catch (e) { notify('Save failed: ' + e.message, 'warn'); }
  }
  const loadContactsPanel = safe(async function () { await Promise.all([loadContacts(), loadCompanies().catch(() => [])]); renderContacts(); });
  function renderContacts() {
    const s = ($('os-ct-search').value || '').toLowerCase();
    const rows = OS.contacts.filter(c => !s || [c.full_name, c.title, c.email, c.phone, (OS.companies.find(x => x.id === c.company_id) || {}).name].join(' ').toLowerCase().includes(s));
    $('os-ct-count').textContent = `${rows.length} contacts`;
    $('os-ct-body').innerHTML = rows.length ? `<div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Contact</th><th>Company</th><th>Contact details</th><th>Next action</th><th>Owner</th></tr></thead><tbody>${rows.map(c => `<tr style="cursor:pointer" onclick="osOpenContact('${c.id}')">
      <td><div style="font-weight:600;color:var(--ink)">${esc(c.full_name)}</div><div style="font-size:11px;color:var(--white-muted)">${esc(c.title || '')}</div>${c.is_decision_maker ? '<span class="os-flag os-flag-info">Decision maker</span>' : ''}${companyFlags(c)}</td>
      <td style="font-size:12px">${esc((OS.companies.find(x => x.id === c.company_id) || {}).name || '—')}</td>
      <td style="font-size:12px">${c.email ? `<a href="mailto:${esc(c.email)}" onclick="event.stopPropagation()" style="color:var(--emerald)">${esc(c.email)}</a>` : ''}${c.phone ? `<div>${esc(c.phone)}</div>` : ''}</td>
      <td style="font-size:12px">${esc(c.next_action || '—')}<div style="font-size:11px;color:var(--white-muted)">${fmtDate(c.next_action_date)}</div></td><td style="font-size:12px">${esc(personName(c.owner_id))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="os-empty">No contacts yet.</div>';
  }
  async function openContact(id, companyId) {
    if (!OS.companies.length) await loadCompanies().catch(() => {});
    const c = id ? OS.contacts.find(x => x.id === id) || {} : { company_id: companyId || null, status: 'active', owner_id: OS.uid };
    $('ocn-id').value = id || ''; $('ocn-h').textContent = id ? c.full_name : 'New contact';
    ['full_name', 'title', 'email', 'phone', 'linkedin_url', 'next_action', 'notes'].forEach(k => { $('ocn-' + k).value = c[k] || ''; });
    $('ocn-next_action_date').value = c.next_action_date || ''; $('ocn-dm').checked = !!c.is_decision_maker; $('ocn-status').value = c.status || 'active';
    $('ocn-company').innerHTML = '<option value="">— none —</option>' + OS.companies.map(x => `<option value="${x.id}" ${x.id === c.company_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    $('ocn-owner').innerHTML = ownerOptions(c.owner_id);
    $('modal-os-contact').style.display = 'flex';
  }
  async function saveContact() {
    const id = $('ocn-id').value;
    const p = { full_name: $('ocn-full_name').value.trim(), title: $('ocn-title').value.trim() || null, email: $('ocn-email').value.trim().toLowerCase() || null, phone: $('ocn-phone').value.trim() || null,
      linkedin_url: $('ocn-linkedin_url').value.trim() || null, company_id: $('ocn-company').value || null, owner_id: $('ocn-owner').value || null, status: $('ocn-status').value,
      is_decision_maker: $('ocn-dm').checked, next_action: $('ocn-next_action').value.trim() || null, next_action_date: $('ocn-next_action_date').value || null, notes: $('ocn-notes').value.trim() || null };
    if (!p.full_name) return notify('Name required', 'warn');
    try { if (id) await q(OS.sb.from('os_contacts').update(p).eq('id', id)); else await q(OS.sb.from('os_contacts').insert(p)); notify('Contact saved'); closeM('modal-os-contact'); await loadContacts(); refreshCurrent(true);
      if ($('modal-os-company').style.display === 'flex' && p.company_id) openCompany(p.company_id); }
    catch (e) { notify('Save failed: ' + e.message, 'warn'); }
  }

  // ── Roles & access ────────────────────────────────────────────────────────
  const PERM_LABELS = [['opps.read_all', 'See all opportunities'], ['opps.write', 'Work opportunities'], ['opps.value', 'See deal values'], ['scores.approve', 'Approve lead scores'], ['scores.override', 'Override scores'],
    ['companies.read_all', 'See all companies'], ['contacts.read_all', 'See all contacts'], ['tasks.read_all', 'See all tasks'], ['investors.read', 'Investor directory (non-sensitive)'], ['finance.write', 'Contracts & invoices'],
    ['campaigns.write', 'Campaigns & events'], ['ai.review', 'AI work queue'], ['referrals.create', 'Submit referrals'], ['settings.manage', 'Manage roles & settings']];
  const loadRoles = safe(async function () {
    await loadPeople();
    let perms = []; try { perms = await q(OS.sb.from('os_role_permissions').select('*')); } catch (e) { }
    const has = (r, p) => perms.some(x => x.role === r && (x.perm === p || x.perm === '*'));
    $('os-r-matrix').innerHTML = `<div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Permission</th>${ROLES.map(r => `<th style="text-align:center">${r[1]}</th>`).join('')}</tr></thead><tbody>${PERM_LABELS.map(([p, l]) => `<tr><td style="font-size:12px">${l}</td>${ROLES.map(r => `<td style="text-align:center;color:${has(r[0], p) ? 'var(--emerald)' : 'var(--white-ghost)'}">${has(r[0], p) ? '●' : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div style="font-size:11px;color:var(--white-muted);margin-top:8px">Partner / Agent users only see records they referred. Advisors only see opportunities they own or are on the team for. Investor records stay CEO-only until the Investors module moves to the OS in Phase 2.</div>`;
    $('os-r-staff').innerHTML = OS.people.length ? OS.people.map(p => { const s = OS.staff.find(x => x.user_id === p.id);
      return `<div class="os-mini" style="display:flex;justify-content:space-between;align-items:center;cursor:default"><div><b>${esc(p.full_name || p.email)}</b><div>${esc(p.email || '')} · ${esc(roleLabel(p.os_role))}</div></div>${p.role === 'admin' ? '<span style="font-size:11px;color:var(--white-muted)">Account owner</span>' : s ? `<button class="btn btn-ghost btn-sm" onclick="osStaffRemove('${p.id}')">Remove access</button>` : ''}</div>`; }).join('') : '<div class="os-empty">Only you so far.</div>';
  });
  async function staffAdd() {
    const email = $('osr-email').value.trim().toLowerCase(), role = $('osr-role').value; if (!email) return;
    try {
      const u = (await q(OS.sb.from('users').select('id,email,full_name,status').eq('email', email)))[0];
      if (!u) return notify('No account with that email yet — ask them to sign up first, then add them here', 'warn');
      await q(OS.sb.from('os_staff').upsert({ user_id: u.id, role, active: true }, { onConflict: 'user_id' }));
      notify(`${u.full_name || u.email} added as ${roleLabel(role)}`); $('osr-email').value = ''; loadRoles();
    } catch (e) { notify('Could not add: ' + e.message, 'warn'); }
  }
  async function staffRemove(uid) { if (!confirm('Remove this person\'s access to the Commercial OS?')) return; try { await q(OS.sb.from('os_staff').update({ active: false }).eq('user_id', uid)); notify('Access removed'); loadRoles(); } catch (e) { notify('Failed: ' + e.message, 'warn'); } }

  // ── Enquiry → opportunity (with a form-rules score suggestion) ───────────
  function suggestFromEnquiry(e) {
    const d = e.data || {}, has = (v, re) => re.test(String(v || ''));
    const focus = String(d.focus || e.service || ''), markets = String(d.markets || '');
    const role = d.role || e.title || '';
    const s = {
      strategic_fit: e.source === 'capital_review' ? 12 : focus ? Math.min(15, 9 + (has(focus, /singapore|asean|gtm|partnership|capital|advisory|portfolio/i) ? 4 : 0) + (has(markets, /singapore|malaysia|indonesia|vietnam|thailand|philippines/i) ? 2 : 0)) : 6,
      budget: has(d.advisory_budget || d.budget, /^budget allocated/i) ? 15 : has(d.advisory_budget || d.budget, /^budget planned/i) ? 9 : has(d.advisory_budget, /^success/i) ? 5 : e.source === 'capital_review' ? (has(d.revenue_band, /SGD (1|5)|Above/) ? 8 : 4) : 2,
      urgency: has(d.timeline || d.raise_timeline, /raising now|within 3/i) ? 15 : has(d.timeline || d.raise_timeline, /3–6|3-6/) ? 10 : has(d.timeline || d.raise_timeline, /6–12|6-12/) ? 5 : 1,
      decision_maker: has(role, /founder|ceo|c-suite|cfo|managing|director|partner|chief|head/i) ? (has(role, /head/i) && !has(role, /founder|ceo|chief/i) ? 6 : 10) : 3,
      market_expansion: has(focus, /singapore|asean/i) || markets ? 9 : 3,
      gtm_need: has(focus, /gtm|go-to-market|partnership|distribution/i) ? 9 : 3,
      capital_readiness: e.source === 'capital_review' ? Math.min(10, (has(d.deck_status, /ready/i) ? 4 : has(d.deck_status, /draft/i) ? 2 : 0) + (has(d.revenue_band, /SGD (1|5)|Above/) ? 3 : 0) + (has(d.prior_funding, /institutional|series/i) ? 3 : 0)) : has(focus, /capital/i) ? 4 : 1,
      commercial_potential: has(d.revenue_band, /Above/) ? 10 : has(d.revenue_band, /SGD 5/) ? 8 : has(d.revenue_band, /SGD 1/) ? 6 : has(d.revenue_band, /Under/) ? 3 : has(d.company_stage, /Corporate|Established/) ? 7 : 2,
      network_relevance: has(markets + focus, /singapore|asean|southeast/i) ? 5 : 3,
    };
    return s;
  }
  async function enquiryToOpp(enquiryId) {
    const e = (typeof enquiries_db !== 'undefined' ? enquiries_db : []).find(x => x.id === enquiryId); if (!e) return;
    if (!can('opps.write')) return notify('Your role cannot create opportunities', 'warn');
    const d = e.data || {}, kind = e.source || e.type;
    const type = kind === 'capital_review' ? 'capital_readiness' : kind === 'partnership_enquiry' || e.type === 'partner' ? 'partnership' : kind === 'investor_network' || e.type === 'investor' ? 'investor_introduction'
      : /portfolio/i.test(d.focus || '') ? 'portfolio_retainer' : /singapore|asean|gtm|partnership/i.test(d.focus || e.service || '') ? 'market_entry' : 'advisory_mandate';
    try {
      await loadCompanies(); await loadContacts();
      const companyName = e.company || d.organisation || d.company || (e.email ? e.email.split('@')[1] : null) || e.name;
      let co = OS.companies.find(c => c.name.toLowerCase() === String(companyName).toLowerCase());
      if (!co) co = await q(OS.sb.from('os_companies').insert({ name: companyName, website: d.website || null, country: d.hq_country || d.based_in || null, stage: d.company_stage || d.round || null, revenue_band: d.revenue_band || null,
        sectors: [d.industry, d.sector].filter(Boolean), relationship: type === 'partnership' ? 'partner' : type === 'investor_introduction' ? 'investor_org' : 'prospect', owner_id: OS.uid, source: 'enquiry:' + e.id }).select().single());
      let ct = OS.contacts.find(c => e.email && c.email === String(e.email).toLowerCase());
      if (!ct) ct = await q(OS.sb.from('os_contacts').insert({ company_id: co.id, full_name: e.name || e.email, title: e.title || d.role || null, email: (e.email || '').toLowerCase() || null, phone: e.phone || null,
        linkedin_url: d.linkedin_url || null, is_decision_maker: /founder|ceo|chief|managing|cfo|c-suite|partner/i.test(e.title || d.role || ''), owner_id: OS.uid, source: 'enquiry:' + e.id }).select().single());
      const opp = await q(OS.sb.from('os_opportunities').insert({ title: `${co.name} — ${typeLabel(type)}`, company_id: co.id, contact_id: ct.id, opp_type: type, stage: 'lead', owner_id: OS.uid,
        next_action: 'Reply to enquiry' + (d.reference || '' ? ` (${d.reference})` : ''), next_action_date: addDays(2), source: e.source || 'enquiry', enquiry_id: e.id,
        notes: (e.message || '').slice(0, 4000) }).select().single());
      if (type !== 'investor_introduction') await q(OS.sb.from('os_lead_scores').insert(Object.assign({ opportunity_id: opp.id, source: 'form_rules', status: 'suggested', rationale: 'Suggested from the website form answers — review before approving.' }, suggestFromEnquiry(e))));
      await q(OS.sb.from('os_tasks').insert({ title: 'Reply to enquiry', entity_type: 'opportunity', entity_id: opp.id, assignee_id: OS.uid, due_date: addDays(2), priority: 'high', status: 'open' }));
      if (typeof setEnquiryStatus === 'function' && (e.status || 'new') === 'new') await setEnquiryStatus(e.id, 'in_progress', true);
      notify('Opportunity created — review the suggested score'); if (typeof closeModal === 'function') closeModal('modal-enquiry');
      await loadOpps(); nav('os-opps'); openOpp(opp.id);
    } catch (err) { notify('Could not create opportunity: ' + err.message, 'warn'); }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  const LOADERS = { 'os-dashboard': loadDash, 'os-opps': loadOppsPanel, 'os-companies': loadCompaniesPanel, 'os-contacts': loadContactsPanel, 'os-tasks': loadTasksPanel, 'os-roles': loadRoles };
  let current = 'os-dashboard';
  function refreshCurrent(soft) { const p = (typeof currentPanel !== 'undefined' && currentPanel) || current; if (p === 'os-dashboard') loadDash(); else if (p === 'os-opps') renderOpps(); else if (p === 'os-companies') (soft ? renderCompanies : loadCompaniesPanel)(); else if (p === 'os-contacts') renderContacts(); else if (p === 'os-tasks') loadTasksPanel(); }
  function closeM(id) { if (typeof closeModal === 'function') closeModal(id); else $(id).style.display = 'none'; }
  const origLoadPanel = window.loadPanel;
  window.loadPanel = function (p) { current = p; if (LOADERS[p]) return LOADERS[p](); return origLoadPanel && origLoadPanel(p); };
  let started = false;
  async function startOS() {
    if (started) return; started = true;
    try { await osInit(); window.nav('os-dashboard'); } catch (e) { console.error('[OS] init failed', e); }
  }
  const origEnter = window.enterOS;
  window.enterOS = async function () {
    let r; try { r = origEnter ? await origEnter.apply(this, arguments) : undefined; } catch (e) { console.error('[OS] legacy init error', e); }
    await startOS(); return r;
  };
  // the admin boot can finish before this file loads — start straight away in that case
  const shell = document.getElementById('os-shell');
  if (shell && shell.style.display === 'flex') startOS();
  Object.assign(window, {
    osOpenOpp: openOpp, osSaveOpp: saveOpp, osDeleteOpp: deleteOpp, osDrop: dropStage, osToggleLost: toggleLost, osFillContacts: fillContacts,
    osScoreEdit: scoreEdit, osScoreTotal: scoreTotal, osSaveScore: saveScore, osScoreStatus: scoreStatus,
    osAddNote: addNote, osNewTask: (t, i) => openTask(null, { entity_type: t, entity_id: i }), osOpenTask: openTask, osSaveTask: saveTask, osTaskDone: taskDone,
    osTaskTab: k => { OS.taskTab = k; renderTasks(); }, osRenderOpps: renderOpps, osOppView: () => { OS.view = OS.view === 'board' ? 'table' : 'board'; renderOpps(); },
    osOppFilter: s => { window.nav('os-opps'); setTimeout(() => { $('os-o-stage-f').value = s || 'open'; renderOpps(); }, 50); },
    osOpenCompany: openCompany, osSaveCompany: saveCompany, osRenderCompanies: renderCompanies, osOpenContact: openContact, osSaveContact: saveContact, osRenderContacts: renderContacts,
    osStaffAdd: staffAdd, osStaffRemove: staffRemove, osEnquiryToOpp: enquiryToOpp, osSuggestFromEnquiry: suggestFromEnquiry, __OS: OS, osFlags: flags,
  });

  // ── Markup ────────────────────────────────────────────────────────────────
  const PANELS = `
  <div id="panel-os-dashboard" class="panel">
    <div class="page-header"><div><div class="page-title">Revenue Dashboard</div><div class="page-sub">Relationships turning into mandates, projects, retainers and fees</div></div>
      <div style="display:flex;gap:8px"><button class="btn btn-ghost" onclick="osNewTask(null,null)"><span class="material-symbols-outlined" style="font-size:15px">add_task</span>Task</button>
      <button class="btn btn-primary" data-os-perm="opps.write|referrals.create" onclick="osOpenOpp(null)"><span class="material-symbols-outlined" style="font-size:15px">add</span>Opportunity</button></div></div>
    <div id="os-kpis" class="os-kpis"></div>
    <div class="os-dash-grid">
      <div class="card"><div class="card-header"><div><div class="card-title">Priority A <span class="os-count" id="os-dash-n-a">0</span></div><div class="card-sub">Score 80–100 · work these first</div></div></div><div id="os-dash-a"></div></div>
      <div class="card"><div class="card-header"><div><div class="card-title">Priority B <span class="os-count" id="os-dash-n-b">0</span></div><div class="card-sub">Score 60–79</div></div></div><div id="os-dash-b"></div></div>
      <div class="card os-card-alert"><div class="card-header"><div><div class="card-title">Stalled opportunities <span class="os-count" id="os-dash-n-stalled">0</span></div><div class="card-sub">No next action or date, overdue, no owner, or no activity in 14 days</div></div></div><div id="os-dash-stalled"></div></div>
      <div class="card"><div class="card-header"><div><div class="card-title">Disqualified <span class="os-count" id="os-dash-n-dq">0</span></div><div class="card-sub">Score below 40 — self-service or decline</div></div></div><div id="os-dash-dq"></div></div>
      <div class="card"><div class="card-header"><div><div class="card-title">Open pipeline by stage</div><div class="card-sub" data-os-perm="opps.value">Unweighted value</div></div></div><div class="card-body" id="os-dash-pipe"></div></div>
      <div class="card"><div class="card-header"><div><div class="card-title">My next actions</div><div class="card-sub">Open tasks assigned to you</div></div><button class="btn btn-ghost btn-sm" onclick="nav('os-tasks')">All tasks</button></div><div style="padding:6px 14px 14px" id="os-dash-tasks"></div></div>
    </div>
  </div>
  <div id="panel-os-opps" class="panel">
    <div class="page-header"><div><div class="page-title">Sales Opportunities</div><div class="page-sub">Advisory mandates, market-entry and capital-readiness projects, partnerships, retainers, introductions and success fees</div></div>
      <div style="display:flex;gap:8px"><button class="btn btn-ghost" id="os-o-view" onclick="osOppView()">Table view</button><button class="btn btn-primary" data-os-perm="opps.write|referrals.create" onclick="osOpenOpp(null)"><span class="material-symbols-outlined" style="font-size:15px">add</span>New opportunity</button></div></div>
    <div class="filter-bar" style="flex-wrap:wrap">
      <input class="f-input" id="os-o-search" placeholder="Search title, company, contact…" style="max-width:260px" oninput="osRenderOpps()"/>
      <select class="f-input f-select" id="os-o-stage-f" style="width:150px" onchange="osRenderOpps()"></select>
      <select class="f-input f-select" id="os-o-type-f" style="width:200px" onchange="osRenderOpps()"></select>
      <select class="f-input f-select" id="os-o-class-f" style="width:170px" onchange="osRenderOpps()"></select>
      <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="os-o-mine" onchange="osRenderOpps()"/>Mine</label>
      <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="os-o-stalled" onchange="osRenderOpps()"/>Stalled only</label>
      <span id="os-o-count" style="font-size:12px;color:var(--white-muted);margin-left:auto"></span></div>
    <div id="os-o-body"></div>
  </div>
  <div id="panel-os-companies" class="panel">
    <div class="page-header"><div><div class="page-title">Companies</div><div class="page-sub">Prospects, clients, partners and investor organisations</div></div>
      <button class="btn btn-primary" data-os-perm="companies.write|opps.write" onclick="osOpenCompany(null)"><span class="material-symbols-outlined" style="font-size:15px">add</span>New company</button></div>
    <div class="filter-bar"><input class="f-input" id="os-c-search" placeholder="Search name, country, sector…" style="max-width:280px" oninput="osRenderCompanies()"/>
      <select class="f-input f-select" id="os-c-rel-f" style="width:170px" onchange="osRenderCompanies()"><option value="">All relationships</option><option value="prospect">Prospect</option><option value="client">Client</option><option value="former_client">Former client</option><option value="partner">Partner</option><option value="investor_org">Investor organisation</option><option value="other">Other</option></select>
      <span id="os-c-count" style="font-size:12px;color:var(--white-muted);margin-left:auto"></span></div>
    <div class="card" id="os-c-body"></div>
  </div>
  <div id="panel-os-contacts" class="panel">
    <div class="page-header"><div><div class="page-title">Contacts</div><div class="page-sub">People — with owner, status and next action</div></div>
      <button class="btn btn-primary" data-os-perm="contacts.write|opps.write" onclick="osOpenContact(null)"><span class="material-symbols-outlined" style="font-size:15px">person_add</span>New contact</button></div>
    <div class="filter-bar"><input class="f-input" id="os-ct-search" placeholder="Search name, company, email…" style="max-width:280px" oninput="osRenderContacts()"/><span id="os-ct-count" style="font-size:12px;color:var(--white-muted);margin-left:auto"></span></div>
    <div class="card" id="os-ct-body"></div>
  </div>
  <div id="panel-os-tasks" class="panel">
    <div class="page-header"><div><div class="page-title">Tasks</div><div class="page-sub">Follow-ups so nothing depends on memory</div></div>
      <button class="btn btn-primary" onclick="osNewTask(null,null)"><span class="material-symbols-outlined" style="font-size:15px">add_task</span>New task</button></div>
    <div class="s-tabs" id="os-t-tabs" style="margin-bottom:12px"></div>
    <div class="card" style="padding:8px 16px 16px" id="os-t-body"></div>
  </div>
  <div id="panel-os-roles" class="panel">
    <div class="page-header"><div><div class="page-title">Roles &amp; Access</div><div class="page-sub">Least privilege — people only see what their role needs</div></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-header"><div><div class="card-title">Team</div><div class="card-sub">Add someone who already has a BANAHUB account</div></div></div>
      <div class="card-body"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><input class="f-input" id="osr-email" placeholder="their@email.com" style="max-width:260px"/><select class="f-input f-select" id="osr-role" style="width:220px"></select><button class="btn btn-primary" onclick="osStaffAdd()">Give access</button></div><div id="os-r-staff"></div></div></div>
    <div class="card"><div class="card-header"><div><div class="card-title">Permissions by role</div><div class="card-sub">Enforced in the database, not just hidden in the interface</div></div></div><div class="card-body" id="os-r-matrix"></div></div>
  </div>`;

  const MODALS = `
  <div id="modal-os-opp" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('modal-os-opp')">
    <div class="modal modal-lg" style="max-width:1100px">
      <div class="modal-header"><div style="min-width:0"><div class="modal-title" id="oo-title-h">Opportunity</div><div class="modal-sub" id="oo-sub"></div></div><button class="modal-close" onclick="closeModal('modal-os-opp')">✕</button></div>
      <div class="modal-body os-split">
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <input type="hidden" id="oo-id"/>
          <div class="f-group"><label class="f-label" for="oo-title">Title</label><input id="oo-title" class="f-input oo-edit" placeholder="e.g. Acme — Singapore market entry"/></div>
          <div class="f-grid">
            <div class="f-group"><label class="f-label" for="oo-company">Company</label><select id="oo-company" class="f-input f-select oo-edit" onchange="document.getElementById('oo-company-new').style.display=this.value==='__new'?'':'none';osFillContacts(this.value==='__new'?null:this.value)"></select><input id="oo-company-new" class="f-input" placeholder="New company name" style="display:none;margin-top:6px"/></div>
            <div class="f-group"><label class="f-label" for="oo-contact">Primary contact</label><select id="oo-contact" class="f-input f-select oo-edit"></select></div>
            <div class="f-group"><label class="f-label" for="oo-type">Type</label><select id="oo-type" class="f-input f-select oo-edit"></select></div>
            <div class="f-group"><label class="f-label" for="oo-stage">Stage</label><select id="oo-stage" class="f-input f-select oo-edit" onchange="osToggleLost()"></select></div>
            <div class="f-group"><label class="f-label" for="oo-owner">Owner</label><select id="oo-owner" class="f-input f-select oo-edit"></select></div>
            <div class="f-group"><label class="f-label" for="oo-fee">Fee structure</label><select id="oo-fee" class="f-input f-select oo-edit"></select></div>
            <div class="f-group oo-val"><label class="f-label" for="oo-value">Commercial value</label><div style="display:flex;gap:6px"><select id="oo-currency" class="f-input f-select oo-edit" style="width:90px"><option>SGD</option><option>USD</option><option>AED</option><option>EUR</option><option>GBP</option><option>AUD</option></select><input id="oo-value" type="number" min="0" step="100" class="f-input oo-edit" placeholder="0"/></div></div>
            <div class="f-group oo-val"><label class="f-label" for="oo-prob">Probability %</label><input id="oo-prob" type="number" min="0" max="100" class="f-input oo-edit"/></div>
            <div class="f-group"><label class="f-label" for="oo-close">Expected close</label><input id="oo-close" type="date" class="f-input oo-edit"/></div>
          </div>
          <div class="os-next"><div class="f-label" style="margin-bottom:6px">Next action (required while open)</div><div style="display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:8px"><input id="oo-next" class="f-input oo-edit" placeholder="e.g. Send proposal draft to CEO"/><input id="oo-next-date" type="date" class="f-input oo-edit"/></div></div>
          <div class="f-group" id="oo-lost-wrap" style="display:none"><label class="f-label" for="oo-lost">Lost reason (required)</label><input id="oo-lost" class="f-input oo-edit" placeholder="e.g. Chose a local agency on price"/></div>
          <div class="f-group"><label class="f-label" for="oo-notes">Notes</label><textarea id="oo-notes" rows="4" class="f-input oo-edit" style="resize:vertical"></textarea></div>
        </div>
        <div id="oo-side" style="display:flex;flex-direction:column;gap:14px;min-width:0">
          <div class="os-box"><div class="os-box-h">BANAHUB Lead Qualification Score <button class="btn btn-ghost btn-sm" id="oo-score-btn" onclick="osScoreEdit()">Score</button></div><div id="oo-score"></div></div>
          <div class="os-box"><div class="os-box-h">Tasks</div><div id="oo-tasks"></div></div>
          <div class="os-box"><div class="os-box-h">History</div>
            <div style="display:flex;gap:6px;margin-bottom:8px"><select id="oo-note-kind" class="f-input f-select" style="width:110px;padding:4px 8px;font-size:12px"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option></select><input id="oo-note" class="f-input" placeholder="Log what happened…" style="font-size:12px;padding:6px 10px" onkeydown="if(event.key==='Enter')osAddNote('opportunity','oo-id','oo-note-kind','oo-note','oo-history')"/><button class="btn btn-ghost btn-sm" onclick="osAddNote('opportunity','oo-id','oo-note-kind','oo-note','oo-history')">Log</button></div>
            <div id="oo-history" style="max-height:300px;overflow:auto"></div></div>
        </div>
      </div>
      <div class="modal-footer"><button class="btn btn-danger" id="oo-delete" onclick="osDeleteOpp()" style="margin-right:auto">Delete</button><button class="btn btn-ghost" onclick="closeModal('modal-os-opp')">Close</button><button class="btn btn-primary" id="oo-save" onclick="osSaveOpp()">Save</button></div>
    </div>
  </div>
  <div id="modal-os-score" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-os-score')">
    <div class="modal" style="max-width:620px">
      <div class="modal-header"><div><div class="modal-title">Lead Qualification Score</div><div class="modal-sub">80–100 Priority A · 60–79 Priority B · 40–59 Nurture · below 40 Disqualify / self-service</div></div><button class="modal-close" onclick="closeModal('modal-os-score')">✕</button></div>
      <div class="modal-body"><div id="os-sc-rows"></div>
        <div id="os-sc-total" style="margin:14px 0 10px"></div>
        <div id="os-sc-ovr-row"><label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="os-sc-ovr" onchange="document.getElementById('os-sc-ovr-wrap').style.display=this.checked?'':'none';osScoreTotal()"/>Manual override</label>
          <div id="os-sc-ovr-wrap" style="display:none;margin-top:8px"><div style="display:grid;grid-template-columns:100px minmax(0,1fr);gap:8px"><input type="number" min="0" max="100" id="os-sc-ovr-total" class="f-input" placeholder="Score" oninput="osScoreTotal()"/><input id="os-sc-reason" class="f-input" placeholder="Reason (required, recorded in history)"/></div></div></div>
        <div class="f-group" style="margin-top:10px"><label class="f-label" for="os-sc-rationale">Rationale (optional)</label><input id="os-sc-rationale" class="f-input" placeholder="What the score is based on"/></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-os-score')">Cancel</button><button class="btn btn-ghost" onclick="osSaveScore(false)">Save as suggestion</button><button class="btn btn-primary" id="os-sc-approve" onclick="osSaveScore(true)">Save &amp; approve</button></div>
    </div>
  </div>
  <div id="modal-os-task" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-os-task')">
    <div class="modal" style="max-width:520px">
      <div class="modal-header"><div class="modal-title" id="ot-h">Task</div><button class="modal-close" onclick="closeModal('modal-os-task')">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px"><input type="hidden" id="ot-id"/><input type="hidden" id="ot-entity"/>
        <div class="f-group"><label class="f-label" for="ot-title">Task</label><input id="ot-title" class="f-input" placeholder="e.g. Call CFO about budget"/></div>
        <div class="f-grid"><div class="f-group"><label class="f-label" for="ot-due">Due</label><input id="ot-due" type="date" class="f-input"/></div>
          <div class="f-group"><label class="f-label" for="ot-priority">Priority</label><select id="ot-priority" class="f-input f-select"><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></div>
          <div class="f-group"><label class="f-label" for="ot-assignee">Assigned to</label><select id="ot-assignee" class="f-input f-select"></select></div>
          <div class="f-group"><label class="f-label" for="ot-status">Status</label><select id="ot-status" class="f-input f-select"><option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></div></div>
        <div class="f-group"><label class="f-label" for="ot-notes">Notes</label><textarea id="ot-notes" rows="3" class="f-input"></textarea></div></div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-os-task')">Cancel</button><button class="btn btn-primary" onclick="osSaveTask()">Save task</button></div>
    </div>
  </div>
  <div id="modal-os-company" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('modal-os-company')">
    <div class="modal modal-lg" style="max-width:1050px">
      <div class="modal-header"><div class="modal-title" id="oc-h">Company</div><button class="modal-close" onclick="closeModal('modal-os-company')">✕</button></div>
      <div class="modal-body os-split"><div style="display:flex;flex-direction:column;gap:12px;min-width:0"><input type="hidden" id="oc-id"/>
        <div class="f-grid"><div class="f-group"><label class="f-label" for="oc-name">Name</label><input id="oc-name" class="f-input"/></div><div class="f-group"><label class="f-label" for="oc-website">Website</label><input id="oc-website" class="f-input"/></div>
          <div class="f-group"><label class="f-label" for="oc-country">Country</label><input id="oc-country" class="f-input"/></div><div class="f-group"><label class="f-label" for="oc-stage">Stage</label><input id="oc-stage" class="f-input" placeholder="e.g. Series A, Established SME"/></div>
          <div class="f-group"><label class="f-label" for="oc-revenue_band">Revenue band</label><input id="oc-revenue_band" class="f-input"/></div>
          <div class="f-group"><label class="f-label" for="oc-relationship">Relationship</label><select id="oc-relationship" class="f-input f-select"><option value="prospect">Prospect</option><option value="client">Client</option><option value="former_client">Former client</option><option value="partner">Partner</option><option value="investor_org">Investor organisation</option><option value="other">Other</option></select></div>
          <div class="f-group"><label class="f-label" for="oc-status">Status</label><select id="oc-status" class="f-input f-select"><option value="active">Active</option><option value="dormant">Dormant</option><option value="archived">Archived</option></select></div>
          <div class="f-group"><label class="f-label" for="oc-owner">Owner</label><select id="oc-owner" class="f-input f-select"></select></div></div>
        <div class="f-group"><label class="f-label" for="oc-sectors">Sectors (comma separated)</label><input id="oc-sectors" class="f-input"/><div style="font-size:11px;color:var(--white-muted);margin-top:4px">Industry: <span id="oc-industries"></span></div></div>
        <div class="os-next"><div class="f-label" style="margin-bottom:6px">Next action</div><div style="display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:8px"><input id="oc-next_action" class="f-input"/><input id="oc-next_action_date" type="date" class="f-input"/></div></div>
        <div class="f-group"><label class="f-label" for="oc-notes">Notes</label><textarea id="oc-notes" rows="3" class="f-input"></textarea></div></div>
        <div id="oc-side" style="display:flex;flex-direction:column;gap:14px;min-width:0">
          <div class="os-box"><div class="os-box-h">Opportunities</div><div id="oc-opps"></div></div>
          <div class="os-box"><div class="os-box-h">Contacts</div><div id="oc-contacts"></div></div>
          <div class="os-box"><div class="os-box-h">Tasks</div><div id="oc-tasks"></div></div>
          <div class="os-box"><div class="os-box-h">History</div><div style="display:flex;gap:6px;margin-bottom:8px"><select id="oc-note-kind" class="f-input f-select" style="width:110px;padding:4px 8px;font-size:12px"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option></select><input id="oc-note" class="f-input" placeholder="Log what happened…" style="font-size:12px;padding:6px 10px"/><button class="btn btn-ghost btn-sm" onclick="osAddNote('company','oc-id','oc-note-kind','oc-note','oc-history')">Log</button></div><div id="oc-history" style="max-height:240px;overflow:auto"></div></div>
        </div></div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-os-company')">Close</button><button class="btn btn-primary" id="oc-save" onclick="osSaveCompany()">Save</button></div>
    </div>
  </div>
  <div id="modal-os-contact" class="modal-overlay" style="display:none;z-index:1100" onclick="if(event.target===this)closeModal('modal-os-contact')">
    <div class="modal" style="max-width:640px">
      <div class="modal-header"><div class="modal-title" id="ocn-h">Contact</div><button class="modal-close" onclick="closeModal('modal-os-contact')">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px"><input type="hidden" id="ocn-id"/>
        <div class="f-grid"><div class="f-group"><label class="f-label" for="ocn-full_name">Full name</label><input id="ocn-full_name" class="f-input"/></div><div class="f-group"><label class="f-label" for="ocn-title">Title</label><input id="ocn-title" class="f-input"/></div>
          <div class="f-group"><label class="f-label" for="ocn-email">Email</label><input id="ocn-email" type="email" class="f-input"/></div><div class="f-group"><label class="f-label" for="ocn-phone">Phone</label><input id="ocn-phone" class="f-input"/></div>
          <div class="f-group"><label class="f-label" for="ocn-company">Company</label><select id="ocn-company" class="f-input f-select"></select></div><div class="f-group"><label class="f-label" for="ocn-linkedin_url">LinkedIn</label><input id="ocn-linkedin_url" class="f-input"/></div>
          <div class="f-group"><label class="f-label" for="ocn-owner">Owner</label><select id="ocn-owner" class="f-input f-select"></select></div>
          <div class="f-group"><label class="f-label" for="ocn-status">Status</label><select id="ocn-status" class="f-input f-select"><option value="active">Active</option><option value="dormant">Dormant</option><option value="archived">Archived</option><option value="do_not_contact">Do not contact</option></select></div></div>
        <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="ocn-dm"/>Decision maker</label>
        <div class="os-next"><div class="f-label" style="margin-bottom:6px">Next action</div><div style="display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:8px"><input id="ocn-next_action" class="f-input"/><input id="ocn-next_action_date" type="date" class="f-input"/></div></div>
        <div class="f-group"><label class="f-label" for="ocn-notes">Notes</label><textarea id="ocn-notes" rows="3" class="f-input"></textarea></div></div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-os-contact')">Cancel</button><button class="btn btn-primary" onclick="osSaveContact()">Save</button></div>
    </div>
  </div>`;

  const CSS = `
  .os-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:16px}
  .os-kpi{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:14px 16px}
  .os-kpi-l{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--white-muted)}.os-kpi-l .material-symbols-outlined{font-size:16px}
  .os-kpi-v{font-size:22px;font-weight:800;color:var(--ink);margin-top:4px}.os-kpi-s{font-size:11px;color:var(--white-muted);margin-top:2px}
  .os-kpi-warn{border-color:rgba(179,38,30,.35);background:#fff8f7}.os-kpi-warn .os-kpi-v{color:#b3261e}
  .os-dash-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}@media(max-width:1100px){.os-dash-grid{grid-template-columns:minmax(0,1fr)}}
  .os-card-alert{border-color:rgba(179,38,30,.3)}
  .os-count{display:inline-block;min-width:20px;text-align:center;font-size:11px;background:var(--surface-2,#eee);border-radius:999px;padding:1px 7px;margin-left:4px;color:var(--ink)}
  .os-table td{vertical-align:top}.os-empty{padding:18px;font-size:12px;color:var(--white-muted)}.os-more{padding:8px 14px;font-size:12px;color:var(--emerald);cursor:pointer}
  .os-flag{display:inline-block;font-size:10px;font-weight:700;color:#b3261e;background:#fdecea;border-radius:4px;padding:1px 6px;margin:2px 4px 0 0}
  .os-flag-info{color:#1a4d7a;background:#e8f0f8}
  .os-class{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--c);border:1px solid var(--c);border-radius:4px;padding:0 6px;margin:2px 4px 0 0;white-space:nowrap}
  .os-class-none{--c:#888;opacity:.7}
  .os-pipe-row{display:grid;grid-template-columns:130px minmax(0,1fr) 120px;gap:10px;align-items:center;padding:6px 0;cursor:pointer;font-size:12px}
  .os-pipe-l span{color:var(--white-muted)}.os-pipe-bar{height:10px;background:var(--surface-2,#f0f0f0);border-radius:6px;overflow:hidden}.os-pipe-bar i{display:block;height:100%;background:var(--emerald)}
  .os-pipe-v{text-align:right;font-weight:700;color:var(--ink)}
  .os-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px}
  .os-col{background:var(--surface-2,#f4f3ee);border-radius:var(--r);padding:8px;min-height:200px}
  .os-col-h{font-size:12px;font-weight:800;color:var(--ink);padding:4px 4px 8px;display:flex;gap:6px;align-items:baseline}.os-col-h span{color:var(--white-muted)}.os-col-h em{margin-left:auto;font-style:normal;font-size:11px;color:var(--white-muted)}
  .os-col-empty{text-align:center;color:var(--white-muted);font-size:12px;padding:12px}
  .os-card{background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;cursor:pointer}.os-card:hover{border-color:var(--emerald)}
  .os-card-stalled{border-left:3px solid #b3261e}
  .os-card-t{font-size:13px;font-weight:700;color:var(--ink)}.os-card-s{font-size:11px;color:var(--white-muted);margin-top:2px}
  .os-card-m{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:12px}.os-card-n{font-size:11px;color:var(--white-dim);margin-top:6px}.os-card-n.od{color:#b3261e;font-weight:700}
  .os-split{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px}@media(max-width:900px){.os-split{grid-template-columns:minmax(0,1fr)}}
  .os-box{border:1px solid var(--border);border-radius:var(--r);padding:12px}.os-box-h{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--emerald-deep);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
  .os-next{background:rgba(10,92,64,.05);border:1px solid rgba(10,92,64,.18);border-radius:var(--r);padding:10px}
  .os-score-cur{display:flex;gap:12px;align-items:flex-start}.os-score-n{font-size:30px;font-weight:800;color:var(--c);line-height:1}.os-score-n small{font-size:12px;color:var(--white-muted)}
  .os-score-bd{font-size:10.5px;color:var(--white-muted);margin-top:4px;line-height:1.5}
  .os-score-pend{display:flex;gap:10px;justify-content:space-between;align-items:flex-start;border-top:1px dashed var(--border);padding-top:8px;margin-top:8px;font-size:12px}
  .os-sc-row{display:grid;grid-template-columns:minmax(0,1fr) 140px 70px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)}
  .os-h{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)}.os-h .material-symbols-outlined{font-size:16px;color:var(--white-muted)}
  .os-task{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)}.os-task.done{opacity:.55}
  .os-t-group{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--emerald-deep);margin:12px 0 2px}.os-t-group span{color:var(--white-muted)}
  .os-mini{border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:12px;cursor:pointer}.os-mini div{font-size:11px;color:var(--white-muted)}
  #os-nav-group .nav-item{position:relative}`;
})();
