/* BANAHUB Admin OS — Payments & Invoices (CEO only). Loaded after admin-billing.js.
 * Everything that touches Stripe goes through the billing-admin Edge Function (admin-checked server-side);
 * this page only reads the mirrored tables (stripe_invoices, transactions, billing_admin_log, stripe_sync_state).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const OS = () => window.__OS || { perms: new Set(), people: [] };
  const sb = () => OS().sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const money = (n, c) => (c || 'SGD') + ' ' + Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const fmtDT = d => d ? new Date(d).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const P = { inv: [], tx: [], log: [], rec: null, status: null, tab: 'invoices', f: { st: 'open', q: '' }, users: [] };
  const IST = { draft: ['Draft', '#555', '#eee'], open: ['Open', '#7a5c00', '#fff4d6'], overdue: ['Overdue', '#8c1d18', '#fdecea'], paid: ['Paid', '#0a5c40', '#e3f1e8'], void: ['Void', '#555', '#eee'], uncollectible: ['Uncollectible', '#8c1d18', '#fdecea'] };
  const istOf = i => i.status === 'open' && i.due_date && new Date(i.due_date) < new Date() ? 'overdue' : i.status;
  const dash = id => id ? `https://dashboard.stripe.com/${P.status && P.status.mode === 'test' ? 'test/' : ''}${id.startsWith('in_') ? 'invoices' : id.startsWith('cus_') ? 'customers' : id.startsWith('sub_') ? 'subscriptions' : 'payments'}/${id}` : '';

  async function call(action, body) {
    const { data, error } = await sb().functions.invoke('billing-admin', { body: Object.assign({ action }, body || {}) });
    if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch (e) {} throw new Error(m); }
    if (data && data.error) throw new Error(data.error);
    return data && 'result' in data ? data.result : data;
  }

  function inject() {
    if ($('panel-os-payments')) return true;
    const anchor = document.querySelector('[data-os-nav="os-membership"]');
    if (!anchor) return !!(window.__OS && window.__OS.sb && !OS().perms.has('*'));
    anchor.insertAdjacentHTML('afterend', '<button class="nav-item" onclick="nav(\'os-payments\')" data-os-nav="os-payments"><span class="nav-icon material-symbols-outlined">receipt_long</span>Payments &amp; Invoices<span class="nav-badge" id="nb-pi-od" style="display:none"></span></button>');
    $('panel-dashboard').parentNode.insertAdjacentHTML('beforeend', '<div id="panel-os-payments" class="panel"></div>');
    document.body.insertAdjacentHTML('beforeend', MODALS);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') panelMeta['os-payments'] = ['Payments & Invoices', 'Stripe invoices, payments, refunds and sync'];
    q(sb().from('revenue_receivables').select('*')).then(r => { const n = r && r[0] ? r[0].overdue_count : 0, el = $('nb-pi-od'); if (el && n) { el.textContent = n; el.style.display = ''; } }).catch(() => {});
    hookMember();
    return true;
  }

  async function load() {
    const [inv, tx, log, rec] = await Promise.all([
      q(sb().from('stripe_invoices').select('*').order('created_at', { ascending: false }).limit(1000)),
      q(sb().from('transactions').select('*').order('created_at', { ascending: false }).limit(1000)),
      q(sb().from('billing_admin_log').select('*').order('created_at', { ascending: false }).limit(100)).catch(() => []),
      q(sb().from('revenue_receivables').select('*')).catch(() => [null]),
    ]);
    P.inv = inv || []; P.tx = tx || []; P.log = log || []; P.rec = (rec || [])[0] || null;
  }
  const head = (t, s, a) => `<div class="page-header"><div><div class="page-title">${t}</div><div class="page-sub">${s}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${a || ''}</div></div>`;
  const kpi = (l, v, s, warn) => `<div class="os-kpi${warn ? ' os-kpi-warn' : ''}"><div class="os-kpi-l">${l}</div><div class="os-kpi-v">${v}</div>${s ? `<div class="os-kpi-s">${s}</div>` : ''}</div>`;

  function connBox() {
    const s = P.status;
    if (!s) return '<div class="pi-conn">Checking Stripe connection…</div>';
    if (s.error) return `<div class="pi-conn pi-bad"><b>Stripe check failed:</b> ${esc(s.error)}</div>`;
    if (!s.configured) return '<div class="pi-conn pi-bad"><b>Stripe not connected.</b> Add <code>STRIPE_SECRET_KEY</code> in Supabase → Edge Functions → Secrets, then reload.</div>';
    const bits = [`<span class="pi-pill ${s.mode === 'live' ? 'pi-live' : 'pi-test'}">${s.mode === 'live' ? 'LIVE' : 'TEST'} mode</span>`,
      s.key_error ? `<span class="pi-bad">Key error: ${esc(s.key_error)}</span>` : `${esc(s.name || s.account || '')} · ${esc((s.country || '').toUpperCase())} · ${esc((s.currency || '').toUpperCase())}`,
      s.key_error ? '' : (s.charges_enabled ? '✓ Payments enabled' : '<span class="pi-bad">Payments not enabled yet — finish account activation in Stripe</span>'),
      s.webhook_secret ? (s.last_event ? `Last webhook ${fmtDT(s.last_event.received_at)}${s.last_event.error ? ' <span class="pi-bad">(error)</span>' : ''}` : 'Webhook ready — no events yet') : '<span class="pi-bad">STRIPE_WEBHOOK_SECRET missing</span>',
      s.sync && s.sync.last_run_at ? `Last sync ${fmtDT(s.sync.last_run_at)}${s.sync.last_ok === false ? ' <span class="pi-bad">(with errors)</span>' : ''}` : 'Never synced'];
    return `<div class="pi-conn ${s.key_error || !s.charges_enabled || !s.webhook_secret ? 'pi-warnbox' : ''}">${bits.filter(Boolean).join(' <span class="pi-dot">·</span> ')}</div>`;
  }

  async function render() {
    const el = $('panel-os-payments');
    el.innerHTML = head('Payments & Invoices', 'Synced with Stripe') + '<div class="os-empty">Loading…</div>';
    try { await load(); } catch (e) { el.innerHTML = head('Payments & Invoices', '') + `<div class="card os-empty">${esc(e.message)} — apply migration 19 first.</div>`; return; }
    if (!P.status) call('status').then(s => { P.status = s; const b = $('pi-conn'); if (b) b.innerHTML = connBox(); }).catch(e => { P.status = { error: e.message }; const b = $('pi-conn'); if (b) b.innerHTML = connBox(); });
    const r = P.rec || {};
    el.innerHTML = head('Payments & Invoices', 'Create, send and settle invoices; refund payments; everything stays in sync with Stripe',
      `<button class="btn btn-ghost" id="pi-sync-btn" onclick="piSync()"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">sync</span> Sync with Stripe</button><button class="btn btn-primary" onclick="piNew()">+ New invoice</button>`) + `
      <div id="pi-conn">${connBox()}</div>
      <div class="os-kpis">${[
        kpi('Outstanding', money(r.open_amount), `${r.open_count || 0} open invoices`),
        kpi('Overdue', money(r.overdue_amount), `${r.overdue_count || 0} past due date`, (r.overdue_count || 0) > 0),
        kpi('Collected MTD', money(r.paid_mtd_amount), `${r.paid_mtd_count || 0} invoices paid, net of refunds`),
        kpi('Drafts', r.draft_count || 0, 'not yet sent'),
      ].join('')}</div>
      <div class="pi-tabs">${[['invoices', 'Invoices'], ['payments', 'Payments'], ['log', 'Activity log']].map(([k, l]) => `<button class="pi-tab ${P.tab === k ? 'on' : ''}" onclick="piTab('${k}')">${l}</button>`).join('')}</div>
      <div id="pi-body"></div>`;
    body();
  }
  function body() {
    const el = $('pi-body'); if (!el) return;
    if (P.tab === 'payments') return el.innerHTML = payments();
    if (P.tab === 'log') return el.innerHTML = logView();
    const f = P.f, qs = f.q.toLowerCase();
    const rows = P.inv.filter(i => (f.st === 'all' || istOf(i) === f.st || (f.st === 'open' && i.status === 'open')) && (!qs || [i.number, i.customer_email, i.customer_name, i.description, i.id].join(' ').toLowerCase().includes(qs)));
    el.innerHTML = `<div class="filter-bar" style="flex-wrap:wrap">
        <select class="f-input f-select" style="width:180px" onchange="piF('st',this.value)">${[['open', 'Open (incl. overdue)'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['draft', 'Drafts'], ['void', 'Void'], ['uncollectible', 'Uncollectible'], ['all', 'All']].map(([v, l]) => `<option value="${v}" ${v === f.st ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="f-input" style="max-width:280px" placeholder="Search number, customer, description…" value="${esc(f.q)}" oninput="piF('q',this.value)"/>
        <span style="margin-left:auto;font-size:12px;color:var(--white-muted)">${rows.length} invoices</span></div>
      <div class="card" style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Description</th><th>Amount</th><th>Status</th><th>Due / paid</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 300).map(i => { const s = IST[istOf(i)] || [i.status, '#555', '#eee'];
        return `<tr><td><b style="color:var(--ink)">${esc(i.number || 'Draft')}</b><div style="font-size:11px;color:var(--white-muted)">${fmtD(i.created_at)} · ${esc(i.revenue_source || '')}${i.collection_method === 'charge_automatically' ? ' · auto-charge' : ''}</div></td>
          <td style="font-size:12px"><b>${esc(i.customer_name || '')}</b><div>${esc(i.customer_email || '')}</div></td>
          <td style="font-size:12px;max-width:260px">${esc(i.description || (i.lines || []).map(l => l.description).join('; '))}</td>
          <td><b>${money(i.total, i.currency)}</b>${i.status === 'open' && i.amount_remaining !== i.total ? `<div style="font-size:11px">${money(i.amount_remaining, i.currency)} due</div>` : ''}${i.amount_refunded > 0 ? `<div class="os-flag">refunded ${money(i.amount_refunded, i.currency)}</div>` : ''}</td>
          <td><span class="bl-st" style="color:${s[1]};background:${s[2]}">${s[0]}</span>${i.paid_out_of_band ? '<div style="font-size:10.5px;color:var(--white-muted)">paid outside Stripe</div>' : i.payment_method ? `<div style="font-size:10.5px;color:var(--white-muted)">${esc(i.payment_method)}</div>` : ''}</td>
          <td style="font-size:12px">${i.status === 'paid' ? 'Paid ' + fmtD(i.paid_at) : i.due_date ? 'Due ' + fmtD(i.due_date) : '—'}</td>
          <td style="white-space:nowrap">${actions(i)}</td></tr>`; }).join('') || '<tr><td colspan="7"><div class="os-empty">No invoices in this view. Use “Sync with Stripe” to pull existing invoices.</div></td></tr>'}
      </tbody></table></div>`;
  }
  function actions(i) {
    const b = (l, fn, cls) => `<button class="btn btn-ghost pi-act ${cls || ''}" onclick="${fn}">${l}</button>`;
    const a = [];
    if (i.hosted_invoice_url) a.push(`<a class="btn btn-ghost pi-act" href="${esc(i.hosted_invoice_url)}" target="_blank" rel="noopener">View</a>`);
    if (i.invoice_pdf) a.push(`<a class="btn btn-ghost pi-act" href="${esc(i.invoice_pdf)}" target="_blank" rel="noopener">PDF</a>`);
    if (i.status === 'draft') a.push(b('Send', `piDo('send','${i.id}')`), b('Delete', `piDo('delete_draft','${i.id}')`, 'pi-danger'));
    if (i.status === 'open') { if (i.collection_method === 'send_invoice') a.push(b('Resend', `piDo('send','${i.id}')`)); a.push(b('Mark paid', `piPaid('${i.id}')`), b('Void', `piDo('void','${i.id}')`, 'pi-danger')); }
    if (i.status === 'paid' && !i.paid_out_of_band && i.amount_refunded < i.amount_paid) a.push(b('Refund', `piRefund('${i.id}')`, 'pi-danger'));
    a.push(`<a class="btn btn-ghost pi-act" href="${dash(i.id)}" target="_blank" rel="noopener" title="Open in Stripe">↗</a>`);
    return a.join('');
  }
  function payments() {
    const tx = P.tx.filter(t => ['completed', 'paid', 'partially_refunded', 'refunded'].includes(t.status));
    return `<div class="card" style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>Date</th><th>Payer</th><th>For</th><th>Method</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${tx.slice(0, 300).map(t => `<tr><td>${fmtD(t.paid_at || t.created_at)}</td><td style="font-size:12px">${esc(t.email || '—')}</td>
        <td style="font-size:12px;text-transform:capitalize">${esc(t.revenue_source || t.item_type || t.type || '')}${t.plan_code ? ' · ' + esc(t.plan_code) : ''}${t.description ? `<div style="text-transform:none;color:var(--white-muted)">${esc(t.description)}</div>` : ''}</td>
        <td>${esc(t.payment_method || '—')}</td><td><b>${money(t.amount, t.currency)}</b>${t.amount_refunded > 0 ? `<div class="os-flag">refunded ${money(t.amount_refunded, t.currency)}</div>` : ''}</td>
        <td>${esc(t.status)}</td>
        <td style="white-space:nowrap">${(t.stripe_charge_id || t.stripe_invoice_id) && t.status !== 'refunded' && t.payment_method !== 'out_of_band' ? `<button class="btn btn-ghost pi-act pi-danger" onclick="piRefund('${esc(t.stripe_invoice_id || '')}','${esc(t.stripe_charge_id || '')}')">Refund</button>` : ''}${t.stripe_charge_id ? `<a class="btn btn-ghost pi-act" href="${dash(t.stripe_payment_intent_id || t.stripe_charge_id)}" target="_blank" rel="noopener">↗</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="7"><div class="os-empty">No payments yet.</div></td></tr>'}
      </tbody></table></div>`;
  }
  function logView() {
    const who = id => (OS().people.find(p => p.id === id) || {}).full_name || 'Admin';
    return `<div class="card" style="overflow-x:auto"><table class="data-table os-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Result</th></tr></thead><tbody>
      ${P.log.map(l => `<tr><td style="font-size:12px">${fmtDT(l.created_at)}</td><td style="font-size:12px">${esc(who(l.admin_id))}</td><td>${esc(l.action.replace(/_/g, ' '))}</td><td style="font-size:12px">${esc(l.target || '')}</td><td style="font-size:12px">${l.ok ? '✓' : `<span style="color:#b3261e">${esc(l.error || 'failed')}</span>`}</td></tr>`).join('') || '<tr><td colspan="5"><div class="os-empty">No billing actions yet.</div></td></tr>'}
      </tbody></table></div>`;
  }

  // ── actions ──────────────────────────────────────────────────────────────
  const CONFIRM = { void: 'Void this invoice? The customer can no longer pay it.', delete_draft: 'Delete this draft invoice?', send: 'Email this invoice to the customer now?' };
  async function doAct(action, id) {
    if (CONFIRM[action] && !confirm(CONFIRM[action])) return;
    try { await call(action, { invoice_id: id }); notify({ send: 'Invoice sent', void: 'Invoice voided', delete_draft: 'Draft deleted' }[action] || 'Done'); render(); } catch (e) { notify(e.message, 'warn'); }
  }
  async function markPaid(id) {
    const note = prompt('Mark as paid outside Stripe (bank transfer, cheque).\nReference / note (optional):', '');
    if (note == null) return;
    try { await call('mark_paid', { invoice_id: id, note }); notify('Marked paid'); render(); } catch (e) { notify(e.message, 'warn'); }
  }
  function openRefund(inv, charge) {
    const i = P.inv.find(x => x.id === inv), t = P.tx.find(x => (inv && x.stripe_invoice_id === inv) || (charge && x.stripe_charge_id === charge));
    const total = i ? i.amount_paid - (i.amount_refunded || 0) : t ? t.amount - (t.amount_refunded || 0) : null, cur = (i || t || {}).currency || 'SGD';
    $('pir-inv').value = inv || ''; $('pir-ch').value = charge || ''; $('pir-amt').value = ''; $('pir-amt').placeholder = total != null ? `Full refund: ${total}` : 'Full refund';
    $('pir-sub').textContent = `${(i && (i.number || i.customer_email)) || (t && t.email) || ''} — refundable ${total != null ? money(total, cur) : ''}`;
    $('modal-pi-refund').style.display = 'flex';
  }
  async function doRefund() {
    const amt = $('pir-amt').value.trim();
    if (!confirm(`Refund ${amt ? amt : 'the full amount'}? This sends money back to the customer and can't be undone.`)) return;
    const btn = $('pir-go'); btn.disabled = true;
    try { const r = await call('refund', { invoice_id: $('pir-inv').value || undefined, charge_id: $('pir-ch').value || undefined, amount: amt || null, reason: $('pir-reason').value }); notify(`Refunded ${r.amount}`); closeModal('modal-pi-refund'); render(); }
    catch (e) { notify(e.message, 'warn'); } finally { btn.disabled = false; }
  }
  async function sync() {
    const btn = $('pi-sync-btn'); if (btn) { btn.disabled = true; btn.lastChild.textContent = ' Syncing…'; }
    try { const r = await call('sync'); P.status = null; notify(`Synced: ${r.invoices} invoices, ${r.subscriptions} subscriptions, ${r.payments} payments${r.errors && r.errors.length ? ` — ${r.errors.length} errors (see log)` : ''}`, r.errors && r.errors.length ? 'warn' : 'success'); render(); }
    catch (e) { notify(e.message, 'warn'); if (btn) { btn.disabled = false; btn.lastChild.textContent = ' Sync with Stripe'; } }
  }

  // ── new invoice ──────────────────────────────────────────────────────────
  async function openNew(userId) {
    try { if (!P.users.length) P.users = await q(sb().from('users').select('id,email,full_name,company_name').order('full_name').limit(2000)); } catch (e) {}
    $('pin-user').innerHTML = '<option value="">— Not a member: enter email below —</option>' + P.users.map(u => `<option value="${u.id}" ${u.id === userId ? 'selected' : ''}>${esc((u.full_name || u.email) + (u.company_name ? ' · ' + u.company_name : '') + (u.full_name ? ' · ' + u.email : ''))}</option>`).join('');
    ['pin-email', 'pin-name', 'pin-memo'].forEach(id => { $(id).value = ''; });
    $('pin-items').innerHTML = ''; addLine(); $('pin-cur').value = 'SGD'; $('pin-days').value = 7; $('pin-src').value = 'advisory';
    $('pin-pn').checked = true; $('pin-cd').checked = true; $('pin-send').checked = true; whoChanged(); total();
    $('modal-pi-new').style.display = 'flex';
  }
  function addLine() {
    $('pin-items').insertAdjacentHTML('beforeend', `<div class="pi-line"><input class="f-input" data-k="d" placeholder="Description, e.g. GTM advisory — October" oninput="piTotal()"/><input class="f-input" data-k="q" type="number" min="1" value="1" oninput="piTotal()"/><input class="f-input" data-k="a" type="number" min="0" step="0.01" placeholder="Unit price" oninput="piTotal()"/><button class="btn btn-ghost pi-act" onclick="this.parentNode.remove();piTotal()" aria-label="Remove line">✕</button></div>`);
  }
  const lines = () => [...document.querySelectorAll('#pin-items .pi-line')].map(r => ({ description: r.querySelector('[data-k=d]').value.trim(), quantity: +r.querySelector('[data-k=q]').value || 1, amount: +r.querySelector('[data-k=a]').value || 0 }));
  function total() { const t = lines().reduce((a, l) => a + l.amount * l.quantity, 0); $('pin-total').textContent = money(t, $('pin-cur').value); const sgd = $('pin-cur').value === 'SGD'; $('pin-pn').disabled = !sgd; if (!sgd) $('pin-pn').checked = false; }
  function whoChanged() { const m = !!$('pin-user').value; $('pin-ext').style.display = m ? 'none' : ''; }
  async function createInv() {
    const items = lines().filter(l => l.description && l.amount > 0);
    if (!items.length) return notify('Add a line with a description and price', 'warn');
    const user_id = $('pin-user').value || null, email = $('pin-email').value.trim();
    if (!user_id && !email) return notify('Pick a member or enter an email', 'warn');
    const methods = [$('pin-pn').checked && 'paynow', $('pin-cd').checked && 'card'].filter(Boolean);
    if (!methods.length) return notify('Choose at least one payment method', 'warn');
    const send = $('pin-send').checked, btn = $('pin-go'); btn.disabled = true;
    try {
      const r = await call('create_invoice', { user_id, email, name: $('pin-name').value.trim(), items, currency: $('pin-cur').value, days_until_due: +$('pin-days').value || 7, methods, revenue_source: $('pin-src').value, memo: $('pin-memo').value.trim(), send });
      notify(send ? `Invoice ${r.number || ''} emailed to ${r.customer_email}` : 'Draft saved'); closeModal('modal-pi-new'); P.tab = 'invoices'; P.f.st = send ? 'open' : 'draft';
      if ($('panel-os-payments') && $('panel-os-payments').classList.contains('active')) render(); else window.nav && nav('os-payments');
    } catch (e) { notify(e.message, 'warn'); } finally { btn.disabled = false; }
  }

  // ── member modal: subscription controls ──────────────────────────────────
  function hookMember() {
    const orig = window.blOpen; if (!orig || orig.__pi) return;
    const wrapped = function (uid) {
      orig(uid);
      const m = ((window.__BL || {}).members || []).find(x => x.user_id === uid); const box = $('blm-pays'); if (!m || !box) return;
      const old = $('blm-actions'); if (old) old.remove();
      const b = (l, fn, cls) => `<button class="btn btn-ghost pi-act ${cls || ''}" onclick="${fn}">${l}</button>`;
      const acts = [b('New invoice', `closeModal('modal-bl-member');piNew('${uid}')`)];
      if (m.stripe_customer_id) acts.push(b('Billing portal link', `piPortal('${uid}')`), `<a class="btn btn-ghost pi-act" href="${dash(m.stripe_customer_id)}" target="_blank" rel="noopener">Stripe ↗</a>`);
      if (m.stripe_subscription_id && !['canceled', 'expired'].includes(m.status)) {
        if (m.cancel_at_period_end) acts.push(b('Resume renewal', `piSub('resume_subscription','${uid}')`));
        else acts.push(b('Cancel at period end', `piSub('cancel_end','${uid}')`, 'pi-danger'));
        acts.push(b('Cancel now', `piSub('cancel_now','${uid}')`, 'pi-danger'));
      }
      box.parentNode.insertAdjacentHTML('afterend', `<div class="os-box" id="blm-actions" style="margin-top:10px"><div class="os-box-h">Billing actions</div><div style="display:flex;flex-wrap:wrap;gap:6px">${acts.join('')}</div></div>`);
    };
    wrapped.__pi = true; window.blOpen = wrapped;
  }
  async function subAct(kind, uid) {
    const msg = { cancel_end: 'Stop renewal? The member keeps access until the end of the paid period.', cancel_now: 'Cancel immediately? Access ends now and no refund is issued automatically.', resume_subscription: 'Resume automatic renewal?' }[kind];
    if (!confirm(msg)) return;
    try {
      await call(kind === 'resume_subscription' ? 'resume_subscription' : 'cancel_subscription', { user_id: uid, at_period_end: kind !== 'cancel_now' });
      notify('Subscription updated'); closeModal('modal-bl-member'); window.loadPanel && loadPanel('os-membership');
    } catch (e) { notify(e.message, 'warn'); }
  }
  async function portal(uid) {
    try { const r = await call('portal_link', { user_id: uid }); try { await navigator.clipboard.writeText(r.url); notify('Billing portal link copied — valid for a short time; send it to the member'); } catch (e) { prompt('Billing portal link (send to the member):', r.url); } }
    catch (e) { notify(e.message, 'warn'); }
  }

  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'os-payments') { inject(); return render(); } return prev && prev(p); };
  Object.assign(window, { piSync: sync, piNew: openNew, piTab: k => { P.tab = k; render(); }, piF: (k, v) => { P.f[k] = v; body(); }, piDo: doAct, piPaid: markPaid, piRefund: openRefund, piDoRefund: doRefund,
    piAddLine: addLine, piTotal: total, piWho: whoChanged, piCreate: createInv, piSub: subAct, piPortal: portal, __PI: P });

  const MODALS = `
  <div id="modal-pi-new" class="modal-overlay" style="display:none;z-index:1060" onclick="if(event.target===this)closeModal('modal-pi-new')"><div class="modal modal-lg" style="max-width:780px">
    <div class="modal-header"><div><div class="modal-title">New invoice</div><div class="modal-sub">Created in Stripe and emailed with a pay link — PayNow QR and/or card</div></div><button class="modal-close" onclick="closeModal('modal-pi-new')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
      <div class="f-group"><label class="f-label" for="pin-user">Bill to</label><select id="pin-user" class="f-input f-select" onchange="piWho()"></select></div>
      <div class="f-grid" id="pin-ext"><div class="f-group"><label class="f-label" for="pin-email">Email</label><input id="pin-email" type="email" class="f-input" placeholder="billing@company.com"/></div><div class="f-group"><label class="f-label" for="pin-name">Name / company</label><input id="pin-name" class="f-input"/></div></div>
      <div><div class="f-label" style="margin-bottom:6px">Items</div><div class="pi-line pi-lh"><span>Description</span><span>Qty</span><span>Unit price</span><span></span></div><div id="pin-items"></div><button class="btn btn-ghost pi-act" style="margin-top:6px" onclick="piAddLine()">+ Add line</button></div>
      <div class="f-grid">
        <div class="f-group"><label class="f-label" for="pin-cur">Currency</label><select id="pin-cur" class="f-input f-select" onchange="piTotal()">${['SGD', 'USD', 'EUR', 'GBP', 'AUD', 'AED', 'MYR'].map(c => `<option>${c}</option>`).join('')}</select></div>
        <div class="f-group"><label class="f-label" for="pin-days">Due in (days)</label><input id="pin-days" type="number" min="1" max="90" class="f-input"/></div>
        <div class="f-group"><label class="f-label" for="pin-src">Revenue type</label><select id="pin-src" class="f-input f-select">${[['advisory', 'Advisory'], ['programme', 'Programme'], ['event', 'Event'], ['sponsorship', 'Sponsorship'], ['membership', 'Membership'], ['other', 'Other']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      </div>
      <div class="f-group"><label class="f-label" for="pin-memo">Memo on invoice (optional)</label><input id="pin-memo" class="f-input" placeholder="e.g. Thank you for your business"/></div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:13px">
        <label><input type="checkbox" id="pin-pn"/> PayNow (SGD only)</label><label><input type="checkbox" id="pin-cd"/> Card</label>
        <label><input type="checkbox" id="pin-send"/> Email it now</label><span style="margin-left:auto">Total <b id="pin-total"></b></span></div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-pi-new')">Cancel</button><button class="btn btn-primary" id="pin-go" onclick="piCreate()">Create invoice</button></div></div></div>
  <div id="modal-pi-refund" class="modal-overlay" style="display:none;z-index:1060" onclick="if(event.target===this)closeModal('modal-pi-refund')"><div class="modal" style="max-width:460px">
    <div class="modal-header"><div><div class="modal-title">Refund payment</div><div class="modal-sub" id="pir-sub"></div></div><button class="modal-close" onclick="closeModal('modal-pi-refund')">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:10px"><input type="hidden" id="pir-inv"/><input type="hidden" id="pir-ch"/>
      <div class="f-group"><label class="f-label" for="pir-amt">Amount (leave blank for full refund)</label><input id="pir-amt" type="number" min="0" step="0.01" class="f-input"/></div>
      <div class="f-group"><label class="f-label" for="pir-reason">Reason</label><select id="pir-reason" class="f-input f-select"><option value="requested_by_customer">Requested by customer</option><option value="duplicate">Duplicate</option><option value="fraudulent">Fraudulent</option></select></div>
      <div style="font-size:11px;color:var(--white-muted)">Refunding does not cancel a membership. Cancel it from Membership if needed.</div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-pi-refund')">Cancel</button><button class="btn btn-primary" id="pir-go" style="background:#b3261e;border-color:#b3261e" onclick="piDoRefund()">Refund</button></div></div></div>`;
  const CSS = `.pi-conn{font-size:12.5px;border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;background:var(--card,#fff);line-height:1.7}
  .pi-warnbox{border-color:#e8c14a;background:#fffaf0}.pi-bad{color:#b3261e;font-weight:600}.pi-dot{color:var(--white-muted)}
  .pi-pill{display:inline-block;font-size:10.5px;font-weight:800;border-radius:4px;padding:1px 7px;letter-spacing:.04em}.pi-live{background:#e3f1e8;color:#0a5c40}.pi-test{background:#fff4d6;color:#7a5c00}
  .pi-tabs{display:flex;gap:4px;margin:6px 0 12px;border-bottom:1px solid var(--border)}.pi-tab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;font-weight:700;font-size:13px;color:var(--white-muted);cursor:pointer}.pi-tab.on{color:var(--ink);border-bottom-color:var(--ink)}
  .pi-act{padding:3px 8px!important;font-size:11.5px!important;min-height:0!important;margin:1px}.pi-danger{color:#b3261e!important}
  .pi-line{display:grid;grid-template-columns:minmax(0,1fr) 70px 120px 34px;gap:6px;margin-bottom:6px;align-items:center}.pi-lh{font-size:11px;font-weight:700;color:var(--white-muted);margin-bottom:2px}
  @media(max-width:640px){.pi-line{grid-template-columns:minmax(0,1fr) 56px 90px 30px}}`;

  const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000);
})();
