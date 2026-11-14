/* BANAHUB Admin OS — Growth: funnel, sources, referrals, leads, founding offer & site banner settings.
 * Data: growth_events (captured by growth.js / readiness / sign-up), newsletter_subscribers, users, investors, site_settings 'growth'.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const sb = () => (window.__OS || {}).sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '';
  const G = { range: 30, ev: [], subs: 0, users: [], set: {}, tab: 'overview', ready: true };

  const CSS = `.gr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
  .gr-k{background:var(--bg-3);border:1px solid var(--border);border-radius:14px;padding:14px}.gr-k .l{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--white-muted);font-weight:800}
  .gr-k .v{font-size:24px;font-weight:800;margin-top:4px}.gr-k .s{font-size:11.5px;color:var(--white-dim);margin-top:2px}
  .gr-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}.gr-tabs button{background:var(--bg-3);border:1px solid var(--border);color:var(--white-dim);padding:7px 13px;border-radius:999px;font:600 12.5px inherit;cursor:pointer}
  .gr-tabs button.on{background:var(--emerald,#10b981);border-color:transparent;color:#00140e}
  .gr-bar{height:7px;background:var(--bg-4,rgba(0,0,0,.08));border-radius:5px;overflow:hidden;min-width:90px}.gr-bar i{display:block;height:100%;background:#0a5c40}
  .gr-funnel{display:grid;gap:8px}.gr-step{display:grid;grid-template-columns:200px 1fr 70px;gap:12px;align-items:center;font-size:13px}
  .gr-note{font-size:12.5px;color:var(--white-dim);line-height:1.55}.gr-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.gr-grid2{grid-template-columns:1fr}.gr-step{grid-template-columns:120px 1fr 50px}}`;

  function inject() {
    if ($('panel-growth')) return true;
    const host = $('panel-dashboard'); if (!host) return false;
    host.parentNode.insertAdjacentHTML('beforeend', '<div id="panel-growth" class="panel"></div>');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') panelMeta.growth = ['Growth', 'Traffic sources, leads, referrals, founding members and site offers'];
    const emailsBtn = document.querySelector('.nav-item[onclick="nav(\'emails\')"]');
    if (emailsBtn && !document.querySelector('.nav-item[onclick="nav(\'growth\')"]')) emailsBtn.insertAdjacentHTML('beforebegin', '<button class="nav-item" onclick="nav(\'growth\')"><span class="nav-icon material-symbols-outlined">trending_up</span>Growth</button>');
    return true;
  }

  async function load() {
    inject();
    const P = $('panel-growth'); P.innerHTML = '<div style="padding:40px;color:var(--white-muted)">Loading growth data…</div>';
    const since = new Date(Date.now() - 365 * 864e5).toISOString();
    try {
      const [ev, subs, users, inv, set] = await Promise.all([
        q(sb().from('growth_events').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(5000)).catch(e => { G.ready = !/does not exist|schema cache/i.test(e.message); return []; }),
        sb().from('newsletter_subscribers').select('id', { count: 'exact', head: true }).eq('is_active', true),
        q(sb().from('users').select('id,email,full_name,company_name,member_category,status,role,created_at').neq('role', 'admin').limit(5000)),
        sb().from('investors').select('id', { count: 'exact', head: true }).not('user_id', 'is', null),
        q(sb().from('site_settings').select('value').eq('key', 'growth').maybeSingle()).catch(() => null)]);
      G.ev = ev || []; G.subs = subs.count || 0; G.users = users || []; G.invJoined = inv.count || 0; G.set = (set && set.value) || {};
    } catch (e) { P.innerHTML = `<div class="card"><div class="card-body" style="color:#b3261e">${esc(e.message)}</div></div>`; return; }
    render();
  }

  const inRange = d => new Date(d) >= new Date(Date.now() - G.range * 864e5);
  const isInvestor = u => /investor|vc|family|fund|angel|lp|asset|private equity|hedge/i.test(u.member_category || '');
  function stats() {
    const ev = G.ev.filter(e => inRange(e.created_at));
    const by = k => ev.filter(e => e.event === k);
    const users = G.users.filter(u => inRange(u.created_at));
    return { ev, land: by('landing').length, news: by('newsletter').length, ready: by('readiness').filter(e => !e.email).length || by('readiness').length, readyLeads: by('readiness').filter(e => e.email).length,
      round: by('roundtable').length, signups: users.length, approved: G.users.filter(u => u.status === 'approved').length,
      invMembers: G.users.filter(u => u.status === 'approved' && isInvestor(u)).length, coMembers: G.users.filter(u => u.status === 'approved' && !isInvestor(u)).length };
  }

  function header() {
    return `<div class="page-header"><div><div class="page-title">Growth</div><div class="page-sub">Where visitors come from, who converts, referrals and the founding-member offer</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><select class="f-input f-select" style="width:150px" onchange="GROWTH.range(+this.value)">${[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([v, l]) => `<option value="${v}" ${G.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn btn-ghost" onclick="window.open('/readiness','_blank')">Readiness check ↗</button><button class="btn btn-primary" onclick="GROWTH.load()">Refresh</button></div></div>
      ${G.ready ? '' : '<div class="card" style="margin-bottom:14px"><div class="card-body gr-note" style="color:#7a5c00"><b>One step left:</b> apply SQL migration 33 (growth tracking). Until then the site still collects newsletter sign-ups; readiness leads and sources start recording after the migration.</div></div>'}
      <div class="gr-tabs">${[['overview', 'Overview'], ['leads', 'Leads'], ['sources', 'Sources & referrals'], ['offer', 'Offer & banner']].map(([k, l]) => `<button class="${G.tab === k ? 'on' : ''}" onclick="GROWTH.tab('${k}')">${l}</button>`).join('')}</div>`;
  }
  function overview() {
    const s = stats(), cap = +G.set.founding_cap || 50, used = s.approved;
    const T = G.set.targets || { members: 50, investors: 25, subscribers: 300 };
    const steps = [['Campaign / referral visits', s.land], ['Readiness checks completed', s.ready], ['Leads (left their details)', s.readyLeads + s.news + s.round], ['Sign-ups', s.signups], ['Approved members (all time)', s.approved]];
    const max = Math.max(1, ...steps.map(x => x[1]));
    const prog = (l, v, t) => `<div class="gr-step"><span>${l}</span><div class="gr-bar"><i style="width:${Math.min(100, v / Math.max(1, t) * 100)}%"></i></div><b>${v}/${t}</b></div>`;
    return `<div class="gr-kpis">
      <div class="gr-k"><div class="l">Sign-ups</div><div class="v">${s.signups}</div><div class="s">last ${G.range} days</div></div>
      <div class="gr-k"><div class="l">Readiness checks</div><div class="v">${s.ready}</div><div class="s">${s.readyLeads} left details</div></div>
      <div class="gr-k"><div class="l">Newsletter</div><div class="v">${G.subs}</div><div class="s">${s.news} new in range</div></div>
      <div class="gr-k"><div class="l">Roundtable requests</div><div class="v">${s.round}</div><div class="s">last ${G.range} days</div></div>
      <div class="gr-k"><div class="l">Founding slots</div><div class="v">${used}/${cap}</div><div class="s">approved members</div></div>
      <div class="gr-k"><div class="l">Investors on platform</div><div class="v">${s.invMembers + G.invJoined}</div><div class="s">${s.coMembers} company members</div></div></div>
      <div class="gr-grid2"><div class="card"><div class="card-header"><div class="card-title">Funnel (last ${G.range} days)</div></div><div class="card-body gr-funnel">
        ${steps.map(([l, v]) => `<div class="gr-step"><span>${l}</span><div class="gr-bar"><i style="width:${v / max * 100}%"></i></div><b>${v}</b></div>`).join('')}
        <p class="gr-note" style="margin-top:6px">Visits are counted only when someone arrives from a tracked link (utm_… or ?ref=). Use tracked links in every post, email and partner page.</p></div></div>
      <div class="card"><div class="card-header"><div class="card-title">90-day targets</div></div><div class="card-body gr-funnel">
        ${prog('Company members', s.coMembers, T.members)}${prog('Investor members', s.invMembers + G.invJoined, T.investors)}${prog('Newsletter subscribers', G.subs, T.subscribers)}
        <p class="gr-note" style="margin-top:6px">Change targets in Offer &amp; banner. Build tracked links below.</p></div></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><div class="card-title">Tracked link builder</div></div><div class="card-body" style="display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr auto;gap:8px;align-items:end">
        <div class="f-group"><label class="f-label">Page</label><select id="gr-l-page" class="f-input f-select">${['/', '/readiness', '/investor-network', '/capital-review', '/membership', '/register', '/events', '/insights'].map(p => `<option>${p}</option>`).join('')}</select></div>
        <div class="f-group"><label class="f-label">Source</label><input id="gr-l-src" class="f-input" value="linkedin"/></div>
        <div class="f-group"><label class="f-label">Medium</label><input id="gr-l-med" class="f-input" value="social"/></div>
        <div class="f-group"><label class="f-label">Campaign</label><input id="gr-l-cmp" class="f-input" value="founding-launch"/></div>
        <button class="btn btn-primary" onclick="GROWTH.link()">Copy link</button><div id="gr-l-out" class="gr-note" style="grid-column:1/-1"></div></div></div>`;
  }
  function leads() {
    const L = G.ev.filter(e => e.email && inRange(e.created_at));
    if (!L.length) return '<div class="card"><div class="card-body gr-note">No leads in this period yet. Readiness-check results with contact details, newsletter sign-ups, roundtable requests and sign-ups will appear here.</div></div>';
    return `<div class="card"><div class="card-body" style="padding:0;overflow:auto"><table class="data-table"><thead><tr><th>When</th><th>Type</th><th>Person</th><th>Score</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>
      ${L.slice(0, 500).map(e => { const a = e.answers || {}; return `<tr><td style="white-space:nowrap">${fmtD(e.created_at)}</td><td><span class="badge ${e.event === 'readiness' ? 'badge-green' : e.event === 'signup' ? 'badge-gold' : 'badge-ghost'}">${esc(e.event)}</span></td>
        <td><b>${esc(e.name || '—')}</b>${e.company ? ' · ' + esc(e.company) : ''}<div class="gr-note"><a href="mailto:${esc(e.email)}" style="color:var(--emerald)">${esc(e.email)}</a>${a.roundtable ? ' · wants roundtable invite' : ''}</div></td>
        <td>${e.score != null ? `<b>${e.score}</b><div class="gr-note">${esc(a.band || '')}</div>` : '—'}</td>
        <td class="gr-note">${esc([(e.utm || {}).source, (e.utm || {}).campaign, e.ref ? 'ref ' + e.ref : ''].filter(Boolean).join(' · ') || (e.referrer ? new URL(e.referrer).hostname : 'direct'))}</td>
        <td><select class="f-input f-select" style="min-width:120px" onchange="GROWTH.status('${e.id}',this.value)">${['new', 'contacted', 'converted', 'ignored'].map(s => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn btn-ghost btn-sm" onclick="GROWTH.crm('${e.id}')">Add to CRM</button></td></tr>`; }).join('')}
      </tbody></table></div></div><p class="gr-note" style="margin-top:8px">Readiness answers are stored with each lead (Edit → view in CRM notes after "Add to CRM"). Reply within two business days — that is what the site promises.</p>`;
  }
  function sources() {
    const ev = G.ev.filter(e => inRange(e.created_at));
    const key = e => ((e.utm || {}).source || (e.ref ? 'referral' : e.referrer ? (() => { try { return new URL(e.referrer).hostname.replace(/^www\./, ''); } catch (x) { return 'other'; } })() : 'direct')) + ((e.utm || {}).campaign ? ' · ' + e.utm.campaign : '');
    const T = {}; ev.forEach(e => { const k = key(e); T[k] = T[k] || { landing: 0, lead: 0, signup: 0 }; if (e.event === 'landing') T[k].landing++; else if (e.event === 'signup') T[k].signup++; else if (e.email) T[k].lead++; });
    const rows = Object.entries(T).sort((a, b) => (b[1].signup * 10 + b[1].lead * 3 + b[1].landing) - (a[1].signup * 10 + a[1].lead * 3 + a[1].landing));
    const R = {}; ev.filter(e => e.ref).forEach(e => { R[e.ref] = R[e.ref] || { visits: 0, leads: 0, signups: 0 }; if (e.event === 'landing') R[e.ref].visits++; else if (e.event === 'signup') R[e.ref].signups++; else if (e.email) R[e.ref].leads++; });
    const who = code => { const u = G.users.find(u => u.id.replace(/-/g, '').startsWith(code)); return u ? `${esc(u.full_name || u.email)}${u.company_name ? ' · ' + esc(u.company_name) : ''}` : esc(code); };
    return `<div class="gr-grid2"><div class="card"><div class="card-header"><div class="card-title">Sources</div></div><div class="card-body" style="padding:0">${rows.length ? `<table class="data-table"><thead><tr><th>Source · campaign</th><th>Visits</th><th>Leads</th><th>Sign-ups</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.landing}</td><td>${v.lead}</td><td><b>${v.signup}</b></td></tr>`).join('')}</tbody></table>` : '<div class="card-body gr-note">No tracked traffic yet.</div>'}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">Member referrals</div></div><div class="card-body" style="padding:0">${Object.keys(R).length ? `<table class="data-table"><thead><tr><th>Member</th><th>Visits</th><th>Leads</th><th>Sign-ups</th></tr></thead><tbody>${Object.entries(R).sort((a, b) => b[1].signups - a[1].signups || b[1].visits - a[1].visits).map(([k, v]) => `<tr><td>${who(k)}</td><td>${v.visits}</td><td>${v.leads}</td><td><b>${v.signups}</b></td></tr>`).join('')}</tbody></table>` : '<div class="card-body gr-note">Every member has a personal invite link on their FundMatch dashboard. Referrals appear here as soon as someone uses one.</div>'}</div></div></div>`;
  }
  function offer() {
    const s = G.set, T = s.targets || { members: 50, investors: 25, subscribers: 300 };
    const f = (id, l, v, ph, ta) => `<div class="f-group"><label class="f-label">${l}</label>${ta ? `<textarea id="${id}" class="f-input" rows="2">${esc(v)}</textarea>` : `<input id="${id}" class="f-input" value="${esc(v)}" placeholder="${esc(ph || '')}"/>`}</div>`;
    return `<div class="gr-grid2"><div class="card"><div class="card-header"><div class="card-title">Site banner &amp; founding offer</div></div><div class="card-body" style="display:flex;flex-direction:column;gap:12px">
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="gr-on" ${s.banner_on ? 'checked' : ''}/> Show the banner at the top of public pages</label>
      ${f('gr-text', 'Banner text', s.banner_text, '', true)}${f('gr-cta', 'Button text', s.banner_cta)}${f('gr-link', 'Button link', s.banner_link, '/readiness')}
      ${f('gr-cap', 'Founding-member slots', s.founding_cap || 50)}${f('gr-terms', 'Founding-member terms (shown to applicants)', s.founding_terms, '', true)}
      <p class="gr-note">Describe benefits honestly; prices stay in Pricing. Never promise introductions or funding.</p></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Newsletter, roundtable &amp; targets</div></div><div class="card-body" style="display:flex;flex-direction:column;gap:12px">
      ${f('gr-news', 'Newsletter sign-up text (footer)', s.newsletter_text, '', true)}
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="gr-rt" ${s.roundtable_on ? 'checked' : ''}/> Offer roundtable invitations on the readiness result</label>${f('gr-rtt', 'Roundtable text', s.roundtable_text, '', true)}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">${f('gr-tm', 'Target: company members', T.members)}${f('gr-ti', 'Target: investor members', T.investors)}${f('gr-ts', 'Target: subscribers', T.subscribers)}</div>
      <button class="btn btn-primary" onclick="GROWTH.save()">Save</button></div></div></div>`;
  }
  function render() {
    const P = $('panel-growth'); if (!P) return;
    P.innerHTML = header() + ({ overview, leads, sources, offer }[G.tab] || overview)();
  }

  async function save() {
    const num = (id, d) => Math.max(0, parseInt($(id).value, 10) || d);
    const v = Object.assign({}, G.set, { banner_on: $('gr-on').checked, banner_text: $('gr-text').value.trim().slice(0, 240), banner_cta: $('gr-cta').value.trim().slice(0, 60),
      banner_link: ($('gr-link').value.trim() || '/readiness').slice(0, 200), founding_cap: num('gr-cap', 50), founding_terms: $('gr-terms').value.trim().slice(0, 600),
      newsletter_text: $('gr-news').value.trim().slice(0, 240), roundtable_on: $('gr-rt').checked, roundtable_text: $('gr-rtt').value.trim().slice(0, 240),
      targets: { members: num('gr-tm', 50), investors: num('gr-ti', 25), subscribers: num('gr-ts', 300) } });
    if (!/^(\/|https:\/\/)/.test(v.banner_link)) return notify('Button link must start with / or https://', 'warn');
    try { await q(sb().from('site_settings').upsert({ key: 'growth', value: v, updated_at: new Date().toISOString() })); G.set = v; notify('Saved — live on the site now'); }
    catch (e) { notify(e.message, 'error'); }
  }
  async function setStatus(id, st) { try { await q(sb().from('growth_events').update({ status: st }).eq('id', id)); const e = G.ev.find(x => x.id === id); if (e) e.status = st; } catch (e) { notify(e.message, 'error'); } }
  async function toCrm(id) {
    const e = G.ev.find(x => x.id === id); if (!e) return;
    const a = e.answers || {};
    const notes = [`Source: BANAHUB ${e.event}${e.utm && e.utm.source ? ' via ' + e.utm.source : ''}${e.ref ? ' (referral ' + e.ref + ')' : ''}`, e.score != null ? `Readiness score ${e.score} (${a.band || ''}); areas: ${Object.entries(a.areas || {}).map(([k, v]) => k + ' ' + v).join(', ')}` : '', a.roundtable ? 'Requested roundtable invitation' : ''].filter(Boolean).join('\n');
    try {
      const ex = await q(sb().from('crm_contacts').select('id').ilike('email', e.email).limit(1));
      if (ex && ex.length) { notify('Already in CRM'); return; }
      await q(sb().from('crm_contacts').insert({ name: e.name || e.email, email: e.email, company: e.company || null, contact_type: e.role === 'investor' ? 'investor' : 'founder', pipeline_stage: 'lead', source: 'website:' + e.event, notes, next_action: 'Reply to readiness check', next_action_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) }));
      await setStatus(id, 'contacted'); notify('Added to CRM'); render();
    } catch (err) { notify(err.message, 'error'); }
  }
  async function link() {
    const u = new URL('https://www.banahub.com' + $('gr-l-page').value);
    const clean = v => v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60);
    if ($('gr-l-src').value) u.searchParams.set('utm_source', clean($('gr-l-src').value));
    if ($('gr-l-med').value) u.searchParams.set('utm_medium', clean($('gr-l-med').value));
    if ($('gr-l-cmp').value) u.searchParams.set('utm_campaign', clean($('gr-l-cmp').value));
    try { await navigator.clipboard.writeText(u.toString()); } catch (e) { }
    $('gr-l-out').innerHTML = `Copied: <code>${esc(u.toString())}</code>`;
  }

  window.GROWTH = { load, tab: t => { G.tab = t; render(); }, range: r => { G.range = r; render(); }, save, status: setStatus, crm: toCrm, link };
  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'growth') return load(); return prev && prev(p); };
  if (document.readyState !== 'loading') inject(); else document.addEventListener('DOMContentLoaded', inject);
})();
