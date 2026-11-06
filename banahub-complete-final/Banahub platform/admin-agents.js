/* BANAHUB Admin OS — Data Rooms (grant / revoke investor access, files, view log) and Pitch Practice (limits, personas, sessions).
 * Limits live in site_settings (pitch_practice, data_room) and are enforced server-side (edge functions + DB triggers).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const OS = () => window.__OS || {};
  const sb = () => OS().sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const kb = n => n == null ? '—' : n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const PERSONAS = { founder: { friends: 'Friends & family', angels: 'Angel investor', seed_vc: 'Seed VC partner', series_a_vc: 'Series A VC partner', cvc: 'Corporate VC', family_office: 'Family office' }, lp: { friends: 'Friends & family LP', angels: 'Angel / operator LP', hnw: 'High-net-worth', family_office: 'Family office CIO', institutional: 'Institutional LP' } };
  const pl = (m, k) => (PERSONAS[m] || {})[k] || k;
  const X = { rooms: [], files: [], access: [], views: [], users: {}, room: null, sessions: [], pp: {}, dr: {}, q: '' };

  function inject() {
    if ($('panel-os-datarooms')) return true;
    const g = $('os-cap-nav-group'); if (!g) return false;
    const after = g.querySelector('[data-os-nav="os-submissions"]') || g.querySelector('.nav-item:last-child'); if (!after) return false;
    after.insertAdjacentHTML('afterend', '<button class="nav-item" onclick="nav(\'os-agentctl\')" data-os-nav="os-agentctl"><span class="nav-icon material-symbols-outlined">smart_toy</span>Agent Control</button><button class="nav-item" onclick="nav(\'os-datarooms\')" data-os-nav="os-datarooms"><span class="nav-icon material-symbols-outlined">folder_shared</span>Data Rooms</button><button class="nav-item" onclick="nav(\'os-pitch\')" data-os-nav="os-pitch"><span class="nav-icon material-symbols-outlined">mic</span>Pitch Practice</button>');
    const host = $('panel-dashboard').parentNode;
    host.insertAdjacentHTML('beforeend', '<div id="panel-os-agentctl" class="panel"></div><div id="panel-os-datarooms" class="panel"></div><div id="panel-os-pitch" class="panel"></div>');
    document.body.insertAdjacentHTML('beforeend', MODAL);
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (typeof panelMeta !== 'undefined') { panelMeta['os-datarooms'] = ['Data Rooms', 'Member data rooms — grant investor access, see files and views']; panelMeta['os-pitch'] = ['Pitch Practice', 'AI pitch agents — plan limits, personas and sessions']; panelMeta['os-agentctl'] = ['Agent Control', 'Switch each AI agent live, into maintenance, coming soon or off']; }
    return true;
  }

  /* ---------------- Data rooms ---------------- */
  async function loadRooms() {
    const P = $('panel-os-datarooms'); P.innerHTML = '<div class="os-empty">Loading…</div>';
    try {
      const [files, access, views, cfg] = await Promise.all([
        q(sb().from('data_room_files').select('id,owner_id,deal_room_id,investor_id,folder,name,size,mime,created_at').order('created_at', { ascending: false }).limit(5000)),
        q(sb().from('data_room_access').select('*').order('created_at', { ascending: false })),
        q(sb().from('data_room_views').select('file_id,viewer_id,action,viewed_at').order('viewed_at', { ascending: false }).limit(5000)).catch(() => []),
        q(sb().from('site_settings').select('value').eq('key', 'data_room').maybeSingle()).then(r => (r && r.value) || {}),
      ]);
      X.files = files || []; X.access = access || []; X.views = views || []; X.dr = cfg;
      const dIds = [...new Set([...X.files, ...X.access].map(f => f.deal_room_id).filter(Boolean))], iIds = [...new Set([...X.files, ...X.access].map(f => f.investor_id).filter(Boolean))];
      const [d, i] = await Promise.all([dIds.length ? q(sb().from('deal_rooms').select('id,company_name,stage,submitted_by,review_status').in('id', dIds)) : [], iIds.length ? q(sb().from('investors').select('id,organization,investor_type,user_id').in('id', iIds)) : []]);
      X.rooms = [...(d || []).map(r => ({ key: 'r:' + r.id, deal_room_id: r.id, investor_id: null, title: r.company_name, sub: [r.stage, 'Company raise', r.review_status].filter(Boolean).join(' · '), owner: r.submitted_by })),
        ...(i || []).map(r => ({ key: 'i:' + r.id, deal_room_id: null, investor_id: r.id, title: r.organization, sub: [r.investor_type, 'Fund / investor'].filter(Boolean).join(' · '), owner: r.user_id }))];
      const uids = [...new Set([...X.rooms.map(r => r.owner), ...X.access.map(a => a.grantee_id), ...X.views.map(v => v.viewer_id)].filter(Boolean))];
      X.users = {}; if (uids.length) (await q(sb().from('users').select('id,full_name,email,company_name,role,member_category,status').in('id', uids)) || []).forEach(u => { X.users[u.id] = u; });
      drawRooms();
    } catch (e) { P.innerHTML = `<div class="card os-empty">${esc(e.message)}</div>`; }
  }
  const roomOf = r => x => (r.deal_room_id && x.deal_room_id === r.deal_room_id) || (r.investor_id && x.investor_id === r.investor_id);
  const uname = id => { const u = X.users[id] || {}; return esc(u.full_name || u.email || 'Unknown') + (u.company_name ? ` <span class="ag2-m">· ${esc(u.company_name)}</span>` : ''); };
  function drawRooms() {
    const P = $('panel-os-datarooms'), qs = X.q.toLowerCase();
    const rows = X.rooms.map(r => { const f = X.files.filter(roomOf(r)), ids = new Set(f.map(x => x.id)), v = X.views.filter(x => ids.has(x.file_id)); return { r, n: f.length, size: f.reduce((s, x) => s + (Number(x.size) || 0), 0), views: v.length, viewers: new Set(v.map(x => x.viewer_id)).size, acc: X.access.filter(roomOf(r)).filter(a => !a.revoked_at).length, last: f[0] && f[0].created_at }; })
      .filter(x => !qs || (x.r.title + ' ' + x.r.sub + ' ' + ((X.users[x.r.owner] || {}).email || '')).toLowerCase().includes(qs)).sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')));
    const totals = { rooms: X.rooms.length, files: X.files.length, size: X.files.reduce((s, x) => s + (Number(x.size) || 0), 0), grants: X.access.filter(a => !a.revoked_at).length, views: X.views.length };
    P.innerHTML = `
      <div class="ag2-kpis">${[['Rooms', totals.rooms], ['Files', totals.files], ['Storage', kb(totals.size)], ['Active grants', totals.grants], ['Investor views', totals.views]].map(k => `<div class="card ag2-kpi"><b>${k[1]}</b><span>${k[0]}</span></div>`).join('')}</div>
      <div class="card" style="padding:14px;margin-bottom:14px"><div class="ag2-row"><b>Plan limits</b><span class="ag2-m">Enforced in the database for every upload</span><span style="flex:1"></span><button class="btn btn-ghost btn-sm" onclick="ag2Limits()">Edit limits</button></div>
        <div class="ag2-m" style="margin-top:6px">Free: ${X.dr.free_rooms || 1} room · ${X.dr.free_files || 10} files · ${X.dr.free_mb || 100} MB &nbsp;|&nbsp; Member: ${X.dr.paid_files || 500} files · ${X.dr.paid_mb || 5000} MB · unlimited rooms &nbsp;|&nbsp; ${X.dr.enabled === false ? '<b style="color:#a3261d">Uploads disabled</b>' : 'Uploads enabled'}</div></div>
      <div class="ag2-row" style="margin-bottom:10px"><input class="f-input" style="max-width:340px" placeholder="Search rooms, owners…" value="${esc(X.q)}" oninput="ag2Q(this.value)"/></div>
      ${rows.length ? `<div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr><th>Room</th><th>Owner</th><th>Files</th><th>Size</th><th>Viewers</th><th>Access</th><th>Updated</th><th></th></tr></thead><tbody>
        ${rows.map(x => `<tr><td><b>${esc(x.r.title)}</b><div class="ag2-m">${esc(x.r.sub)}</div></td><td>${uname(x.r.owner)}</td><td>${x.n}</td><td>${kb(x.size)}</td><td>${x.viewers} <span class="ag2-m">(${x.views} views)</span></td><td>${x.acc}</td><td>${fmtD(x.last)}</td><td><button class="btn btn-primary btn-sm" onclick="ag2Room('${x.r.key}')">Manage</button></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="card os-empty">No data rooms yet. Members build them from Dashboard → Data Room once they have a raise or investor profile.</div>'}`;
  }
  function roomModal(key) {
    const r = X.rooms.find(x => x.key === key); if (!r) return; X.room = r;
    const files = X.files.filter(roomOf(r)), ids = new Set(files.map(f => f.id)), views = X.views.filter(v => ids.has(v.file_id)), acc = X.access.filter(roomOf(r));
    $('ag2-h').textContent = r.title; $('ag2-sub').innerHTML = `${esc(r.sub)} · owner ${uname(r.owner)}`;
    $('ag2-body').innerHTML = `
      <div class="sx-sec">Grant investor access</div>
      <div class="ag2-grant"><input id="ag2-who" class="f-input" placeholder="Search approved investors by name, email, company…" oninput="ag2Find(this.value)" autocomplete="off"/><div id="ag2-hits" class="ag2-hits"></div>
        <div class="ag2-row" style="margin-top:8px"><label class="ag2-m"><input type="checkbox" id="ag2-dl"/> Allow downloads</label><label class="ag2-m">Expires <input type="date" id="ag2-exp" class="f-input" style="width:auto;display:inline-block;padding:4px 8px" value="${new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)}"/></label></div>
        <div class="ag2-m" style="margin-top:6px">Share only with the owner's agreement. BANAHUB does not promise introductions or funding.</div></div>
      <div class="sx-sec">Who has access</div>
      ${acc.length ? `<table class="data-table"><thead><tr><th>Investor</th><th>Granted</th><th>Expires</th><th>Download</th><th>Views</th><th></th></tr></thead><tbody>${acc.map(a => `<tr style="${a.revoked_at ? 'opacity:.5' : ''}"><td>${uname(a.grantee_id)}</td><td>${fmtD(a.created_at)}</td><td>${a.expires_at ? fmtD(a.expires_at) : 'Never'}</td><td>${a.can_download ? 'Yes' : 'View only'}</td><td>${views.filter(v => v.viewer_id === a.grantee_id).length}</td><td>${a.revoked_at ? 'Revoked' : `<button class="btn btn-ghost btn-sm" onclick="ag2Revoke('${a.id}')">Revoke</button>`}</td></tr>`).join('')}</tbody></table>` : '<div class="ag2-m">Private — nobody has been granted access.</div>'}
      <div class="sx-sec">Files (${files.length})</div>
      ${files.length ? `<table class="data-table"><thead><tr><th>Name</th><th>Folder</th><th>Size</th><th>Views</th><th>Uploaded</th><th></th></tr></thead><tbody>${files.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.folder)}</td><td>${kb(f.size)}</td><td>${views.filter(v => v.file_id === f.id).length}</td><td>${fmtD(f.created_at)}</td><td><button class="btn btn-ghost btn-sm" onclick="ag2Open('${f.id}')">Open</button></td></tr>`).join('')}</tbody></table>` : '<div class="ag2-m">No files uploaded.</div>'}
      <div class="sx-sec">Recent activity</div>
      ${views.length ? `<div class="ag2-log">${views.slice(0, 40).map(v => `<div>${uname(v.viewer_id)} ${v.action === 'download' ? 'downloaded' : 'viewed'} <b>${esc((files.find(f => f.id === v.file_id) || {}).name || '')}</b> <span class="ag2-m">${new Date(v.viewed_at).toLocaleString('en-SG')}</span></div>`).join('')}</div>` : '<div class="ag2-m">No views yet.</div>'}`;
    $('modal-ag2').style.display = 'flex';
  }
  let findT;
  function find(v) {
    clearTimeout(findT); const H = $('ag2-hits'); v = String(v || '').trim().replace(/[,%()*]/g, ' ');
    if (v.length < 2) { H.innerHTML = ''; return; }
    findT = setTimeout(async () => {
      const like = `%${v}%`;
      const rows = await q(sb().from('users').select('id,full_name,email,company_name,role,member_category,status').or(`full_name.ilike.${like},email.ilike.${like},company_name.ilike.${like}`).eq('status', 'approved').limit(8)).catch(() => []);
      H.innerHTML = (rows || []).filter(u => u.id !== (X.room || {}).owner).map(u => `<button type="button" onclick="ag2Grant('${u.id}')"><b>${esc(u.full_name || u.email)}</b> <span class="ag2-m">${esc([u.company_name, u.member_category || u.role, u.email].filter(Boolean).join(' · '))}</span></button>`).join('') || '<div class="ag2-m" style="padding:8px">No approved members match.</div>';
    }, 250);
  }
  async function grant(uid) {
    const r = X.room; if (!r) return;
    try {
      const exp = $('ag2-exp').value;
      await q(sb().from('data_room_access').insert({ deal_room_id: r.deal_room_id, investor_id: r.investor_id, grantee_id: uid, granted_by: OS().uid || null, can_download: $('ag2-dl').checked, expires_at: exp ? new Date(exp + 'T23:59:59+08:00').toISOString() : null }));
      notify('Access granted'); await loadRooms(); roomModal(r.key);
    } catch (e) { notify(/duplicate|unique/i.test(e.message) ? 'That investor already has access' : e.message, 'error'); }
  }
  async function revoke(id) { if (!confirm('Revoke this investor\'s access now?')) return; try { await q(sb().from('data_room_access').update({ revoked_at: new Date().toISOString() }).eq('id', id)); notify('Access revoked'); await loadRooms(); roomModal(X.room.key); } catch (e) { notify(e.message, 'error'); } }
  async function openFile(id) {
    try { const { data, error } = await sb().functions.invoke('dataroom', { body: { action: 'open', file_id: id } }); if (error || !data || data.error) throw new Error((data && data.error) || (error && error.message) || 'Could not open');
      if (window.BanaViewer) window.BanaViewer.open({ url: data.url, name: data.name, mime: data.mime, canDownload: true }); else window.open(data.url, '_blank', 'noopener');
    } catch (e) { notify(e.message, 'error'); }
  }
  async function limits() {
    const c = X.dr, ask = (k, label) => { const v = prompt(label, c[k]); return v == null ? c[k] : Number(v); };
    const next = Object.assign({}, c, { free_rooms: ask('free_rooms', 'Free plan — data rooms'), free_files: ask('free_files', 'Free plan — max files'), free_mb: ask('free_mb', 'Free plan — storage (MB)'), paid_files: ask('paid_files', 'Member plan — max files'), paid_mb: ask('paid_mb', 'Member plan — storage (MB)') });
    if (Object.values(next).some(v => typeof v === 'number' && (isNaN(v) || v < 0))) return notify('Limits must be positive numbers', 'error');
    next.enabled = confirm('Keep data room uploads ENABLED? (Cancel = disable uploads)');
    try { await q(sb().from('site_settings').upsert({ key: 'data_room', value: next, updated_at: new Date().toISOString(), updated_by: OS().uid || null })); notify('Data room limits saved'); loadRooms(); } catch (e) { notify(e.message, 'error'); }
  }

  /* ---------------- Pitch practice ---------------- */
  async function loadPitch() {
    const P = $('panel-os-pitch'); P.innerHTML = '<div class="os-empty">Loading…</div>';
    try {
      const [cfg, s] = await Promise.all([
        q(sb().from('site_settings').select('value').eq('key', 'pitch_practice').maybeSingle()).then(r => (r && r.value) || {}),
        q(sb().from('pitch_sessions').select('id,user_id,mode,persona,difficulty,status,score,summary,turns,created_at').order('created_at', { ascending: false }).limit(500)),
      ]);
      X.pp = cfg; X.sessions = s || [];
      const ids = [...new Set(X.sessions.map(x => x.user_id))]; X.users = X.users || {};
      if (ids.length) (await q(sb().from('users').select('id,full_name,email,company_name,role,member_category,status').in('id', ids)) || []).forEach(u => { X.users[u.id] = u; });
      drawPitch();
    } catch (e) { P.innerHTML = `<div class="card os-empty">${esc(e.message)}</div>`; }
  }
  function drawPitch() {
    const c = X.pp, S = X.sessions, done = S.filter(s => s.score && s.score.overall != null), month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    const avg = done.length ? (done.reduce((a, s) => a + Number(s.score.overall), 0) / done.length).toFixed(1) : '—';
    const paidOnly = new Set(c.paid_only_personas || []), allKeys = [...new Set([...Object.keys(PERSONAS.founder), ...Object.keys(PERSONAS.lp)])];
    $('panel-os-pitch').innerHTML = `
      <div class="ag2-kpis">${[['Sessions this month', S.filter(s => new Date(s.created_at) >= month).length], ['All sessions', S.length], ['Members practising', new Set(S.map(s => s.user_id)).size], ['Avg score', avg + (done.length ? '/10' : '')], ['LP pitch sessions', S.filter(s => s.mode === 'lp').length]].map(k => `<div class="card ag2-kpi"><b>${k[1]}</b><span>${k[0]}</span></div>`).join('')}</div>
      <div class="card" style="padding:16px;margin-bottom:14px">
        <div class="ag2-row"><b>Settings</b><span class="ag2-m">Applied immediately — enforced by the pitch-coach function</span></div>
        <div class="ag2-set">
          <label><input type="checkbox" id="pp-on" ${c.enabled === false ? '' : 'checked'}/> Pitch Practice enabled</label>
          <label>Free sessions / month <input type="number" min="0" id="pp-free" class="f-input" value="${c.free_cap ?? 1}"/></label>
          <label>Member sessions / month <input type="number" min="0" id="pp-paid" class="f-input" value="${c.paid_cap ?? 10}"/></label>
          <label>Max exchanges / session <input type="number" min="4" max="60" id="pp-turns" class="f-input" value="${c.max_turns ?? 30}"/></label></div>
        <div class="ag2-m" style="margin:10px 0 6px">Member-only personas (free members can't pick these):</div>
        <div class="ag2-chips">${allKeys.map(k => `<label class="${paidOnly.has(k) ? 'on' : ''}"><input type="checkbox" class="pp-po" value="${k}" ${paidOnly.has(k) ? 'checked' : ''} onchange="this.parentNode.classList.toggle('on',this.checked)"/> ${esc(PERSONAS.founder[k] || PERSONAS.lp[k])}</label>`).join('')}</div>
        <div class="ag2-row" style="margin-top:12px"><button class="btn btn-primary btn-sm" onclick="ag2SavePitch()">Save settings</button><span class="ag2-m">Voice: browser speech (free). AI: needs <code>ANTHROPIC_API_KEY</code> in Supabase secrets.</span></div></div>
      ${S.length ? `<div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr><th>Member</th><th>Type</th><th>Persona</th><th>Exchanges</th><th>Score</th><th>Verdict</th><th>Date</th><th></th></tr></thead><tbody>
        ${S.slice(0, 200).map(s => `<tr><td>${uname(s.user_id)}</td><td>${s.mode === 'lp' ? 'LP pitch' : 'Investor pitch'}</td><td>${esc(pl(s.mode, s.persona))} <span class="ag2-m">${esc(s.difficulty)}</span></td><td>${s.turns || 0}</td><td><b>${s.score && s.score.overall != null ? s.score.overall + '/10' : s.status}</b></td><td class="ag2-m" style="max-width:320px">${esc(s.summary || '')}</td><td>${fmtD(s.created_at)}</td><td><button class="btn btn-ghost btn-sm" onclick="ag2Session('${s.id}')">View</button></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="card os-empty">No practice sessions yet.</div>'}`;
  }
  async function savePitch() {
    const next = Object.assign({}, X.pp, { enabled: $('pp-on').checked, free_cap: Math.max(0, Number($('pp-free').value) || 0), paid_cap: Math.max(0, Number($('pp-paid').value) || 0), max_turns: Math.min(60, Math.max(4, Number($('pp-turns').value) || 30)), paid_only_personas: [...document.querySelectorAll('.pp-po:checked')].map(i => i.value) });
    try { await q(sb().from('site_settings').upsert({ key: 'pitch_practice', value: next, updated_at: new Date().toISOString(), updated_by: OS().uid || null })); X.pp = next; notify('Pitch Practice settings saved'); } catch (e) { notify(e.message, 'error'); }
  }
  async function session(id) {
    try {
      const s = await q(sb().from('pitch_sessions').select('*').eq('id', id).maybeSingle()); if (!s) return;
      const sc = s.score || {}, li = a => (a || []).map(x => `<li>${esc(x)}</li>`).join('');
      $('ag2-h').textContent = `${pl(s.mode, s.persona)} · ${s.mode === 'lp' ? 'LP pitch' : 'Investor pitch'}`; $('ag2-sub').innerHTML = `${uname(s.user_id)} · ${new Date(s.created_at).toLocaleString('en-SG')} · ${esc(s.difficulty)}`;
      $('ag2-body').innerHTML = `${sc.overall != null ? `<div class="ag2-row"><b style="font-size:28px;color:#003527">${sc.overall}/10</b><span>${esc(sc.verdict || '')}</span></div>
        <table class="sx-kv">${Object.entries(sc.categories || {}).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}/10</td></tr>`).join('')}</table>
        <div class="sx-sec">Strengths</div><ul>${li(sc.strengths)}</ul><div class="sx-sec">Improvements</div><ul>${li(sc.improvements)}</ul>` : `<div class="ag2-m">Not scored (${esc(s.status)}).</div>`}
        <div class="sx-sec">Transcript</div><div class="ag2-tr">${(s.transcript || []).map(m => `<div class="${m.role === 'me' ? 'me' : ''}"><b>${m.role === 'me' ? 'Member' : 'Investor'}:</b> ${esc(m.text)}</div>`).join('')}</div>`;
      $('modal-ag2').style.display = 'flex';
    } catch (e) { notify(e.message, 'error'); }
  }

  /* ---------------- Agent control ---------------- */
  const AGENTS = [
    ['ben', 'Ben — chief of staff', 'Admin OS', 'AI assistant for you: briefs, deck review, readiness, market analysis, articles, actions.', 'smart_toy'],
    ['pitch_founder', 'Practice your investor pitch', 'Members · companies', 'Voice role-play with an AI investor, then a scorecard.', 'mic'],
    ['pitch_lp', 'Practice your LP pitch', 'Members · fund managers', 'Voice role-play with an AI LP, then a scorecard.', 'record_voice_over'],
    ['deal_memo', 'Deal memo writer', 'Members', 'Drafts an investment memo from a data room.', 'description'],
    ['objection_advisor', 'Objection advisor', 'Members', 'Coaching on how to answer tough investor / LP objections.', 'forum'],
    ['dataroom_ai', 'Ask this data room', 'Investors with access', 'Q&A over the files an investor can see.', 'folder_shared'],
  ];
  const ST = { live: ['Live', '#0a5c40', '#e3f1e8'], maintenance: ['Maintenance', '#7a5000', '#fff4d6'], coming_soon: ['Coming soon', '#1d3d6b', '#e6eef9'], off: ['Off', '#5a5a5a', '#eeeeee'] };
  async function loadCtl() {
    const P = $('panel-os-agentctl'); P.innerHTML = '<div class="os-empty">Loading…</div>';
    try {
      X.ag = await q(sb().from('site_settings').select('value,updated_at').eq('key', 'agents').maybeSingle()).then(r => r || {});
      const health = window.Ben && Ben.__B ? Ben.__B : {};
      P.innerHTML = `
        <div class="card" style="padding:14px;margin-bottom:14px"><div class="ag2-row"><span class="material-symbols-outlined" style="color:${health.ai ? '#0a5c40' : '#a3261d'}">${health.ai ? 'check_circle' : 'error'}</span><b>AI engine</b>
          <span class="ag2-m">${health.ai ? 'Connected — Anthropic key accepted' : esc(health.aiReason || 'Not connected — check ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets')}</span><span style="flex:1"></span><button class="btn btn-ghost btn-sm" onclick="ag2Recheck()">Re-check</button></div>
          <div class="ag2-m" style="margin-top:6px">Live = available · Maintenance = visible but paused (sessions saved) · Coming soon = visible, can't start · Off = hidden from members. Changes apply immediately and are enforced on the server.</div></div>
        <div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr><th>Agent</th><th>Who sees it</th><th>Status</th><th>Message shown to users (optional)</th><th></th></tr></thead><tbody>
        ${AGENTS.map(([k, n, who, d, ic]) => { const a = (X.ag.value || {})[k] || { status: 'live' }; const s0 = ST[a.status] || ST.live; return `<tr>
          <td><div class="ag2-row" style="flex-wrap:nowrap"><span class="material-symbols-outlined" style="color:#003527">${ic}</span><div><b>${esc(n)}</b><div class="ag2-m">${esc(d)}</div></div></div></td>
          <td class="ag2-m">${esc(who)}</td>
          <td><select class="f-input ag2-st" data-k="${k}" style="min-width:150px" onchange="this.style.color=({live:'#0a5c40',maintenance:'#7a5000',coming_soon:'#1d3d6b',off:'#5a5a5a'})[this.value]">${Object.entries(ST).map(([v, l]) => `<option value="${v}" ${a.status === v ? 'selected' : ''}>${l[0]}</option>`).join('')}</select>
            <div><span class="ag2-pill" style="color:${s0[1]};background:${s0[2]}">${s0[0]}</span></div></td>
          <td><input class="f-input ag2-msg" data-k="${k}" maxlength="160" placeholder="e.g. Launching 1 December" value="${esc(a.message || '')}"/></td>
          <td><button class="btn btn-primary btn-sm" onclick="ag2SaveAgent('${k}')">Save</button></td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="ag2-m" style="margin-top:10px">Last change: ${X.ag.updated_at ? new Date(X.ag.updated_at).toLocaleString('en-SG') : '—'} · Plan limits for Pitch Practice live in <a href="#" onclick="nav('os-pitch');return false">Pitch Practice</a>.</div>`;
    } catch (e) { P.innerHTML = `<div class="card os-empty">${esc(e.message)}</div>`; }
  }
  async function saveAgent(k) {
    const st = document.querySelector(`.ag2-st[data-k="${k}"]`).value, msg = document.querySelector(`.ag2-msg[data-k="${k}"]`).value.trim().slice(0, 160);
    try {
      const cur = await q(sb().from('site_settings').select('value').eq('key', 'agents').maybeSingle()).then(r => (r && r.value) || {});
      cur[k] = { status: st, message: msg, updated_at: new Date().toISOString() };
      await q(sb().from('site_settings').upsert({ key: 'agents', value: cur, updated_at: new Date().toISOString(), updated_by: OS().uid || null }));
      try { await sb().from('activity_logs').insert({ action: 'admin.agent_status', category: 'admin', description: `${k} → ${st}` }); } catch (e) { }
      notify(`${(AGENTS.find(a => a[0] === k) || [0, k])[1]} → ${ST[st][0]}`);
      if (k === 'ben' && window.Ben && Ben.refresh) Ben.refresh();
      loadCtl();
    } catch (e) { notify(e.message, 'error'); }
  }
  async function recheck() { if (window.Ben && Ben.refresh) await Ben.refresh(); setTimeout(loadCtl, 400); }

  const prev = window.loadPanel;
  window.loadPanel = function (p) { if (p === 'os-agentctl') { inject(); return loadCtl(); } if (p === 'os-datarooms') { inject(); return loadRooms(); } if (p === 'os-pitch') { inject(); return loadPitch(); } return prev && prev(p); };
  function ag2Ben() {
    if (!window.Ben || !Ben.ask) return notify('Ben is still loading', 'warn');
    const r = X.room;
    if (r && $('ag2-grant-wrap') !== null) {}
    if (r && $('ag2-who')) Ben.ask(`Review the data room "${r.title}" (${r.deal_room_id ? 'deal_room_id ' + r.deal_room_id : 'investor_id ' + r.investor_id}): list what's there against a standard investor due-diligence checklist, what's missing, the quality of the key documents (read the most important ones), and what the owner should add next.`);
    else Ben.ask('Review the last pitch practice session shown and suggest how this member should improve.');
  }
  Object.assign(window, { ag2SaveAgent: saveAgent, ag2Recheck: recheck, ag2Ben, ag2Room: roomModal, ag2Find: find, ag2Grant: grant, ag2Revoke: revoke, ag2Open: openFile, ag2Limits: limits, ag2Q: v => { X.q = v; drawRooms(); }, ag2SavePitch: savePitch, ag2Session: session, __AG2: X });

  const MODAL = `<div id="modal-ag2" class="modal-overlay" style="display:none;z-index:1050" onclick="if(event.target===this)closeModal('modal-ag2')"><div class="modal modal-lg" style="max-width:900px">
    <div class="modal-header"><div><div class="modal-title" id="ag2-h"></div><div class="modal-sub" id="ag2-sub"></div></div><button class="modal-close" onclick="closeModal('modal-ag2')">✕</button></div>
    <div class="modal-body" id="ag2-body"></div><div class="modal-footer"><button class="btn btn-ghost" id="ag2-ben" onclick="ag2Ben()">✦ Ask Ben to review</button><span style="flex:1"></span><button class="btn btn-ghost" onclick="closeModal('modal-ag2')">Close</button></div></div></div>`;
  const CSS = `.ag2-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px}.ag2-kpi{padding:12px 14px!important}.ag2-kpi b{display:block;font-size:22px;color:#003527}.ag2-kpi span{font-size:12px;color:var(--ink)}
  .ag2-pill{display:inline-block;margin-top:4px;font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px}
  .ag2-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--ink)}.ag2-m{font-size:12px;color:var(--white-dim)}
  .ag2-set{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:10px}.ag2-set label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--ink)}.ag2-set label:first-child{flex-direction:row;align-items:center}
  .ag2-chips{display:flex;flex-wrap:wrap;gap:6px}.ag2-chips label{border:1px solid var(--border-2);border-radius:999px;padding:4px 10px;font-size:12.5px;cursor:pointer;color:var(--ink)}.ag2-chips label.on{background:#003527;color:#fff;border-color:#003527}.ag2-chips input{display:none}
  .ag2-grant{position:relative}.ag2-hits{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:10px;margin-top:4px;max-height:240px;overflow:auto;background:#fff}.ag2-hits:empty{display:none}
  .ag2-hits button{border:0;background:none;text-align:left;padding:8px 10px;cursor:pointer;font:inherit;font-size:13px;color:var(--ink)}.ag2-hits button:hover{background:#eef3ef}
  .ag2-log div{font-size:12.5px;padding:5px 0;border-bottom:1px solid var(--border);color:var(--ink)}
  .ag2-tr{max-height:360px;overflow:auto;font-size:13px;color:var(--ink)}.ag2-tr div{padding:6px 8px;border-radius:8px;margin:4px 0;background:#f4f6f3}.ag2-tr div.me{background:#e4efe7}`;

  const t = setInterval(() => { if (inject()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 30000);
})();
