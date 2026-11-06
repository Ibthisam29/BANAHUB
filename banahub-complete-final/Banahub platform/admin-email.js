/* BANAHUB Admin OS — Email Campaigns.
 * Send fundraising campaigns, event invites, programme updates, sponsorship / partnership invites and newsletters
 * to selected audiences (FundMatch members by category, investor database by type, CRM, subscribers, companies, manual).
 * Sending runs in the `email-campaign` edge function (Resend). Ben can draft subject + content when his AI is live;
 * built-in professional templates always work (no AI cost).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const OS = () => window.__OS || {};
  const sb = () => OS().sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  async function fn(body) {
    const { data, error } = await sb().functions.invoke('email-campaign', { body });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) { } throw new Error(m); }
    if (data && data.error) throw new Error(data.error); return data || {};
  }
  const fmtDT = d => d ? new Date(d).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const E = { list: [], status: null, cur: null, opts: { member_categories: [], investor_types: [], crm_types: [] }, tab: 'campaigns', processed: false };

  const KINDS = { fundraising: ['Fundraising campaign', 'rocket_launch'], event: ['Event invite', 'event'], programme: ['Programme update', 'hub'], sponsorship: ['Sponsorship invite', 'workspace_premium'], partnership: ['Partnership invite', 'handshake'], newsletter: ['Newsletter', 'newspaper'], other: ['Other', 'mail'] };
  const BTN = (txt, url) => `<p style="margin:22px 0"><a href="${url}" style="display:inline-block;background:#003527;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${txt}</a></p>`;
  const TPL = {
    fundraising: { subject: 'Investment opportunity: {{company}} — introductions now open', pre: 'A curated opportunity from the BANAHUB network', body: `<p>Dear {{first_name}},</p><p>BANAHUB is running a capital raise campaign for <strong>[Company]</strong>, a <strong>[stage]</strong> <strong>[sector]</strong> company headquartered in <strong>[country]</strong>.</p><h3>At a glance</h3><ul><li><strong>Raising:</strong> [amount and instrument]</li><li><strong>Traction:</strong> [key metric]</li><li><strong>Use of funds:</strong> [top 2–3 uses]</li><li><strong>Why now:</strong> [one line]</li></ul><p>If this fits your mandate, reply to this email and we will share the deck and arrange a call with the founders.</p>${BTN('Request the deck', 'mailto:hello@banahub.com?subject=Deck%20request')}<p>Warm regards,<br>The BANAHUB team</p>` },
    event: { subject: "You're invited: [Event name], [date] in [city]", pre: 'Founders, investors and family offices in one room', body: `<p>Dear {{first_name}},</p><p>We'd like to invite you to <strong>[Event name]</strong> on <strong>[date, time]</strong> at <strong>[venue]</strong>.</p><p>[One-paragraph description: who will be there, what the session covers, why it matters.]</p><ul><li>[Speaker / panel highlight]</li><li>[Curated founder showcase / networking]</li><li>[Capacity — invitation only]</li></ul>${BTN('Reserve your place', 'https://banahub.com/events')}<p>We look forward to seeing you there.<br>The BANAHUB team</p>` },
    programme: { subject: '[Programme name] — update and next steps', pre: "What's new and what's coming up", body: `<p>Dear {{first_name}},</p><p>Here's the latest on <strong>[Programme name]</strong>.</p><h3>Highlights</h3><ul><li>[Milestone / cohort news]</li><li>[New mentor / partner]</li><li>[Upcoming session]</li></ul><h3>Next steps</h3><p>[What participants or applicants should do next, with dates.]</p>${BTN('View programme details', 'https://banahub.com/programs')}<p>Best regards,<br>The BANAHUB team</p>` },
    sponsorship: { subject: 'Sponsorship opportunity: [Event / programme] — reach [audience]', pre: 'Put your brand in front of founders, investors and family offices', body: `<p>Dear {{first_name}},</p><p>We'd like to invite <strong>{{company}}</strong> to partner with BANAHUB as a sponsor of <strong>[Event / programme]</strong> on <strong>[date]</strong>.</p><h3>Who you'll reach</h3><ul><li>[Number] founders, investors, family offices and corporate leaders</li><li>Focus markets: Southeast Asia, the Gulf and North Asia</li></ul><h3>Sponsorship packages</h3><ul><li><strong>Gold</strong> — [benefits]</li><li><strong>Silver</strong> — [benefits]</li><li><strong>Bronze</strong> — [benefits]</li></ul><p>Would you be open to a 20-minute call next week to explore fit?</p>${BTN('Book a call', 'mailto:hello@banahub.com?subject=Sponsorship')}<p>Kind regards,<br>The BANAHUB team</p>` },
    partnership: { subject: 'Partnership proposal: BANAHUB × {{company}}', pre: 'Exploring a strategic collaboration', body: `<p>Dear {{first_name}},</p><p>BANAHUB helps companies expand into Southeast Asia, the Gulf and North Asia and prepares founders for investment. We see a strong fit with <strong>{{company}}</strong>.</p><h3>What we propose</h3><ul><li>[Joint programme / referral partnership / co-hosted events]</li><li>[Value for your clients or members]</li><li>[Value for BANAHUB's network]</li></ul><p>If this resonates, could we schedule a short call to discuss next steps?</p>${BTN('Reply to discuss', 'mailto:hello@banahub.com?subject=Partnership')}<p>Best regards,<br>The BANAHUB team</p>` },
    newsletter: { subject: 'BANAHUB Briefing — [Month Year]', pre: 'Market moves, capital and opportunities across our markets', body: `<p>Dear {{first_name}},</p><p>Here is your BANAHUB briefing for <strong>[Month]</strong>.</p><h3>Market pulse</h3><p>[2–3 sentences on a key trend in SEA / GCC / North Asia.]</p><h3>On the platform</h3><ul><li>[New programme / event]</li><li>[Member highlight]</li><li>[Resource or article]</li></ul><h3>Coming up</h3><p>[Upcoming dates.]</p>${BTN('Read more on BANAHUB', 'https://banahub.com/insights')}<p>Until next time,<br>The BANAHUB team</p>` },
    other: { subject: '', pre: '', body: '<p>Dear {{first_name}},</p><p></p><p>Best regards,<br>The BANAHUB team</p>' },
  };
  const SOURCES = [['members', 'FundMatch members', 'Approved members by category'], ['investors', 'Investor database', 'Imported investors — gets <ADV> label'], ['crm', 'CRM contacts', 'Your CRM — gets <ADV> label'], ['subscribers', 'Newsletter subscribers', 'Opted-in subscribers'], ['companies', 'Company directory', 'Directory contacts'], ['manual', 'Paste emails', 'Any addresses — gets <ADV> label']];

  function inject() {
    if ($('panel-emails')) return true;
    const host = $('panel-dashboard'); if (!host) return false;
    host.parentNode.insertAdjacentHTML('beforeend', '<div id="panel-emails" class="panel"></div>');
    document.body.insertAdjacentHTML('beforeend', MODAL);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') panelMeta.emails = ['Email Campaigns', 'Fundraising campaigns, events, programmes, sponsorship & partnership invites, newsletters'];
    return true;
  }

  async function load() {
    const P = $('panel-emails'); P.innerHTML = '<div class="os-empty">Loading…</div>';
    try {
      const [list, status, cats, types, crm] = await Promise.all([
        q(sb().from('email_campaigns').select('*').order('created_at', { ascending: false }).limit(200)).catch(e => { if (/does not exist|schema cache/i.test(e.message)) throw new Error('Email tables are not set up yet — apply database migration 31 (email campaigns).'); throw e; }),
        fn({ action: 'status' }).catch(e => ({ error: e.message })),
        q(sb().from('users').select('member_category').neq('role', 'admin').limit(5000)).catch(() => []),
        q(sb().from('investors').select('investor_type').not('email', 'is', null).limit(5000)).catch(() => []),
        q(sb().from('crm_contacts').select('contact_type').limit(5000)).catch(() => []),
      ]);
      E.list = list || []; E.status = status;
      E.opts.member_categories = [...new Set((cats || []).map(r => r.member_category || 'Uncategorised'))].sort();
      E.opts.investor_types = [...new Set((types || []).map(r => r.investor_type || 'Uncategorised'))].sort();
      E.opts.crm_types = [...new Set((crm || []).map(r => r.contact_type || 'Uncategorised'))].sort();
      draw();
    } catch (e) { P.innerHTML = `<div class="card os-empty">${esc(e.message)}</div>`; }
  }
  function draw() {
    const P = $('panel-emails'), S = E.status || {};
    const prov = S.error ? `<span style="color:#a3261d">${esc(S.error)}</span>` : S.provider_ready ? `<b style="color:#0a5c40">Connected</b> · sending as ${esc(S.from)}` : '<b style="color:#a3261d">Not connected</b> — add <code>RESEND_API_KEY</code> in Supabase → Edge Functions → Secrets (you can still write, test-preview and schedule)';
    const pill = s => `<span class="em-pill em-${s}">${esc(s)}</span>`;
    P.innerHTML = `
      <div class="card" style="padding:14px;margin-bottom:14px"><div class="em-row"><span class="material-symbols-outlined" style="color:#003527">mail</span><span>${prov}</span><span style="flex:1"></span>
        ${S.provider_ready ? `<span class="em-m">Today ${S.sent_today}/${S.daily_cap} · Month ${S.sent_month}/${S.monthly_cap}</span>` : ''}
        <button class="btn btn-primary btn-sm" onclick="emNew()"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">add</span> New campaign</button></div></div>
      <div class="em-tabs"><button class="${E.tab === 'campaigns' ? 'on' : ''}" onclick="emTab('campaigns')">Campaigns</button><button class="${E.tab === 'suppressed' ? 'on' : ''}" onclick="emTab('suppressed')">Unsubscribes & suppression</button></div>
      <div id="em-body">${E.tab === 'campaigns' ? (E.list.length ? `<div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Recipients</th><th>Sent</th><th>When</th><th></th></tr></thead><tbody>
        ${E.list.map(c => `<tr><td><b>${esc(c.name)}</b><div class="em-m">${esc(c.subject || '(no subject)')}</div></td><td>${esc((KINDS[c.kind] || KINDS.other)[0])}</td><td>${pill(c.status)}</td><td>${c.recipients_count || '—'}</td><td>${c.sent_count || 0}${c.failed_count ? ` <span style="color:#a3261d">· ${c.failed_count} failed</span>` : ''}</td><td class="em-m">${c.status === 'scheduled' ? 'Scheduled ' + fmtDT(c.scheduled_at) : c.sent_at ? 'Sent ' + fmtDT(c.sent_at) : c.started_at ? 'Started ' + fmtDT(c.started_at) : 'Edited ' + fmtDT(c.updated_at)}</td>
          <td style="white-space:nowrap">${['draft', 'scheduled', 'failed'].includes(c.status) ? `<button class="btn btn-primary btn-sm" onclick="emOpen('${c.id}')">Edit</button>` : `<button class="btn btn-ghost btn-sm" onclick="emReport('${c.id}')">Report</button>`} <button class="btn btn-ghost btn-sm" onclick="emDup('${c.id}')" title="Duplicate">⧉</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="card os-empty">No campaigns yet. <a href="#" onclick="emNew();return false">Create your first campaign</a> — fundraising, event, programme, sponsorship, partnership or newsletter.</div>`) : '<div class="os-empty">Loading…</div>'}</div>`;
    if (E.tab === 'suppressed') drawSuppressed();
    if (!E.processed && S.provider_ready) { E.processed = true; fn({ action: 'process' }).then(r => { if (r.processed) { notify(`Sent ${r.processed} queued email(s)`); load(); } }).catch(() => { }); }
  }
  async function drawSuppressed() {
    const rows = await q(sb().from('email_suppressions').select('*').order('created_at', { ascending: false }).limit(1000)).catch(() => []);
    $('em-body').innerHTML = `<div class="card" style="padding:14px;margin-bottom:10px"><div class="em-row"><input id="em-sup-add" class="f-input" style="max-width:320px" placeholder="email@company.com"/><button class="btn btn-ghost btn-sm" onclick="emSupAdd()">Add to suppression list</button><span class="em-m">Suppressed addresses never receive campaigns. Unsubscribes are added automatically.</span></div></div>
      ${rows.length ? `<div class="card" style="padding:0"><table class="data-table"><thead><tr><th>Email</th><th>Reason</th><th>Since</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(r.reason)}</td><td>${fmtDT(r.created_at)}</td><td>${r.reason === 'manual' ? `<button class="btn btn-ghost btn-sm" onclick="emSupDel('${esc(r.email)}')">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card os-empty">Nobody has unsubscribed.</div>'}`;
  }

  /* ---------- composer ---------- */
  function blank(kind) { const t = TPL[kind || 'newsletter']; return { id: null, name: '', kind: kind || 'newsletter', subject: t.subject, preheader: t.pre, body_html: t.body, from_name: 'BANAHUB', reply_to: '', audience: { sources: ['members'], member_status: ['approved'], member_categories: [], investor_types: [], crm_types: [], manual: '' }, status: 'draft' }; }
  function openComposer(c) {
    E.cur = c; const a = c.audience || {};
    $('em-h').textContent = c.id ? 'Edit campaign' : 'New campaign';
    $('em-form').innerHTML = `
      <div class="em-sec">1 · Type</div>
      <div class="em-kinds">${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="em-kind ${c.kind === k ? 'on' : ''}" onclick="emKind('${k}')"><span class="material-symbols-outlined">${v[1]}</span>${v[0]}</button>`).join('')}</div>
      <div class="em-sec">2 · Audience</div>
      <div class="em-src">${SOURCES.map(([k, l, d]) => `<label class="em-srcbox ${(a.sources || []).includes(k) ? 'on' : ''}"><input type="checkbox" value="${k}" ${(a.sources || []).includes(k) ? 'checked' : ''} onchange="emSrc(this)"/><b>${l}</b><span>${esc(d)}</span></label>`).join('')}</div>
      <div id="em-filters">${filters(a)}</div>
      <div class="em-row" style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" onclick="emPreviewAud()">Count recipients</button><span id="em-aud" class="em-m"></span></div>
      <div class="em-sec">3 · Message</div>
      <div class="em-grid"><label>Campaign name (internal)<input id="em-name" class="f-input" maxlength="120" value="${esc(c.name)}" placeholder="e.g. Nov investor update — PayLah raise"/></label>
        <label>From name<input id="em-from" class="f-input" maxlength="60" value="${esc(c.from_name || 'BANAHUB')}"/></label>
        <label style="grid-column:1/-1">Subject<input id="em-subj" class="f-input" maxlength="200" value="${esc(c.subject)}"/></label>
        <label style="grid-column:1/-1">Preview text <span class="em-m">(shown after the subject in the inbox)</span><input id="em-pre" class="f-input" maxlength="150" value="${esc(c.preheader || '')}"/></label>
        <label>Reply-to <span class="em-m">(optional)</span><input id="em-reply" class="f-input" maxlength="200" value="${esc(c.reply_to || '')}" placeholder="ibthisam@banahub.com"/></label></div>
      <div class="em-toolbar">
        <button type="button" onclick="emCmd('bold')"><b>B</b></button><button type="button" onclick="emCmd('italic')"><i>I</i></button>
        <button type="button" onclick="emCmd('formatBlock','h2')">H2</button><button type="button" onclick="emCmd('formatBlock','h3')">H3</button><button type="button" onclick="emCmd('formatBlock','p')">¶</button>
        <button type="button" onclick="emCmd('insertUnorderedList')">• List</button><button type="button" onclick="emLink()">Link</button><button type="button" onclick="emButton()">Button</button>
        <select onchange="if(this.value){emInsert(this.value);this.value=''}"><option value="">Personalise…</option><option value="{{first_name}}">First name</option><option value="{{name}}">Full name</option><option value="{{company}}">Company</option></select>
        <select id="em-insert-data" onchange="emInsertData(this.value);this.value=''"><option value="">Insert from BANAHUB…</option></select>
        <span style="flex:1"></span>
        <button type="button" class="em-ben" onclick="emBen()">✦ Draft with Ben</button>
        <button type="button" onclick="emHtml()" id="em-htmlbtn">HTML</button></div>
      <div id="em-editor" class="em-editor" contenteditable="true">${c.body_html || ''}</div>
      <textarea id="em-html" class="f-input em-htmlbox" style="display:none"></textarea>
      <div class="em-m" style="margin-top:6px">A compliant footer is added automatically: company & UEN, why they're receiving it, a no-financial-advice note and an unsubscribe link. Imported / CRM / pasted contacts get an "&lt;ADV&gt;" subject label (Singapore Spam Control Act).</div>
      <div class="em-sec">4 · Send</div>
      <div class="em-row"><label class="em-m">Schedule for <input type="datetime-local" id="em-when" class="f-input" style="width:auto;display:inline-block;padding:4px 8px" value="${c.scheduled_at ? new Date(new Date(c.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}"/></label></div>`;
    fillDataOptions(); E.range = null;
    const ed = $('em-editor'), keep = () => { const s0 = window.getSelection(); if (s0.rangeCount && ed.contains(s0.anchorNode)) E.range = s0.getRangeAt(0).cloneRange(); };
    ['keyup', 'mouseup', 'input'].forEach(ev => ed.addEventListener(ev, keep));
    $('modal-em').style.display = 'flex';
  }
  function filters(a) {
    const box = (key, title, opts, sel) => opts.length ? `<div class="em-filter"><b>${title}</b> <span class="em-m">(none ticked = all)</span><div class="em-chips">${opts.map(o => `<label class="${(sel || []).includes(o) ? 'on' : ''}"><input type="checkbox" data-f="${key}" value="${esc(o)}" ${(sel || []).includes(o) ? 'checked' : ''} onchange="this.parentNode.classList.toggle('on',this.checked)"/>${esc(o)}</label>`).join('')}</div></div>` : '';
    const s = a.sources || [];
    return (s.includes('members') ? `<div class="em-filter"><b>Member status</b><div class="em-chips">${['approved', 'pending'].map(o => `<label class="${(a.member_status || ['approved']).includes(o) ? 'on' : ''}"><input type="checkbox" data-f="member_status" value="${o}" ${(a.member_status || ['approved']).includes(o) ? 'checked' : ''} onchange="this.parentNode.classList.toggle('on',this.checked)"/>${o}</label>`).join('')}</div></div>` + box('member_categories', 'Member categories', E.opts.member_categories, a.member_categories) : '')
      + (s.includes('investors') ? box('investor_types', 'Investor types', E.opts.investor_types, a.investor_types) : '')
      + (s.includes('crm') ? box('crm_types', 'CRM contact types', E.opts.crm_types, a.crm_types) : '')
      + (s.includes('manual') ? `<div class="em-filter"><b>Email addresses</b> <span class="em-m">(comma or new line separated, max 2,000)</span><textarea class="f-input" id="em-manual" rows="3">${esc(a.manual || '')}</textarea></div>` : '');
  }
  function audience() {
    const a = { sources: [...document.querySelectorAll('.em-src input:checked')].map(i => i.value) };
    ['member_status', 'member_categories', 'investor_types', 'crm_types'].forEach(k => { a[k] = [...document.querySelectorAll(`#em-filters input[data-f="${k}"]:checked`)].map(i => i.value); });
    if (!a.member_status.length) a.member_status = ['approved'];
    a.manual = ($('em-manual') || {}).value || '';
    return a;
  }
  function collect() {
    const html = $('em-html').style.display !== 'none' ? $('em-html').value : $('em-editor').innerHTML;
    const when = $('em-when').value;
    return Object.assign({}, E.cur, { name: $('em-name').value.trim() || ($('em-subj').value.trim() || 'Untitled campaign').slice(0, 80), kind: E.cur.kind, subject: $('em-subj').value.trim(), preheader: $('em-pre').value.trim() || null, from_name: $('em-from').value.trim() || 'BANAHUB', reply_to: $('em-reply').value.trim() || null, body_html: html, audience: audience(), scheduled_at: when ? new Date(when).toISOString() : null });
  }
  async function save(silent) {
    const c = collect(); if (c.reply_to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.reply_to)) { notify('Reply-to must be an email address', 'error'); return null; }
    const row = { name: c.name, kind: c.kind, subject: c.subject, preheader: c.preheader, from_name: c.from_name, reply_to: c.reply_to, body_html: c.body_html, audience: c.audience, scheduled_at: c.scheduled_at, updated_at: new Date().toISOString() };
    try {
      const r = c.id ? await q(sb().from('email_campaigns').update(row).eq('id', c.id).select().single()) : await q(sb().from('email_campaigns').insert(Object.assign(row, { created_by: OS().uid || null })).select().single());
      E.cur = r; if (!silent) notify('Draft saved'); return r;
    } catch (e) { notify('Save failed: ' + e.message, 'error'); return null; }
  }
  async function previewAud() {
    const el = $('em-aud'); el.textContent = 'Counting…';
    try { const r = await fn({ action: 'audience', audience: audience() }); el.innerHTML = `<b>${r.count}</b> recipient(s) — ${Object.entries(r.by_source || {}).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || 'none'}${r.unsolicited ? ` · <span style="color:#7a5000">${r.unsolicited} get &lt;ADV&gt;</span>` : ''}${r.suppressed ? ` · ${r.suppressed} unsubscribed (skipped)` : ''}${r.days_needed > 1 ? ` · <b>about ${r.days_needed} days</b> on the free plan (${(E.status || {}).daily_cap || 100}/day)` : ''}`; return r; }
    catch (e) { el.textContent = e.message; return null; }
  }
  async function test() {
    const r = await save(true); if (!r) return;
    try { const t = await fn({ action: 'test', campaign_id: r.id }); notify('Test sent to ' + t.to); } catch (e) { notify(e.message, 'error'); }
  }
  async function send() {
    const r = await save(true); if (!r) return;
    if (!r.subject || !r.body_html.replace(/<[^>]+>/g, '').trim()) return notify('Add a subject and content first', 'error');
    if (r.scheduled_at && new Date(r.scheduled_at) > new Date()) {
      await q(sb().from('email_campaigns').update({ status: 'scheduled' }).eq('id', r.id)); closeModal('modal-em'); notify('Scheduled for ' + fmtDT(r.scheduled_at) + ' — it sends when Admin OS is next open after that time'); return load();
    }
    const aud = await previewAud(); if (!aud) return;
    if (!aud.count) return notify('No recipients match this audience', 'error');
    if (!confirm(`Send “${r.subject}” to ${aud.count} recipient(s) now?${aud.days_needed > 1 ? `\n\nFree plan sends ${(E.status || {}).daily_cap || 100}/day — this finishes over about ${aud.days_needed} days.` : ''}`)) return;
    try { const s = await fn({ action: 'send', campaign_id: r.id }); closeModal('modal-em'); notify(`Sending: ${s.sent_now} sent now${s.remaining ? `, ${s.remaining} queued` : ''}`); if (s.note) setTimeout(() => notify(s.note, 'warn'), 600); load(); }
    catch (e) { notify(e.message, 'error'); }
  }
  async function report(id) {
    const [c, rows] = await Promise.all([q(sb().from('email_campaigns').select('*').eq('id', id).single()), q(sb().from('email_sends').select('email,name,company,source,status,error,sent_at,unsolicited').eq('campaign_id', id).order('created_at').limit(3000))]);
    const n = s => rows.filter(r => r.status === s).length;
    $('em-h').textContent = c.name;
    $('em-form').innerHTML = `<div class="em-row"><b>${esc(c.subject)}</b></div>
      <div class="em-kpis">${[['Recipients', c.recipients_count], ['Sent', n('sent')], ['Queued', n('queued')], ['Failed', n('failed')], ['Skipped (unsubscribed)', c.skipped_count]].map(k => `<div><b>${k[1] || 0}</b><span>${k[0]}</span></div>`).join('')}</div>
      ${n('queued') ? `<div class="em-row" style="margin:8px 0"><button class="btn btn-primary btn-sm" onclick="emProcess('${id}')">Send next batch now</button><button class="btn btn-ghost btn-sm" onclick="emCancel('${id}')">Stop campaign</button><span class="em-m">Queued emails send automatically within the free daily limit whenever Admin OS is open.</span></div>` : ''}
      <details style="margin-top:8px"><summary style="cursor:pointer;font-weight:600">Email preview</summary><div class="em-editor" style="pointer-events:none">${c.body_html}</div></details>
      <div class="card" style="padding:0;margin-top:10px;max-height:360px;overflow:auto"><table class="data-table"><thead><tr><th>Email</th><th>Name</th><th>Source</th><th>Status</th><th>Sent</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(r.name || '')}${r.company ? ' · ' + esc(r.company) : ''}</td><td>${esc(r.source)}${r.unsolicited ? ' <span class="em-m">ADV</span>' : ''}</td><td>${esc(r.status)}${r.error ? ` <span class="em-m" title="${esc(r.error)}">⚠</span>` : ''}</td><td class="em-m">${fmtDT(r.sent_at)}</td></tr>`).join('')}</tbody></table></div>`;
    $('em-foot').style.display = 'none'; $('modal-em').style.display = 'flex';
  }
  async function process(id) { try { const r = await fn({ action: 'process' }); notify(`${r.processed} sent · ${r.left_today} left today`); report(id); } catch (e) { notify(e.message, 'error'); } }
  async function cancel(id) {
    if (!confirm('Stop this campaign? Emails already sent stay sent; queued ones are cancelled.')) return;
    try { await q(sb().from('email_campaigns').update({ status: 'cancelled' }).eq('id', id)); notify('Campaign stopped', 'warn'); closeModal('modal-em'); load(); } catch (e) { notify(e.message, 'error'); }
  }

  /* ---------- editor helpers ---------- */
  function cmd(c, v) { $('em-editor').focus(); document.execCommand(c, false, v || null); }
  function insertHTML(h) {
    if ($('em-html').style.display !== 'none') { const t = $('em-html'); t.setRangeText(h, t.selectionStart, t.selectionEnd, 'end'); return; }
    const ed = $('em-editor'); ed.focus(); const sel = window.getSelection();
    if (E.range && ed.contains(E.range.startContainer)) { sel.removeAllRanges(); sel.addRange(E.range); }
    else { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    document.execCommand('insertHTML', false, h);
  }
  function link() { const u = prompt('Link URL (https://…)'); if (!u) return; if (!/^(https?:|mailto:)/i.test(u)) return notify('Use an https:// or mailto: link', 'error'); cmd('createLink', u); }
  function button() { const t = prompt('Button text', 'Learn more'); if (!t) return; const u = prompt('Button link (https://…)', 'https://banahub.com'); if (!u || !/^(https?:|mailto:)/i.test(u)) return; insertHTML(BTN(esc(t), esc(u))); }
  function toggleHtml() {
    const ed = $('em-editor'), tx = $('em-html'), b = $('em-htmlbtn');
    if (tx.style.display === 'none') { tx.value = ed.innerHTML; tx.style.display = ''; ed.style.display = 'none'; b.textContent = 'Visual'; }
    else { ed.innerHTML = tx.value; tx.style.display = 'none'; ed.style.display = ''; b.textContent = 'HTML'; }
  }
  function setKind(k) {
    const cur = collect(), t = TPL[k];
    const pristine = Object.values(TPL).some(x => x.body.replace(/\s/g, '') === String(cur.body_html || '').replace(/\s/g, '')) || !String(cur.body_html || '').replace(/<[^>]+>/g, '').trim();
    E.cur = Object.assign(cur, { kind: k });
    if (pristine || confirm('Replace the current content with the ' + KINDS[k][0] + ' template?')) Object.assign(E.cur, { subject: t.subject, preheader: t.pre, body_html: t.body });
    openComposer(E.cur);
  }
  async function fillDataOptions() {
    const sel = $('em-insert-data'); if (!sel) return;
    const [ev, pr, rs] = await Promise.all([
      q(sb().from('events').select('id,title,event_date,location,registration_url,page_url,slug').gte('event_date', new Date(Date.now() - 864e5).toISOString()).order('event_date').limit(20)).catch(() => []),
      q(sb().from('programs').select('id,title,start_date,region,description').order('created_at', { ascending: false }).limit(20)).catch(() => []),
      q(sb().from('deal_rooms').select('id,company_name,stage,target_raise,currency,sectors,hq_country,description,review_status').eq('review_status', 'accepted').limit(30)).catch(() => []),
    ]);
    E.data = { ev, pr, rs };
    sel.innerHTML = '<option value="">Insert from BANAHUB…</option>' + (ev.length ? `<optgroup label="Events">${ev.map(e => `<option value="ev:${e.id}">${esc(e.title)}</option>`).join('')}</optgroup>` : '') + (pr.length ? `<optgroup label="Programmes">${pr.map(p => `<option value="pr:${p.id}">${esc(p.title)}</option>`).join('')}</optgroup>` : '') + (rs.length ? `<optgroup label="Accepted raises">${rs.map(r => `<option value="rs:${r.id}">${esc(r.company_name)}</option>`).join('')}</optgroup>` : '');
  }
  function insertData(v) {
    if (!v) return; const [t, id] = v.split(':'), D = E.data || {};
    if (t === 'ev') { const e = (D.ev || []).find(x => x.id === id); if (!e) return; const url = e.page_url || e.registration_url || 'https://banahub.com/events'; insertHTML(`<h3>${esc(e.title)}</h3><p><strong>${e.event_date ? new Date(e.event_date).toLocaleString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date TBC'}</strong>${e.location ? ' · ' + esc(e.location) : ''}</p>${BTN('Register', esc(url))}`); }
    if (t === 'pr') { const p = (D.pr || []).find(x => x.id === id); if (!p) return; insertHTML(`<h3>${esc(p.title)}</h3><p>${esc((p.description || '').slice(0, 400))}</p>${p.start_date ? `<p><strong>Starts:</strong> ${esc(p.start_date)}${p.region ? ' · ' + esc(p.region) : ''}</p>` : ''}`); }
    if (t === 'rs') { const r = (D.rs || []).find(x => x.id === id); if (!r) return; insertHTML(`<h3>${esc(r.company_name)}</h3><ul><li><strong>Stage:</strong> ${esc(r.stage || '—')}</li><li><strong>Raising:</strong> ${esc(r.currency || 'USD')} ${r.target_raise ? Number(r.target_raise).toLocaleString() : '—'}</li><li><strong>Sector:</strong> ${esc((r.sectors || []).join(', ') || '—')}</li><li><strong>HQ:</strong> ${esc(r.hq_country || '—')}</li></ul><p>${esc((r.description || '').slice(0, 400))}</p><p><em>Only share raise details the founder has approved for outreach.</em></p>`); }
  }
  async function benDraft() {
    const B = window.Ben && Ben.__B;
    if (!B || !B.ai) return notify('Ben\'s AI is off (Agent Control) — pick a template above and edit it. Switch Ben to Live to draft with AI.', 'warn');
    const c = collect(); const brief = prompt('What should this email say? (audience, key points, call to action)', c.name || ''); if (brief == null) return;
    const btn = document.querySelector('.em-ben'); btn.disabled = true; btn.textContent = '✦ Ben is writing…';
    try {
      const { data, error } = await sb().functions.invoke('ben', { body: { message: `Draft a professional ${KINDS[c.kind][0]} email for BANAHUB. Brief: ${brief}\nAudience: ${JSON.stringify(c.audience.sources)} ${JSON.stringify(c.audience.member_categories || [])} ${JSON.stringify(c.audience.investor_types || [])}.\nRules: concise, institutional, warm; one clear call to action; use {{first_name}} and {{company}} merge tags; no investment advice, no promises of returns, funding or introductions. Do NOT use tools. Reply with ONLY JSON: {"subject":"…","preheader":"…","body_html":"<p>…</p>"} (body uses <p>,<h3>,<ul>,<li>,<strong>,<a>; no footer — it's added automatically).`, history: [], today: new Date().toISOString().slice(0, 10) } });
      if (error || !data || data.error || !data.reply) throw new Error((data && (data.error || data.reason)) || (error && error.message) || 'no draft');
      const t = data.reply, j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      E.cur = Object.assign(collect(), { subject: j.subject || c.subject, preheader: j.preheader || c.preheader, body_html: j.body_html || c.body_html }); openComposer(E.cur); notify('Draft ready — review before sending');
    } catch (e) { notify('Ben could not draft: ' + e.message, 'error'); btn.disabled = false; btn.textContent = '✦ Draft with Ben'; }
  }

  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'emails') { inject(); return load(); } return prev && prev(p); };
  Object.assign(window, {
    emNew: () => { $('em-foot').style.display = ''; openComposer(blank('newsletter')); }, emOpen: async id => { $('em-foot').style.display = ''; openComposer(await q(sb().from('email_campaigns').select('*').eq('id', id).single())); },
    emDup: async id => { const c = await q(sb().from('email_campaigns').select('*').eq('id', id).single()); $('em-foot').style.display = ''; openComposer(Object.assign({}, c, { id: null, name: c.name + ' (copy)', status: 'draft', scheduled_at: null })); },
    emTab: t => { E.tab = t; draw(); }, emKind: setKind, emSrc: el => { el.parentNode.classList.toggle('on', el.checked); const a = audience(); $('em-filters').innerHTML = filters(a); }, emPreviewAud: previewAud,
    emCmd: cmd, emLink: link, emButton: button, emInsert: v => insertHTML(v), emInsertData: insertData, emHtml: toggleHtml, emBen: benDraft,
    emSave: async () => { if (await save()) load(); }, emTest: test, emSend: send, emReport: report, emProcess: process, emCancel: cancel,
    emSupAdd: async () => { const e = ($('em-sup-add').value || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return notify('Enter a valid email', 'error'); try { await q(sb().from('email_suppressions').upsert({ email: e, reason: 'manual', source: 'admin' })); notify('Suppressed ' + e); drawSuppressed(); } catch (x) { notify(x.message, 'error'); } },
    emSupDel: async e => { try { await q(sb().from('email_suppressions').delete().eq('email', e)); drawSuppressed(); } catch (x) { notify(x.message, 'error'); } },
    __EM: E,
  });

  const MODAL = `<div id="modal-em" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-em')"><div class="modal modal-lg" style="max-width:980px;width:100%">
    <div class="modal-header"><div class="modal-title" id="em-h">Campaign</div><button class="modal-close" onclick="closeModal('modal-em')">✕</button></div>
    <div class="modal-body" id="em-form"></div>
    <div class="modal-footer" id="em-foot" style="flex-wrap:wrap"><button class="btn btn-ghost" onclick="emSave()">Save draft</button><button class="btn btn-ghost" onclick="emTest()">Send test to me</button><span style="flex:1"></span><button class="btn btn-primary" onclick="emSend()">Send / schedule</button></div></div></div>`;
  const CSS = `.em-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--ink)}.em-m{font-size:12px;color:var(--white-dim)}
  .em-tabs{display:flex;gap:4px;margin-bottom:10px}.em-tabs button{border:1px solid var(--border-2);background:#fff;border-radius:8px;padding:6px 12px;font:600 13px inherit;color:var(--ink);cursor:pointer}.em-tabs button.on{background:#003527;color:#fff;border-color:#003527}
  .em-pill{font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;background:#eee;color:#444}.em-sent{background:#e3f1e8;color:#0a5c40}.em-sending{background:#fff4d6;color:#7a5000}.em-scheduled{background:#e6eef9;color:#1d3d6b}.em-failed,.em-cancelled{background:#fdecea;color:#8c1d18}
  .em-sec{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#735c00;margin:16px 0 8px}
  .em-kinds{display:flex;flex-wrap:wrap;gap:6px}.em-kind{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border-2);background:#fff;border-radius:10px;padding:7px 11px;font:600 13px inherit;color:var(--ink);cursor:pointer}.em-kind .material-symbols-outlined{font-size:18px}.em-kind.on{background:#003527;color:#fff;border-color:#003527}
  .em-src{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}.em-srcbox{display:flex;flex-direction:column;gap:2px;border:1.5px solid var(--border-2);border-radius:10px;padding:9px 11px;cursor:pointer;color:var(--ink)}.em-srcbox input{display:none}.em-srcbox.on{border-color:#003527;background:#f1f6f2}.em-srcbox span{font-size:11.5px;color:var(--white-dim)}
  .em-filter{margin-top:10px;color:var(--ink);font-size:13px}.em-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.em-chips label{border:1px solid var(--border-2);border-radius:999px;padding:4px 10px;font-size:12.5px;cursor:pointer}.em-chips label.on{background:#003527;color:#fff;border-color:#003527}.em-chips input{display:none}
  .em-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.em-grid label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--ink)}
  .em-toolbar{display:flex;flex-wrap:wrap;gap:4px;margin-top:12px;padding:6px;border:1px solid var(--border-2);border-bottom:0;border-radius:10px 10px 0 0;background:#f7f8f5}.em-toolbar button,.em-toolbar select{border:1px solid var(--border-2);background:#fff;border-radius:6px;padding:4px 9px;font:13px inherit;color:var(--ink);cursor:pointer}
  .em-ben{background:#735c00!important;color:#fff!important;border-color:#735c00!important;font-weight:600!important}
  .em-editor{min-height:300px;max-height:520px;overflow:auto;border:1px solid var(--border-2);border-radius:0 0 10px 10px;padding:18px 22px;background:#fff;color:#1b1c1a;font:15px/1.6 Arial,Helvetica,sans-serif;outline:none}.em-editor h2,.em-editor h3{color:#003527;margin:14px 0 6px}
  .em-htmlbox{min-height:300px;font:12.5px ui-monospace,Menlo,monospace;border-radius:0 0 10px 10px}
  .em-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:10px 0}.em-kpis div{border:1px solid var(--border);border-radius:10px;padding:8px 12px}.em-kpis b{display:block;font-size:20px;color:#003527}.em-kpis span{font-size:11.5px;color:var(--white-dim)}
  @media (max-width:700px){.em-grid{grid-template-columns:1fr}}`;

  const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000);
  // continue queued / due scheduled campaigns once per Admin OS session (free-plan daily cap enforced server-side)
  setTimeout(() => { if (sb() && OS().uid && !E.processed) { E.processed = true; fn({ action: 'process' }).catch(() => { }); } }, 8000);
})();
