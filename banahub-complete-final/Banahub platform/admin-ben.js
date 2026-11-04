/* BANAHUB Admin OS — Ben, the CEO's chief-of-staff assistant.
 * Toggle at the bottom of every Admin OS screen. Navigate, brief, recommend, create reminders / to-dos,
 * schedule (task + .ics), search members / investors / raises / enquiries.
 * Built-in command engine works with no AI key; when the `ben` edge function has ANTHROPIC_API_KEY set,
 * free-form questions go to Claude. All writes run in the browser under the admin's own RLS.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const OS = () => window.__OS || {};
  const sb = () => OS().sb;
  const uid = () => OS().uid;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const safe = (p, d) => Promise.resolve(p).then(r => (r && r.error ? d : (r && 'data' in r ? (r.data ?? d) : r)), () => d);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const addDays = (n, from) => { const d = from ? new Date(from) : new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const fmtD = s => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' }) : 'no date';
  const short = n => { n = Number(n) || 0; const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)); };

  const B = { open: false, busy: false, ai: null, msgs: [], snap: null, snapAt: 0, lastTask: null };

  /* ---------- navigation map (read from the live sidebar) ---------- */
  const ALIAS = { home: 'dashboard', overview: 'dashboard', members: 'users', member: 'users', people: 'users', invoices: 'payments', invoice: 'payments', billing: 'payments', stripe: 'payments', submissions: 'os-submissions', 'capital raise': 'os-submissions', raises: 'os-fundraisers', fundraising: 'os-fundraisers', pipeline: 'os-deals', deals: 'os-deals', tasks: 'os-tasks', todo: 'os-tasks', todos: 'os-tasks', reminders: 'os-tasks', security: 'activity', logins: 'activity', log: 'activity', prices: 'pricing', plans: 'pricing', matches: 'os-matching', matching: 'os-matching', revenue: 'os-revenue', crm: 'crm', leads: 'enquiries', enquiry: 'enquiries', inquiries: 'enquiries', partner: 'partners' };
  function panels() {
    const seen = {}, out = [];
    document.querySelectorAll('.nav-item[onclick*="nav("]').forEach(b => {
      const m = (b.getAttribute('onclick') || '').match(/nav\('([a-z0-9-]+)'\)/); if (!m || seen[m[1]] || !$('panel-' + m[1])) return;
      const c = b.cloneNode(true); c.querySelectorAll('.nav-icon,.nav-badge,.material-symbols-outlined').forEach(x => x.remove());
      seen[m[1]] = 1; out.push({ id: m[1], label: c.textContent.replace(/\s+/g, ' ').trim() || m[1] });
    });
    return out;
  }
  function findPanel(t) {
    t = String(t || '').toLowerCase().replace(/\b(the|page|panel|section|tab|screen|please)\b/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const P = panels(), byId = id => P.find(p => p.id === id);
    if (ALIAS[t] && byId(ALIAS[t])) return byId(ALIAS[t]);
    return P.find(p => p.label.toLowerCase() === t) || P.find(p => p.id === t) || P.find(p => p.label.toLowerCase().startsWith(t))
      || P.find(p => p.label.toLowerCase().includes(t)) || (Object.keys(ALIAS).find(k => t.includes(k)) ? byId(ALIAS[Object.keys(ALIAS).find(k => t.includes(k))]) : null);
  }
  function go(id) { if (typeof window.nav === 'function' && $('panel-' + id)) { window.nav(id); if (window.innerWidth <= 900) toggle(false); return true; } return false; }

  /* ---------- live snapshot ---------- */
  async function snapshot(force) {
    if (!force && B.snap && Date.now() - B.snapAt < 60000) return B.snap;
    const s = sb(); if (!s) return {};
    const now = new Date(), d1 = new Date(now - 864e5).toISOString(), in14 = new Date(+now + 14 * 864e5).toISOString(), t = today(), me = uid();
    const [users, raises, inv, enq, tasks, invoices, fails, events, camps] = await Promise.all([
      safe(s.from('users').select('id,full_name,email,company_name,role,member_category,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(50), []),
      safe(s.from('deal_rooms').select('id,company_name,stage,target_raise,currency,review_status,submitted_at').not('submitted_by', 'is', null).in('review_status', ['submitted', 'in_review', 'needs_info']).order('submitted_at', { ascending: false }).limit(50), []),
      safe(s.from('investors').select('id,organization,investor_type,review_status,submitted_at').not('user_id', 'is', null).in('review_status', ['submitted', 'in_review', 'needs_info']).limit(50), []),
      safe(s.from('enquiries').select('id,name,company,service,status,priority,created_at,responded_at').is('responded_at', null).not('status', 'in', '(closed,resolved,done,archived,spam,converted)').order('created_at', { ascending: false }).limit(50), []),
      safe(s.from('os_tasks').select('id,title,due_date,priority,status,assignee_id,created_by').eq('status', 'open').order('due_date', { ascending: true, nullsFirst: false }).limit(200), []),
      safe(s.from('stripe_invoices').select('id,number,customer_name,customer_email,amount_remaining,currency,due_date,status').eq('status', 'open').limit(100), []),
      safe(s.from('login_attempts').select('email,ip_address,created_at').eq('success', false).gte('created_at', d1).limit(500), []),
      safe(s.from('events').select('id,title,event_date,location,published').gte('event_date', now.toISOString()).lte('event_date', in14).order('event_date').limit(20), []),
      safe(s.from('deal_rooms').select('id,company_name,campaign_status').in('campaign_status', ['awaiting_payment', 'paid']).limit(50), []),
    ]);
    const mine = tasks.filter(x => !me || x.assignee_id === me || x.created_by === me || !x.assignee_id).sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : (a.due_date || '9999') > (b.due_date || '9999') ? 1 : (a.priority === 'high' ? -1 : 1));
    const overdueInv = invoices.filter(i => i.due_date && new Date(i.due_date) < now);
    const ips = {}; fails.forEach(f => { const k = f.ip_address || '?'; ips[k] = (ips[k] || 0) + 1; });
    B.snap = {
      pending_members: { count: users.length, latest: users.slice(0, 5).map(u => `${u.full_name || u.email}${u.company_name ? ' (' + u.company_name + ')' : ''} · ${u.member_category || u.role || ''}`) },
      member_submissions: { raises: raises.length, investor_profiles: inv.length, new: raises.filter(r => r.review_status === 'submitted').length + inv.filter(i => i.review_status === 'submitted').length, latest_raises: raises.slice(0, 5).map(r => `${r.company_name} · ${r.stage || ''} · ${r.currency || 'USD'} ${short(r.target_raise)}`) },
      open_enquiries: { count: enq.length, high_priority: enq.filter(e => e.priority === 'high' || e.priority === 'urgent').length, older_than_2_days: enq.filter(e => new Date(e.created_at) < new Date(now - 2 * 864e5)).length, latest: enq.slice(0, 5).map(e => `${e.name || ''}${e.company ? ' · ' + e.company : ''}${e.service ? ' · ' + e.service : ''}`) },
      my_tasks: { open: mine.length, overdue: mine.filter(x => x.due_date && x.due_date < t).length, due_today: mine.filter(x => x.due_date === t).length, next: mine.slice(0, 8).map(x => ({ id: x.id, title: x.title, due: x.due_date, priority: x.priority })) },
      invoices: { open: invoices.length, overdue: overdueInv.length, overdue_amount: overdueInv.map(i => `${(i.currency || '').toUpperCase()} ${short(i.amount_remaining)}`).slice(0, 5) },
      security_24h: { failed_logins: fails.length, distinct_ips: Object.keys(ips).length, top_ips: Object.entries(ips).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ip, n]) => `${ip} ×${n}`) },
      upcoming_events_14d: events.map(e => `${e.title} · ${fmtD(String(e.event_date).slice(0, 10))}${e.published ? '' : ' (unpublished)'}`),
      capital_campaigns: { awaiting_payment: camps.filter(c => c.campaign_status === 'awaiting_payment').length, paid_not_started: camps.filter(c => c.campaign_status === 'paid').length },
    };
    B.snapAt = Date.now();
    return B.snap;
  }

  function recommendations(S) {
    const r = [];
    if (S.my_tasks.overdue) r.push({ p: 1, t: `Clear **${S.my_tasks.overdue} overdue task${S.my_tasks.overdue > 1 ? 's' : ''}**`, a: [['Open tasks', 'os-tasks']] });
    if (S.security_24h.failed_logins >= 10) r.push({ p: 1, t: `Security: **${S.security_24h.failed_logins} failed logins** in 24h from ${S.security_24h.distinct_ips} IP(s) — ${S.security_24h.top_ips.join(', ')}`, a: [['Review activity', 'activity']] });
    if (S.open_enquiries.high_priority || S.open_enquiries.older_than_2_days) r.push({ p: 1, t: `Reply to enquiries — ${S.open_enquiries.high_priority} high priority, ${S.open_enquiries.older_than_2_days} waiting > 2 days`, a: [['Open enquiries', 'enquiries']] });
    if (S.capital_campaigns.paid_not_started) r.push({ p: 1, t: `**${S.capital_campaigns.paid_not_started} paid campaign(s)** not started yet — kick off`, a: [['Submissions', 'os-submissions']] });
    if (S.member_submissions.new) r.push({ p: 2, t: `Review **${S.member_submissions.new} new member submission(s)** (${S.member_submissions.raises} raises, ${S.member_submissions.investor_profiles} investor profiles open)`, a: [['Review', 'os-submissions']] });
    if (S.pending_members.count) r.push({ p: 2, t: `Approve or decline **${S.pending_members.count} pending member(s)** — approval is manual`, a: [['Members', 'users']] });
    if (S.invoices.overdue) r.push({ p: 2, t: `Chase **${S.invoices.overdue} overdue invoice(s)** — ${S.invoices.overdue_amount.join(', ')}`, a: [['Payments', 'payments']] });
    if (S.capital_campaigns.awaiting_payment) r.push({ p: 3, t: `${S.capital_campaigns.awaiting_payment} campaign checkout(s) awaiting payment — follow up`, a: [['Submissions', 'os-submissions']] });
    if (S.my_tasks.due_today) r.push({ p: 3, t: `${S.my_tasks.due_today} task(s) due today`, a: [['Tasks', 'os-tasks']] });
    if (S.upcoming_events_14d.some(e => e.includes('unpublished'))) r.push({ p: 3, t: 'Publish upcoming event(s) still marked unpublished', a: [['Events', 'events']] });
    if (S.open_enquiries.count && !r.some(x => x.a[0][1] === 'enquiries')) r.push({ p: 3, t: `${S.open_enquiries.count} enquiry(ies) without a reply`, a: [['Enquiries', 'enquiries']] });
    return r.sort((a, b) => a.p - b.p);
  }

  /* ---------- rendering ---------- */
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/^[-•] (.*)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`).replace(/\n/g, '<br>').replace(/<\/ul><br>/g, '</ul>').replace(/<br><ul>/g, '<ul>');
  const btn = (label, js, cls) => `<button type="button" class="ben-act${cls ? ' ' + cls : ''}" onclick="${esc(js)}">${esc(label)}</button>`;
  function say(html, who) {
    const L = $('ben-log'); if (!L) return;
    L.insertAdjacentHTML('beforeend', `<div class="ben-m ${who === 'me' ? 'ben-me' : 'ben-bot'}">${html}</div>`);
    L.scrollTop = L.scrollHeight;
  }
  function typing(on) { const t = $('ben-typing'); if (t) t.style.display = on ? 'flex' : 'none'; const L = $('ben-log'); if (L && on) L.scrollTop = L.scrollHeight; }

  /* ---------- skills ---------- */
  async function brief() {
    const S = await snapshot(true), h = new Date().getHours(), hi = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const recs = recommendations(S);
    let out = `<b>${hi}. Here's BANAHUB right now:</b><div class="ben-kpis">
      ${kpi(S.pending_members.count, 'pending members', 'users')}${kpi(S.member_submissions.new, 'new submissions', 'os-submissions')}
      ${kpi(S.open_enquiries.count, 'open enquiries', 'enquiries')}${kpi(S.my_tasks.overdue, 'overdue tasks', 'os-tasks', S.my_tasks.overdue)}
      ${kpi(S.invoices.overdue, 'overdue invoices', 'payments', S.invoices.overdue)}${kpi(S.security_24h.failed_logins, 'failed logins 24h', 'activity', S.security_24h.failed_logins >= 10)}</div>`;
    if (S.upcoming_events_14d.length) out += `<div class="ben-sub">Next 14 days</div><ul>${S.upcoming_events_14d.slice(0, 4).map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
    out += recHtml(recs);
    B.msgs.push({ role: 'assistant', content: 'Brief delivered: ' + JSON.stringify(S).slice(0, 1500) });
    say(out);
  }
  const kpi = (n, l, panel, warn) => `<button type="button" class="ben-kpi${warn ? ' warn' : ''}" onclick="Ben.go('${panel}')"><b>${n}</b><span>${l}</span></button>`;
  function recHtml(recs) {
    if (!recs.length) return '<div class="ben-sub">Recommended</div><div>✓ Nothing urgent. Good time for growth work — outreach, content or partner follow-ups.</div>';
    return `<div class="ben-sub">Recommended next</div><ol class="ben-recs">${recs.slice(0, 6).map(r => `<li><span>${md(r.t)}</span>${r.a.map(a => btn(a[0], `Ben.go('${a[1]}')`)).join('')}${btn('Remind me', `Ben.quickTask(${JSON.stringify(r.t.replace(/\*\*/g, '').slice(0, 180))})`, 'ghost')}</li>`).join('')}</ol>`;
  }
  async function recommend() { const S = await snapshot(true); say(recHtml(recommendations(S))); }

  async function listTasks() {
    const S = await snapshot(true), T = S.my_tasks, t = today();
    if (!T.next.length) return say('No open tasks. Try <i>“remind me to call Hopp Capital tomorrow 3pm”</i>.');
    say(`<b>${T.open} open task(s)</b>${T.overdue ? ` · <span class="ben-warn">${T.overdue} overdue</span>` : ''}<ul class="ben-tasks">${T.next.map(x => `<li id="bt-${x.id}"><button type="button" class="ben-chk" title="Mark done" onclick="Ben.done('${x.id}')">✓</button><span>${esc(x.title)}</span><em class="${x.due && x.due < t ? 'ben-warn' : ''}">${fmtD(x.due)}${x.priority === 'high' ? ' · high' : ''}</em></li>`).join('')}</ul>${btn('Open Tasks', "Ben.go('os-tasks')")}`);
  }

  // natural-language date: today, tonight, tomorrow, day after tomorrow, next week, in N days/weeks, (next) monday, 15 nov, nov 15, 2026-11-20, end of month
  function parseWhen(t) {
    const s = t.toLowerCase(); let due = null, m, rest = t;
    const cut = re => { rest = rest.replace(re, ' '); };
    const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    if ((m = s.match(/\b(\d{4}-\d{2}-\d{2})\b/))) { due = m[1]; cut(/\b(on\s+)?\d{4}-\d{2}-\d{2}\b/i); }
    else if (/\bday after tomorrow\b/.test(s)) { due = addDays(2); cut(/\bday after tomorrow\b/i); }
    else if (/\b(tomorrow|tmr|tmrw)\b/.test(s)) { due = addDays(1); cut(/\b(tomorrow|tmr|tmrw)\b/i); }
    else if (/\b(today|tonight|this evening|this afternoon)\b/.test(s)) { due = today(); cut(/\b(today|tonight|this evening|this afternoon)\b/i); }
    else if ((m = s.match(/\bin (\d{1,3}) (day|days|week|weeks|month|months)\b/))) { const n = +m[1] * (m[2][0] === 'w' ? 7 : m[2][0] === 'm' ? 30 : 1); due = addDays(n); cut(/\bin \d{1,3} (day|days|week|weeks|month|months)\b/i); }
    else if (/\bnext week\b/.test(s)) { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); due = iso(d); cut(/\bnext week\b/i); }
    else if (/\b(end of (the )?month|eom)\b/.test(s)) { const d = new Date(); due = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); cut(/\b(by\s+)?(end of (the )?month|eom)\b/i); }
    else if ((m = s.match(new RegExp(`\\b(?:on\\s+|this\\s+|next\\s+)?(${DOW.join('|')}|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\\b`)))) {
      const i = DOW.findIndex(d => d.startsWith(m[1].slice(0, 3))), d = new Date(); let diff = (i - d.getDay() + 7) % 7 || 7; if (/next\s/.test(m[0]) && diff < 7) diff += 0; d.setDate(d.getDate() + diff); due = iso(d); cut(new RegExp(m[0].replace(/\s+/g, '\\s+'), 'i'));
    } else if ((m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON.join('|')})[a-z]*\\b|\\b(${MON.join('|')})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
      const day = +(m[1] || m[4]), mon = MON.indexOf((m[2] || m[3]).slice(0, 3)), n = new Date(); let y = n.getFullYear(); const c = new Date(y, mon, day); if (c < new Date(n.getFullYear(), n.getMonth(), n.getDate())) y++; due = iso(new Date(y, mon, day)); cut(new RegExp('\\b(on\\s+)?' + m[0].replace(/\s+/g, '\\s+') + '\\b', 'i'));
    }
    let time = null; const tm = rest.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2}):(\d{2})\b/i);
    if (tm) { let hh = +(tm[1] || tm[4]), mm = +(tm[2] || tm[5] || 0); if (tm[3]) { if (tm[3].toLowerCase() === 'pm' && hh < 12) hh += 12; if (tm[3].toLowerCase() === 'am' && hh === 12) hh = 0; } if (hh < 24 && mm < 60) { time = `${pad(hh)}:${pad(mm)}`; rest = rest.replace(tm[0], ' '); } }
    return { due, time, rest: rest.replace(/\s+/g, ' ').replace(/\s+(on|by|at|for)\s*$/i, '').trim() };
  }

  async function createTask(title, due, priority, notes, schedule) {
    if (!title) return say('What should the task say?');
    if (!sb()) return say('Not signed in to Admin OS yet.');
    const p = { title: title.slice(0, 200), entity_type: 'other', assignee_id: uid() || null, created_by: uid() || null, due_date: due || null, priority: priority || 'normal', status: 'open', notes: notes || null };
    try {
      const r = await q(sb().from('os_tasks').insert(p).select('id').single());
      B.lastTask = Object.assign({ id: r && r.id }, p); B.snapAt = 0;
      try { if (window.__OS && typeof window.__OS.reloadTasks === 'function') window.__OS.reloadTasks(); } catch (e) { }
      const when = due ? `${fmtD(due)}${notes && /^At \d/.test(notes) ? ' · ' + notes.slice(3, 8) : ''}` : 'no due date';
      say(`✓ ${schedule ? 'Scheduled' : 'Reminder set'}: <b>${esc(p.title)}</b> — ${esc(when)}${p.priority === 'high' ? ' · <span class="ben-warn">high</span>' : ''}<div class="ben-row">${due ? btn('Add to calendar (.ics)', 'Ben.ics()') : ''}${btn('Undo', `Ben.undo('${r && r.id}')`, 'ghost')}${btn('My tasks', 'Ben.run("my tasks")', 'ghost')}</div>`);
    } catch (e) { say(`Couldn't create the task: ${esc(e.message)}`); }
  }
  function taskFrom(text, schedule) {
    let body = text.replace(/^(please\s+)?(remind me( to| about)?|reminder( to)?|add (a )?(task|to-?do|reminder)( to)?|create (a )?(task|to-?do|reminder)( to)?|new (task|to-?do)|to-?do|task|schedule( a)?|plan|book|set up|follow up( with)?)\b[:\s-]*/i, m => /follow up/i.test(m) ? 'Follow up with ' : '');
    const prio = /\b(urgent|asap|high priority|important|critical)\b/i.test(body) ? 'high' : /\blow priority\b/i.test(body) ? 'low' : 'normal';
    body = body.replace(/\b(urgent(ly)?|asap|high priority|low priority|important|critical)\b/ig, ' ');
    const w = parseWhen(body), title = w.rest.replace(/^[,.:;\s-]+|[,.:;\s-]+$/g, '');
    return createTask(title.charAt(0).toUpperCase() + title.slice(1), w.due || (schedule ? addDays(1) : null), prio, w.time ? `At ${w.time} (SGT)` : null, schedule);
  }

  async function search(term) {
    term = String(term || '').trim().replace(/[,%()*]/g, ' ').slice(0, 80); if (term.length < 2) return say('Search for what?');
    const s = sb(), like = `%${term}%`;
    const [u, i, r, e] = await Promise.all([
      safe(s.from('users').select('id,full_name,email,company_name,status,member_category').or(`full_name.ilike.${like},email.ilike.${like},company_name.ilike.${like}`).limit(6), []),
      safe(s.from('investors').select('id,organization,full_name,investor_type,email').or(`organization.ilike.${like},full_name.ilike.${like},email.ilike.${like}`).limit(6), []),
      safe(s.from('deal_rooms').select('id,company_name,stage,review_status').ilike('company_name', like).limit(6), []),
      safe(s.from('enquiries').select('id,name,company,email,status').or(`name.ilike.${like},company.ilike.${like},email.ilike.${like}`).limit(6), []),
    ]);
    const n = u.length + i.length + r.length + e.length;
    if (!n) return say(`No matches for “${esc(term)}”.`);
    const sec = (t, rows, f, act) => rows.length ? `<div class="ben-sub">${t}</div><ul>${rows.map(x => `<li>${f(x)} ${act(x)}</li>`).join('')}</ul>` : '';
    say(`<b>${n} result(s) for “${esc(term)}”</b>`
      + sec('Members', u, x => `${esc(x.full_name || x.email)} <em>${esc([x.company_name, x.member_category, x.status].filter(Boolean).join(' · '))}</em>`, x => typeof window.openUserModal === 'function' ? btn('Open', `Ben.go('users');openUserModal('${x.id}')`, 'ghost') : '')
      + sec('Investors', i, x => `${esc(x.organization || x.full_name)} <em>${esc(x.investor_type || '')}</em>`, () => btn('Investors', "Ben.go('investors')", 'ghost'))
      + sec('Company raises', r, x => `${esc(x.company_name)} <em>${esc([x.stage, x.review_status].filter(Boolean).join(' · '))}</em>`, () => btn('Submissions', "Ben.go('os-submissions')", 'ghost'))
      + sec('Enquiries', e, x => `${esc(x.name || x.email)} <em>${esc([x.company, x.status].filter(Boolean).join(' · '))}</em>`, () => btn('Enquiries', "Ben.go('enquiries')", 'ghost')));
  }

  const CREATE = [[/invoice/, 'payments', 'Use “New invoice” at the top of Payments & Invoices.'], [/event/, 'events', 'Click “New event”.'], [/(blog|post|article)/, 'blog', 'Click “New post”.'], [/page/, 'pages', 'Click “New page”.'], [/partner/, 'partners', 'Click “Add partner”.'], [/(price|plan)/, 'pricing', 'Edit or add a plan here.'], [/(programme|program)/, 'programs', 'Click “New programme”.'], [/(raise|deal|opportunit)/, 'os-deals', 'Add it to the pipeline.'], [/(investor)/, 'investors', 'Click “Add investor”.'], [/(company)/, 'os-companies', 'Click “Add company”.'], [/(member|user|admin)/, 'users', 'Invite or add from Members.']];

  function help() {
    say(`<b>I'm Ben — your chief of staff.</b> Try:<ul>
      <li><a href="#" onclick="Ben.run('brief me');return false">brief me</a> — live status + priorities</li>
      <li><a href="#" onclick="Ben.run('what should I do next?');return false">what should I do next?</a> — recommendations</li>
      <li><i>remind me to call Hopp Capital tomorrow 3pm</i></li>
      <li><i>schedule investor update email on friday</i> (+ calendar file)</li>
      <li><a href="#" onclick="Ben.run('my tasks');return false">my tasks</a> · <i>open payments</i> · <i>find PayLah</i> · <i>create invoice</i></li></ul>
      ${B.ai ? '<span class="ben-dim">AI mode is on — ask me anything in plain English.</span>' : '<span class="ben-dim">Built-in mode. Add <code>ANTHROPIC_API_KEY</code> to the <code>ben</code> function secrets to unlock free-form AI.</span>'}`);
  }

  async function ai(text) {
    const S = await snapshot();
    const { data, error } = await sb().functions.invoke('ben', { body: { message: text, history: B.msgs.slice(-12), snapshot: S, panels: panels(), today: today() } });
    if (error || !data) throw new Error((data && data.error) || (error && error.message) || 'no response');
    if (data.ai === false) { B.ai = false; setMode(); return false; }
    if (data.error) throw new Error(data.error);
    B.ai = true; setMode();
    B.msgs.push({ role: 'user', content: text }, { role: 'assistant', content: data.reply || '' });
    let html = md(data.reply || ''), row = '';
    (data.actions || []).forEach(a => {
      if (a.type === 'nav' && $('panel-' + a.panel)) { const p = panels().find(x => x.id === a.panel); row += btn('Open ' + (p ? p.label : a.panel), `Ben.go('${a.panel}')`); }
      if (a.type === 'search' && a.q) row += btn('Search “' + a.q + '”', `Ben.run(${JSON.stringify('find ' + a.q)})`, 'ghost');
      if (a.type === 'task' && a.title) { const id = 'bp' + Math.random().toString(36).slice(2, 8); B[id] = a; row += btn(`+ Task: ${a.title.slice(0, 40)}${a.due ? ' · ' + fmtD(a.due) : ''}`, `Ben.addProposed('${id}')`); }
    });
    say(html + (row ? `<div class="ben-row">${row}</div>` : ''));
    return true;
  }

  async function run(raw) {
    const text = String(raw || '').trim(); if (!text || B.busy) return;
    say(esc(text), 'me'); B.busy = true; typing(true);
    const t = text.toLowerCase().replace(/[?!.]+$/, '');
    try {
      let m;
      if (/^(help|commands|what can you do|\?)$/.test(t)) help();
      else if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(t) && t.split(' ').length <= 3) await brief();
      else if (/^(brief|briefing|brief me|daily brief|morning brief|status|summary|overview|dashboard summary|what'?s (up|new|happening))\b/.test(t)) await brief();
      else if (/^(my )?(tasks|to-?dos|reminders|agenda)$|^what'?s (due|on my plate)|^show (my )?(tasks|reminders|agenda)/.test(t)) await listTasks();
      else if (/^(remind|reminder|add (a )?(task|to-?do|reminder)|create (a )?(task|to-?do|reminder)|new (task|to-?do)|to-?do\b|task\b|follow up)/.test(t)) await taskFrom(text, false);
      else if (/^(schedule|plan|book|set up)\b/.test(t)) await taskFrom(text, true);
      else if ((m = t.match(/^(?:open|go to|goto|take me to|navigate to|show me|show|view)\s+(.+)$/)) && findPanel(m[1])) { const p = findPanel(m[1]); go(p.id); say(`Opened <b>${esc(p.label)}</b>.`); }
      else if ((m = t.match(/^(?:find|search( for)?|look ?up|who is|lookup)\s+(.+)$/))) await search(text.slice(text.replace(/[?!.]+$/, '').length - m[m.length - 1].length, text.replace(/[?!.]+$/, '').length));
      else if ((m = t.match(/^(?:create|new|add|make|draft|send)\s+(?:an?\s+|new\s+)?(.+)$/)) && CREATE.some(c => c[0].test(m[1])) && !(B.ai && m[1].split(' ').length > 3)) { const c = CREATE.find(c => c[0].test(m[1])); go(c[1]); say(`Opened <b>${esc((panels().find(p => p.id === c[1]) || {}).label || c[1])}</b>. ${esc(c[2])}`); }
      else if (/\b(recommend|suggest|what should i|priorit|needs? (my )?attention|next steps?|focus)\b/.test(t) && !(B.ai && t.split(' ').length > 8)) await recommend();
      else if (B.ai !== false && await ai(text).catch(e => { say(`AI unavailable (${esc(e.message)}). Using built-in commands.`); return true; })) { /* answered by AI */ }
      else if (findPanel(t)) { const p = findPanel(t); go(p.id); say(`Opened <b>${esc(p.label)}</b>.`); }
      else if (t.split(' ').length <= 3) await search(text);
      else help();
    } catch (e) { say(`Something went wrong: ${esc(e.message)}`); }
    finally { B.busy = false; typing(false); }
  }

  /* ---------- actions exposed to inline buttons ---------- */
  function ics() {
    const t = B.lastTask; if (!t || !t.due_date) return;
    const tm = t.notes && t.notes.match(/At (\d{2}):(\d{2})/), d = t.due_date.replace(/-/g, ''), uidv = (t.id || Date.now()) + '@banahub.com';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const when = tm ? `DTSTART;TZID=Asia/Singapore:${d}T${tm[1]}${tm[2]}00\r\nDURATION:PT30M` : `DTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${addDays(1, t.due_date + 'T00:00:00').replace(/-/g, '')}`;
    const body = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//BANAHUB//Ben//EN\r\nBEGIN:VEVENT\r\nUID:${uidv}\r\nDTSTAMP:${stamp}\r\n${when}\r\nSUMMARY:${t.title.replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, ' ')}\r\nDESCRIPTION:Created by Ben in BANAHUB Admin OS\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = 'banahub-' + t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.ics'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function undo(id) { try { await q(sb().from('os_tasks').delete().eq('id', id)); B.snapAt = 0; say('Removed.'); } catch (e) { say(`Couldn't undo: ${esc(e.message)}`); } }
  async function done(id) { try { await q(sb().from('os_tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id)); const li = $('bt-' + id); if (li) li.classList.add('done'); B.snapAt = 0; } catch (e) { say(`Couldn't update: ${esc(e.message)}`); } }
  function quickTask(t) { return createTask(t, addDays(1), 'normal', null, false); }
  function addProposed(id) { const a = B[id]; if (!a) return; delete B[id]; return createTask(a.title, a.due, a.priority, a.notes, false); }

  /* ---------- shell ---------- */
  function setMode() { const d = $('ben-mode'); if (d) { d.textContent = B.ai ? 'AI' : B.ai === false ? 'Built-in' : '…'; d.className = 'ben-mode' + (B.ai ? ' on' : ''); } }
  function toggle(force) {
    B.open = typeof force === 'boolean' ? force : !B.open;
    $('ben-panel').classList.toggle('open', B.open); $('ben-toggle').classList.toggle('on', B.open);
    $('ben-toggle').setAttribute('aria-expanded', String(B.open)); $('ben-switch').setAttribute('aria-checked', String(B.open));
    store.set('ben-open', B.open ? '1' : '0');
    if (B.open) { if (!$('ben-log').children.length) { brief().catch(() => help()); } setTimeout(() => $('ben-in').focus(), 150); }
  }
  const CSS = `
  #ben-toggle{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:150;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-radius:999px;border:1px solid rgba(0,53,39,.18);background:#003527;color:#fff;font:600 13px/1 'Inter',system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,30,20,.28);cursor:pointer;letter-spacing:.01em}
  #ben-toggle .ben-av{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#e9c349,#b8902a);color:#003527;display:grid;place-items:center;font-weight:800;font-size:13px}
  #ben-toggle .ben-lbl small{display:block;font-weight:500;font-size:10.5px;opacity:.75;margin-top:3px}
  #ben-switch{width:38px;height:22px;border-radius:999px;background:rgba(255,255,255,.25);position:relative;transition:background .2s;flex:none}
  #ben-switch::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s}
  #ben-toggle.on #ben-switch{background:#e9c349}#ben-toggle.on #ben-switch::after{left:19px}
  #ben-panel{position:fixed;left:50%;bottom:72px;transform:translate(-50%,16px);width:min(560px,calc(100vw - 24px));height:min(640px,calc(100dvh - 100px));z-index:160;background:#fff;border:1px solid rgba(0,53,39,.14);border-radius:18px;box-shadow:0 24px 60px rgba(0,30,20,.25);display:flex;flex-direction:column;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;font:14px/1.5 'Inter',system-ui,sans-serif;color:#1b1c1a}
  #ben-panel.open{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
  .ben-hd{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(0,53,39,.1)}
  .ben-hd b{font-size:15px}.ben-hd span.s{font-size:12px;color:#4a524d}
  .ben-mode{margin-left:auto;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:#eef0ec;color:#4a524d}.ben-mode.on{background:#e3f1e8;color:#0a5c40}
  .ben-x{border:0;background:none;font-size:20px;cursor:pointer;color:#4a524d;padding:0 4px}
  #ben-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
  .ben-m{max-width:92%;padding:10px 12px;border-radius:14px;word-wrap:break-word}
  .ben-bot{background:#f4f6f3;align-self:flex-start;border-top-left-radius:4px}.ben-me{background:#003527;color:#fff;align-self:flex-end;border-top-right-radius:4px}
  .ben-m ul,.ben-m ol{margin:6px 0 4px;padding-left:18px}.ben-m li{margin:3px 0}.ben-m em{color:#4a524d;font-style:normal;font-size:12px}
  .ben-m code{background:#e9ece7;padding:1px 5px;border-radius:4px;font-size:12px}.ben-m a{color:#0a5c40}
  .ben-sub{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#4a524d;margin:10px 0 2px}
  .ben-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
  .ben-kpi{border:1px solid rgba(0,53,39,.12);background:#fff;border-radius:10px;padding:8px;text-align:left;cursor:pointer;font:inherit}
  .ben-kpi b{display:block;font-size:18px;color:#003527}.ben-kpi span{font-size:11px;color:#4a524d}.ben-kpi.warn b{color:#a3261d}
  .ben-recs li span{display:block}.ben-act{margin:5px 6px 0 0;border:1px solid #003527;background:#003527;color:#fff;border-radius:8px;padding:4px 10px;font:600 12px 'Inter',sans-serif;cursor:pointer}
  .ben-act.ghost{background:#fff;color:#003527}.ben-row{margin-top:6px}
  .ben-tasks{list-style:none;padding:0!important}.ben-tasks li{display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(0,53,39,.07)}
  .ben-tasks li span{flex:1}.ben-tasks li.done span{text-decoration:line-through;opacity:.5}
  .ben-chk{width:22px;height:22px;border-radius:6px;border:1px solid rgba(0,53,39,.3);background:#fff;cursor:pointer;color:#0a5c40;flex:none}
  .ben-warn{color:#a3261d!important;font-weight:600}.ben-dim{font-size:12px;color:#4a524d}
  #ben-typing{display:none;gap:4px;padding:0 14px 6px}#ben-typing i{width:6px;height:6px;border-radius:50%;background:#9aa59f;animation:benb 1s infinite}#ben-typing i:nth-child(2){animation-delay:.15s}#ben-typing i:nth-child(3){animation-delay:.3s}
  @keyframes benb{0%,80%,100%{opacity:.3}40%{opacity:1}}
  .ben-chips{display:flex;gap:6px;overflow-x:auto;padding:8px 12px 0;scrollbar-width:none}.ben-chips::-webkit-scrollbar{display:none}
  .ben-chips button{flex:none;border:1px solid rgba(0,53,39,.16);background:#f7f8f5;border-radius:999px;padding:5px 11px;font:500 12px 'Inter',sans-serif;color:#1b1c1a;cursor:pointer;white-space:nowrap}
  .ben-ft{display:flex;gap:8px;padding:10px 12px 12px}
  #ben-in{flex:1;border:1px solid rgba(0,53,39,.2);border-radius:12px;padding:10px 12px;font:14px 'Inter',sans-serif;color:#1b1c1a;resize:none;max-height:120px;outline:none}
  #ben-in:focus{border-color:#003527;box-shadow:0 0 0 3px rgba(0,53,39,.08)}
  .ben-send{border:0;background:#003527;color:#fff;border-radius:12px;padding:0 16px;font:600 13px 'Inter',sans-serif;cursor:pointer}
  @media (max-width:900px){#ben-toggle{bottom:calc(12px + env(safe-area-inset-bottom));padding:7px 8px 7px 10px}#ben-toggle .ben-lbl small{display:none}
    #ben-panel{left:0;right:0;bottom:0;width:100%;height:calc(100dvh - 64px);transform:translateY(24px);border-radius:18px 18px 0 0}#ben-panel.open{transform:none}
    #ben-panel .ben-ft{padding-bottom:calc(12px + env(safe-area-inset-bottom))}.ben-kpis{grid-template-columns:repeat(2,1fr)}}
  body.ben-open .toast-container{bottom:84px}
  .panel.active{padding-bottom:76px}`;
  const CHIPS = [['☀️ Brief me', 'brief me'], ['🎯 What next?', 'what should I do next?'], ['✅ My tasks', 'my tasks'], ['⏰ Remind me…', 'remind me to '], ['📅 Schedule…', 'schedule '], ['🔎 Find…', 'find '], ['🧾 New invoice', 'create invoice'], ['❓ Help', 'help']];

  function mount() {
    if ($('ben-toggle') || !document.body) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend', `
      <div id="ben-panel" role="dialog" aria-label="Ben assistant"><div class="ben-hd"><div class="ben-av" style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#e9c349,#b8902a);display:grid;place-items:center;font-weight:800;color:#003527">B</div>
        <div><b>Ben</b><br><span class="s">Chief of staff · navigate, manage, create, schedule, recommend</span></div><span id="ben-mode" class="ben-mode">…</span><button class="ben-x" aria-label="Close Ben" onclick="Ben.toggle(false)">×</button></div>
        <div id="ben-log" aria-live="polite"></div><div id="ben-typing"><i></i><i></i><i></i></div>
        <div class="ben-chips">${CHIPS.map(c => `<button type="button" data-c="${esc(c[1])}">${c[0]}</button>`).join('')}</div>
        <form class="ben-ft" id="ben-form"><textarea id="ben-in" rows="1" placeholder="Tell Ben what to do…  e.g. remind me to call Hopp tomorrow 3pm" aria-label="Command Ben"></textarea><button class="ben-send" type="submit">Send</button></form></div>
      <button id="ben-toggle" type="button" aria-expanded="false" aria-controls="ben-panel" title="Ben — Ctrl/⌘ + J"><span class="ben-av">B</span><span class="ben-lbl">Ben<small>Command &amp; recommendations</small></span><span id="ben-switch" role="switch" aria-checked="false"></span></button>`);
    $('ben-toggle').onclick = () => toggle();
    $('ben-form').onsubmit = e => { e.preventDefault(); const v = $('ben-in').value; $('ben-in').value = ''; run(v); };
    $('ben-in').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('ben-form').requestSubmit(); } if (e.key === 'Escape') toggle(false); });
    document.querySelectorAll('.ben-chips button').forEach(b => b.onclick = () => { const c = b.dataset.c; if (/ $/.test(c)) { $('ben-in').value = c; $('ben-in').focus(); } else run(c); });
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); toggle(); } });
    new MutationObserver(() => document.body.classList.toggle('ben-open', B.open)).observe($('ben-panel'), { attributes: true, attributeFilter: ['class'] });
    setMode();
    sb().functions.invoke('ben', { body: { probe: true } }).then(r => { B.ai = !!(r && r.data && r.data.ai); setMode(); }).catch(() => { B.ai = false; setMode(); });
    if (store.get('ben-open') === '1') setTimeout(() => toggle(true), 600);
  }

  window.Ben = { toggle, run, go: id => { go(id); }, done, undo, ics, quickTask, addProposed, snapshot, parseWhen, __B: B };
  // Only for signed-in admins: wait for the Admin OS bootstrap (window.__OS.sb + uid)
  let tries = 0;
  (function wait() { if (OS().sb && OS().uid) { mount(); return; } if (++tries < 120) setTimeout(wait, 500); })();
})();
