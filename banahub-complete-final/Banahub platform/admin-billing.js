/* BANAHUB Admin OS — Membership & Revenue (CEO only)
 * Membership: every member with plan, billing state, MRR, Stripe links, owner, next action, churn reason; plan & price editor.
 * CEO Revenue: cash collected, MRR/ARR, new / churned MRR, renewals, revenue by source, funnel.
 * Billing fields are written only by the stripe-webhook Edge Function; this screen edits relationship fields and plan prices.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const OS = () => window.__OS || { perms: new Set(), people: [] };
  const isCEO = () => OS().perms.has('*');
  const sb = () => OS().sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const sgd = n => 'SGD ' + Number(n || 0).toLocaleString('en-SG', { maximumFractionDigits: 0 });
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const STRIPE = id => id ? `https://dashboard.stripe.com/${/^(cus|sub|in)_/.test(id) ? (id.startsWith('cus') ? 'customers' : id.startsWith('sub') ? 'subscriptions' : 'invoices') + '/' : ''}${id}` : '';
  const ST = { active: ['Active', '#0a5c40', '#e3f1e8'], pending_payment: ['Awaiting payment', '#7a5c00', '#fff4d6'], past_due: ['Payment due', '#8c1d18', '#fdecea'], canceled: ['Cancelled', '#555', '#eee'], expired: ['Expired', '#555', '#eee'], incomplete: ['Incomplete', '#7a5c00', '#fff4d6'] };
  const B = { members: [], users: {}, plans: [], tx: [], sum: null, filter: { plan: 'paid', q: '' } };

  function inject() {
    if ($('panel-os-membership')) return true;
    const g = $('os-nav-group'); if (!g || !window.__OS || !window.__OS.sb) return false;
    if (!isCEO()) return true;
    const after = g.querySelector('[data-os-nav="os-dashboard"]');
    after.insertAdjacentHTML('afterend', '<button class="nav-item" onclick="nav(\'os-revenue\')" data-os-nav="os-revenue"><span class="nav-icon material-symbols-outlined">payments</span>CEO Revenue</button><button class="nav-item" onclick="nav(\'os-membership\')" data-os-nav="os-membership"><span class="nav-icon material-symbols-outlined">card_membership</span>Membership<span class="nav-badge" id="nb-bl-risk" style="display:none"></span></button>');
    $('panel-dashboard').parentNode.insertAdjacentHTML('beforeend', '<div id="panel-os-revenue" class="panel"></div><div id="panel-os-membership" class="panel"></div>');
    document.body.insertAdjacentHTML('beforeend', MODALS);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') { panelMeta['os-revenue'] = ['CEO Revenue', 'Cash, recurring revenue and revenue by source']; panelMeta['os-membership'] = ['Membership', 'Members, subscriptions, renewals and plans']; }
    load().then(badge).catch(() => {});
    return true;
  }
  async function load() {
    const [members, plans, tx, sum] = await Promise.all([
      q(sb().from('memberships').select('*')), q(sb().from('membership_plans').select('*').order('sort')),
      q(sb().from('transactions').select('*').order('created_at', { ascending: false }).limit(2000)),
      q(sb().from('revenue_membership_summary').select('*')).catch(() => [null]),
    ]);
    B.members = members || []; B.plans = plans || []; B.tx = tx || []; B.sum = (sum || [])[0] || null;
    const ids = B.members.map(m => m.user_id);
    B.users = {};
    for (let k = 0; k < ids.length; k += 200) (await q(sb().from('users').select('id,email,full_name,company_name,status,created_at').in('id', ids.slice(k, k + 200)))).forEach(u => { B.users[u.id] = u; });
  }
  function badge() { const n = B.members.filter(m => m.payment_at_risk).length, el = $('nb-bl-risk'); if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; } }
  const head = (t, s, a) => `<div class="page-header"><div><div class="page-title">${t}</div><div class="page-sub">${s}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${a || ''}</div></div>`;
  const kpi = (l, v, s, warn) => `<div class="os-kpi${warn ? ' os-kpi-warn' : ''}"><div class="os-kpi-l">${l}</div><div class="os-kpi-v">${v}</div>${s ? `<div class="os-kpi-s">${s}</div>` : ''}</div>`;
  const net = t => Number(t.amount || 0) - Number(t.amount_refunded || 0);
  const paidTx = () => B.tx.filter(t => ['completed', 'paid', 'partially_refunded'].includes(t.status));
  const srcOf = t => t.revenue_source || ({ membership_payment: 'membership', event_registration: 'event', program_payment: 'programme', sponsorship_payment: 'sponsorship' }[t.type]) || t.item_type || 'other';
  const inMonth = (d, off = 0) => { const x = new Date(d), n = new Date(); n.setMonth(n.getMonth() - off); return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth(); };
  const eff = m => ['free', 'investor_circle'].includes(m.plan_code) ? m.plan_code : (m.access_until && new Date(m.access_until).getTime() + (m.payment_method === 'paynow' ? 7 : 3) * 864e5 > Date.now()) ? m.plan_code : 'free';

  // ── CEO Revenue ───────────────────────────────────────────────────────────
  async function renderRevenue() {
    const P = $('panel-os-revenue'); P.innerHTML = head('CEO Revenue', 'Live from Stripe webhooks and the pipeline') + '<div class="os-empty">Loading…</div>';
    try { await load(); } catch (e) { P.innerHTML = head('CEO Revenue', '') + `<div class="card os-empty">${esc(e.message)} — apply migration 18 first.</div>`; return; }
    let target = null; try { const r = await q(sb().from('site_settings').select('value').eq('key', 'revenue_target_monthly')); target = r && r[0] ? Number(r[0].value) : null; } catch (e) {}
    let opps = []; try { opps = await q(sb().from('os_opportunities_v').select('stage,status,value,probability,fee_structure,currency,opp_type')); } catch (e) {}
    const s = B.sum || {}, tx = paidTx(), mtd = tx.filter(t => inMonth(t.paid_at || t.created_at));
    const cash = mtd.reduce((a, t) => a + net(t), 0), bySrc = src => mtd.filter(t => srcOf(t) === src).reduce((a, t) => a + net(t), 0);
    const successFee = opps.filter(o => o.status === 'open' && ['success_fee', 'fixed_plus_success'].includes(o.fee_structure)).reduce((a, o) => a + (Number(o.value) || 0) * (Number(o.probability) || 0) / 100, 0);
    const awaiting = B.members.filter(m => ['pending_payment', 'past_due'].includes(m.status) && m.plan_code !== 'free').length;
    const counts = { free: B.members.filter(m => eff(m) === 'free').length, paid: B.members.filter(m => ['growth', 'scale'].includes(eff(m))).length };
    const evPaid = new Set(tx.filter(t => ['event', 'programme'].includes(srcOf(t))).map(t => t.user_id).filter(Boolean)).size;
    const months = [...Array(6)].map((_, i) => 5 - i).map(off => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - off); const ts = tx.filter(t => inMonth(t.paid_at || t.created_at, off));
      return { label: d.toLocaleDateString('en-SG', { month: 'short' }), total: ts.reduce((a, t) => a + net(t), 0), src: ts.reduce((o, t) => { o[srcOf(t)] = (o[srcOf(t)] || 0) + net(t); return o; }, {}) }; });
    const max = Math.max(1, ...months.map(m => m.total));
    P.innerHTML = head('CEO Revenue', 'Cash collected, recurring revenue and pipeline — all amounts SGD, net of refunds', `<button class="btn btn-ghost" onclick="blTarget()">Set monthly target</button>`) + `
      <div class="os-kpis">${[
        kpi('Cash collected MTD', sgd(cash), target ? `${Math.round(100 * cash / target)}% of ${sgd(target)} target` : 'Set a monthly target'),
        kpi('MRR', sgd(s.mrr), `${s.paid_members || 0} paying members`), kpi('ARR', sgd(s.arr), 'MRR × 12'),
        kpi('Revenue target', target ? sgd(target) : '—', 'per month'),
        kpi('New paid members', s.new_paid_mtd || 0, `+${sgd(s.new_mrr_mtd)} new MRR this month`),
        kpi('Churn', s.churned_mtd || 0, `${sgd(s.churned_mrr_mtd)} MRR cancelled this month`, (s.churned_mtd || 0) > 0),
        kpi('Upcoming renewals', s.renewals_30d || 0, 'next 30 days'),
        kpi('Event revenue', sgd(bySrc('event')), 'this month'), kpi('Programme revenue', sgd(bySrc('programme')), 'this month'),
        kpi('Sponsorship revenue', sgd(bySrc('sponsorship')), 'this month'), kpi('Advisory revenue', sgd(bySrc('advisory')), 'this month (Stripe invoices)'),
        kpi('Outstanding', awaiting, 'memberships awaiting payment — invoices in Stripe', awaiting > 0),
        kpi('Success-fee pipeline', sgd(successFee), 'probability-weighted, open opportunities'),
      ].join('')}</div>
      <div class="os-dash-grid">
        <div class="card"><div class="card-header"><div class="card-title">Cash collected — last 6 months</div></div><div class="card-body">
          ${months.map(m => `<div class="os-pipe-row" style="cursor:default" title="${esc(Object.entries(m.src).map(([k, v]) => k + ': ' + sgd(v)).join(' · ') || 'No payments')}"><div class="os-pipe-l">${m.label}</div><div class="os-pipe-bar"><i style="width:${100 * m.total / max}%"></i></div><div class="os-pipe-v">${sgd(m.total)}</div></div>`).join('')}</div></div>
        <div class="card"><div class="card-header"><div class="card-title">Revenue by source — this month</div></div><div class="card-body">
          ${['membership', 'event', 'programme', 'sponsorship', 'advisory', 'other'].map(k => `<div class="os-pipe-row" style="cursor:default"><div class="os-pipe-l" style="text-transform:capitalize">${k}</div><div class="os-pipe-bar"><i style="width:${cash ? 100 * bySrc(k) / cash : 0}%"></i></div><div class="os-pipe-v">${sgd(bySrc(k))}</div></div>`).join('')}</div></div>
        <div class="card"><div class="card-header"><div class="card-title">Member funnel</div><div style="font-size:11px;color:var(--white-muted)">Website visitors are tracked in web analytics</div></div><div class="card-body">
          ${[['Free members', counts.free + counts.paid], ['Paid members', counts.paid], ['Event / programme buyers', evPaid]].map(([l, v], i, a) => `<div class="os-pipe-row" style="cursor:default"><div class="os-pipe-l">${l}</div><div class="os-pipe-bar"><i style="width:${a[0][1] ? 100 * v / a[0][1] : 0}%"></i></div><div class="os-pipe-v">${v}${i ? ` <span style="color:var(--white-muted);font-weight:400">${a[i - 1][1] ? Math.round(100 * v / a[i - 1][1]) : 0}%</span>` : ''}</div></div>`).join('')}</div></div>
        <div class="card"><div class="card-header"><div class="card-title">Latest payments</div></div><div style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Date</th><th>Payer</th><th>Source</th><th>Method</th><th>Amount</th></tr></thead><tbody>
          ${tx.slice(0, 10).map(t => `<tr><td>${fmtD(t.paid_at || t.created_at)}</td><td style="font-size:12px">${esc(t.email || '—')}</td><td style="text-transform:capitalize">${esc(srcOf(t))}${t.plan_code ? ' · ' + esc(t.plan_code) : ''}</td><td>${esc(t.payment_method || '—')}</td><td><b>${esc(t.currency || 'SGD')} ${net(t).toLocaleString('en-SG')}</b>${t.amount_refunded > 0 ? ' <span class="os-flag">refunded ' + t.amount_refunded + '</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="5"><div class="os-empty">No payments yet.</div></td></tr>'}</tbody></table></div></div>
      </div>`;
  }

  // ── Membership ────────────────────────────────────────────────────────────
  async function renderMembership() {
    const P = $('panel-os-membership'); P.innerHTML = head('Membership', '') + '<div class="os-empty">Loading…</div>';
    try { await load(); } catch (e) { P.innerHTML = head('Membership', '') + `<div class="card os-empty">${esc(e.message)} — apply migration 18 first.</div>`; return; }
    badge();
    const s = B.sum || {}, f = B.filter, qs = f.q.toLowerCase();
    const evCount = {}; paidTx().forEach(t => { const k = srcOf(t); if (t.user_id && (k === 'event' || k === 'programme')) { evCount[t.user_id] = evCount[t.user_id] || { event: 0, programme: 0 }; evCount[t.user_id][k]++; } });
    let rows = B.members.filter(m => {
      const u = B.users[m.user_id] || {};
      if (f.plan === 'paid' && !['growth', 'scale'].includes(m.plan_code)) return false;
      if (f.plan === 'risk' && !m.payment_at_risk && !['pending_payment', 'past_due'].includes(m.status)) return false;
      if (f.plan && !['paid', 'risk', 'all'].includes(f.plan) && m.plan_code !== f.plan) return false;
      return !qs || [u.email, u.full_name, u.company_name, m.organisation].join(' ').toLowerCase().includes(qs);
    }).sort((a, b) => (b.mrr || 0) - (a.mrr || 0) || String(b.updated_at).localeCompare(String(a.updated_at)));
    P.innerHTML = head('Membership', 'Billing state comes from Stripe; you can edit owner, next action and churn reason', '<button class="btn btn-ghost" onclick="blPlans()">Plans &amp; prices</button>') + `
      <div class="os-kpis">${[kpi('MRR', sgd(s.mrr)), kpi('ARR', sgd(s.arr)), kpi('Growth', s.growth_members || 0), kpi('Scale', s.scale_members || 0), kpi('Free Network', s.free_members || 0), kpi('Investor Circle', s.investor_circle || 0), kpi('Payment at risk', s.at_risk || 0, '', (s.at_risk || 0) > 0), kpi('Renewals (30 days)', s.renewals_30d || 0)].join('')}</div>
      <div class="filter-bar" style="flex-wrap:wrap">
        <select class="f-input f-select" style="width:200px" onchange="blFilter('plan',this.value)">${[['paid', 'Paid members'], ['risk', 'Awaiting / at risk'], ['all', 'Everyone'], ...B.plans.map(p => [p.code, p.name])].map(([v, l]) => `<option value="${v}" ${v === f.plan ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <input class="f-input" style="max-width:260px" placeholder="Search name, email, organisation…" value="${esc(f.q)}" oninput="blFilter('q',this.value)"/>
        <span style="margin-left:auto;font-size:12px;color:var(--white-muted)">${rows.length} members</span></div>
      <div class="card" style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Renewal / access</th><th>MRR</th><th>Activity</th><th>Owner · next action</th><th>Stripe</th></tr></thead><tbody>
      ${rows.slice(0, 300).map(m => { const u = B.users[m.user_id] || {}, st = ST[m.status] || [m.status, '#555', '#eee'], e = evCount[m.user_id] || {}, od = m.next_action_date && new Date(m.next_action_date) < new Date(new Date().toDateString());
        return `<tr style="cursor:pointer" onclick="blOpen('${m.user_id}')"><td><b style="color:var(--ink)">${esc(u.full_name || u.email || m.user_id)}</b><div style="font-size:11px;color:var(--white-muted)">${esc([u.email, m.organisation || u.company_name].filter(Boolean).join(' · '))}</div></td>
          <td>${esc((B.plans.find(p => p.code === m.plan_code) || {}).name || m.plan_code)}<div style="font-size:11px;color:var(--white-muted)">${esc([m.billing_period, m.payment_method === 'paynow' ? 'PayNow' : m.payment_method === 'card' ? 'Card' : ''].filter(Boolean).join(' · '))}</div></td>
          <td><span class="bl-st" style="color:${st[1]};background:${st[2]}">${st[0]}</span>${m.cancel_at_period_end ? '<div class="os-flag">Not renewing</div>' : ''}${m.payment_at_risk ? '<div class="os-flag">At risk</div>' : ''}</td>
          <td style="font-size:12px">${m.current_period_end ? 'Renews ' + fmtD(m.current_period_end) : '—'}<div style="color:var(--white-muted)">${m.access_until ? 'Paid to ' + fmtD(m.access_until) : ''}</div></td>
          <td><b>${m.mrr ? sgd(m.mrr) : '—'}</b></td>
          <td style="font-size:12px">${e.event || 0} events · ${e.programme || 0} programmes</td>
          <td style="font-size:12px">${esc((OS().people.find(p => p.id === m.relationship_owner) || {}).full_name || '')}${m.next_action ? `<div class="${od ? 'cap-od' : ''}" style="${od ? 'color:#b3261e;font-weight:700' : ''}">${esc(m.next_action)}${m.next_action_date ? ' · ' + fmtD(m.next_action_date) : ''}</div>` : ['growth', 'scale'].includes(m.plan_code) ? '<span class="os-flag">No next action</span>' : ''}</td>
          <td style="font-size:12px" onclick="event.stopPropagation()">${m.stripe_customer_id ? `<a href="${STRIPE(m.stripe_customer_id)}" target="_blank" rel="noopener">Customer</a>` : '—'}${m.stripe_subscription_id ? ` · <a href="${STRIPE(m.stripe_subscription_id)}" target="_blank" rel="noopener">Subscription</a>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8"><div class="os-empty">No members in this view.</div></td></tr>'}
      </tbody></table></div>`;
  }
  function openMember(uid) {
    const m = B.members.find(x => x.user_id === uid), u = B.users[uid] || {}; if (!m) return;
    $('blm-id').value = uid; $('blm-h').textContent = u.full_name || u.email || uid;
    $('blm-sub').textContent = [u.email, (B.plans.find(p => p.code === m.plan_code) || {}).name, m.status].filter(Boolean).join(' · ');
    $('blm-org').value = m.organisation || u.company_name || ''; $('blm-na').value = m.next_action || ''; $('blm-nad').value = m.next_action_date || '';
    $('blm-churn').value = m.churn_reason || ''; $('blm-score').value = m.engagement_score == null ? '' : m.engagement_score;
    $('blm-owner').innerHTML = '<option value="">Unassigned</option>' + (OS().people || []).map(p => `<option value="${p.id}" ${p.id === m.relationship_owner ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('');
    const pays = paidTx().filter(t => t.user_id === uid);
    $('blm-pays').innerHTML = pays.length ? pays.map(t => `<div class="os-mini" style="cursor:default"><b>${esc(t.currency || 'SGD')} ${net(t).toLocaleString('en-SG')}</b> · ${esc(srcOf(t))} · ${esc(t.payment_method || '')}<div>${fmtD(t.paid_at || t.created_at)}${t.period_end ? ' · covers to ' + fmtD(t.period_end) : ''}${t.stripe_invoice_id ? ` · <a href="${STRIPE(t.stripe_invoice_id)}" target="_blank" rel="noopener">invoice</a>` : ''}</div></div>`).join('') : '<div class="os-empty" style="padding:4px 0">No payments yet.</div>';
    $('modal-bl-member').style.display = 'flex';
  }
  async function saveMember() {
    const uid = $('blm-id').value, sc = $('blm-score').value;
    const p = { organisation: $('blm-org').value.trim() || null, relationship_owner: $('blm-owner').value || null, next_action: $('blm-na').value.trim() || null,
      next_action_date: $('blm-nad').value || null, churn_reason: $('blm-churn').value.trim() || null, engagement_score: sc === '' ? null : Math.max(0, Math.min(100, +sc)), updated_at: new Date().toISOString() };
    if (p.next_action && !p.next_action_date) return notify('Give the next action a date', 'warn');
    try { await q(sb().from('memberships').update(p).eq('user_id', uid)); notify('Saved'); closeModal('modal-bl-member'); renderMembership(); } catch (e) { notify(e.message, 'warn'); }
  }
  function openPlans() {
    $('blp-rows').innerHTML = B.plans.map(p => `<div class="bl-plan-row" data-id="${p.id}">
      <div><b>${esc(p.name)}</b><div style="font-size:11px;color:var(--white-muted)">${esc(p.code)}${p.self_service ? ' · self-service' : ' · by application'}</div></div>
      <label>Monthly (${esc(p.currency)})<input class="f-input" type="number" min="0" step="1" data-k="monthly_price" value="${p.monthly_price == null ? '' : p.monthly_price}" ${p.code === 'investor_circle' ? 'disabled' : ''}/></label>
      <label>Annual (${esc(p.currency)})<input class="f-input" type="number" min="0" step="1" data-k="annual_price" value="${p.annual_price == null ? '' : p.annual_price}" ${p.code === 'investor_circle' ? 'disabled' : ''}/></label>
      <label style="grid-column:1/-1">Tagline<input class="f-input" data-k="tagline" value="${esc(p.tagline || '')}"/></label>
      <label style="grid-column:1/-1">Benefits (one per line)<textarea class="f-input" rows="4" data-k="benefits">${esc((p.benefits || []).join('\n'))}</textarea></label>
      <label class="bl-chk"><input type="checkbox" data-k="active" ${p.active ? 'checked' : ''}/> Shown on the website</label></div>`).join('');
    $('modal-bl-plans').style.display = 'flex';
  }
  async function savePlans() {
    try {
      for (const row of document.querySelectorAll('#blp-rows .bl-plan-row')) {
        const g = k => row.querySelector(`[data-k="${k}"]`), num = k => g(k).disabled || g(k).value === '' ? null : Math.round(Number(g(k).value) * 100) / 100;
        const p = { tagline: g('tagline').value.trim() || null, benefits: g('benefits').value.split('\n').map(x => x.trim()).filter(Boolean), active: g('active').checked, updated_at: new Date().toISOString() };
        if (!g('monthly_price').disabled) { p.monthly_price = num('monthly_price'); p.annual_price = num('annual_price'); }
        await q(sb().from('membership_plans').update(p).eq('id', row.getAttribute('data-id')));
      }
      notify('Plans saved — new prices apply to new checkouts; existing subscribers keep their price'); closeModal('modal-bl-plans'); renderMembership();
    } catch (e) { notify(e.message, 'warn'); }
  }
  async function setTarget() {
    const v = prompt('Monthly revenue target (SGD):'); if (v == null) return; const n = Number(String(v).replace(/[^0-9.]/g, '')); if (!(n > 0)) return notify('Enter an amount', 'warn');
    try { await q(sb().from('site_settings').upsert({ key: 'revenue_target_monthly', value: String(n), updated_at: new Date().toISOString() }, { onConflict: 'key' })); renderRevenue(); } catch (e) { notify(e.message, 'warn'); }
  }

  const RENDER = { 'os-revenue': renderRevenue, 'os-membership': renderMembership };
  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (RENDER[p]) { inject(); return RENDER[p](); } return prev && prev(p); };
  Object.assign(window, { blOpen: openMember, blSave: saveMember, blPlans: openPlans, blSavePlans: savePlans, blTarget: setTarget, blFilter: (k, v) => { B.filter[k] = v; renderMembership(); }, __BL: B });

  const MODALS = `
  <div id="modal-bl-member" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-bl-member')"><div class="modal" style="max-width:760px">
    <div class="modal-header"><div><div class="modal-title" id="blm-h">Member</div><div class="modal-sub" id="blm-sub"></div></div><button class="modal-close" onclick="closeModal('modal-bl-member')">✕</button></div>
    <div class="modal-body os-split"><div style="display:flex;flex-direction:column;gap:10px"><input type="hidden" id="blm-id"/>
      <div class="f-group"><label class="f-label" for="blm-org">Organisation</label><input id="blm-org" class="f-input"/></div>
      <div class="f-group"><label class="f-label" for="blm-owner">Relationship owner</label><select id="blm-owner" class="f-input f-select"></select></div>
      <div class="f-grid"><div class="f-group"><label class="f-label" for="blm-na">Next action</label><input id="blm-na" class="f-input"/></div><div class="f-group"><label class="f-label" for="blm-nad">Date</label><input id="blm-nad" type="date" class="f-input"/></div></div>
      <div class="f-grid"><div class="f-group"><label class="f-label" for="blm-score">Engagement score (0–100)</label><input id="blm-score" type="number" min="0" max="100" class="f-input"/></div><div class="f-group"><label class="f-label" for="blm-churn">Churn reason</label><input id="blm-churn" class="f-input" placeholder="If cancelled"/></div></div>
      <div style="font-size:11px;color:var(--white-muted)">Plan, status and dates come from Stripe. Use Billing actions to cancel, resume or invoice; the member can also manage billing themselves.</div></div>
      <div><div class="os-box"><div class="os-box-h">Payments</div><div id="blm-pays"></div></div></div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-bl-member')">Close</button><button class="btn btn-primary" onclick="blSave()">Save</button></div></div></div>
  <div id="modal-bl-plans" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-bl-plans')"><div class="modal modal-lg" style="max-width:820px">
    <div class="modal-header"><div><div class="modal-title">Plans &amp; prices</div><div class="modal-sub">Shown on banahub.com/membership. A changed price creates a new Stripe price on the next checkout; current subscribers keep theirs.</div></div><button class="modal-close" onclick="closeModal('modal-bl-plans')">✕</button></div>
    <div class="modal-body" id="blp-rows" style="display:flex;flex-direction:column;gap:14px"></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-bl-plans')">Cancel</button><button class="btn btn-primary" onclick="blSavePlans()">Save plans</button></div></div></div>`;
  const CSS = `.bl-st{display:inline-block;font-size:10.5px;font-weight:700;border-radius:4px;padding:2px 7px}
  .bl-plan-row{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:end;border:1px solid var(--border);border-radius:10px;padding:12px}
  .bl-plan-row label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:var(--white-muted)}.bl-chk{flex-direction:row!important;align-items:center;gap:6px!important}`;

  const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000);
})();
