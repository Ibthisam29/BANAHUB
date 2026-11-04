/* BANAHUB member dashboard — Data Room.
 * One room per company raise (deal_rooms) or per investor / fund profile (investors). Private bucket `dataroom` (<uid>/…).
 * Owners: folders, upload, rename / move / delete, view counts, activity log, access list.
 * Investors granted access by BANAHUB: "Shared with me" rooms, watermarked viewer, downloads only if allowed.
 * Plan limits enforced in the database (trigger data_room_files_limits); file opening via the `dataroom` edge function.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sbc = () => window.getBanaSupabaseClient();
  const kb = n => n == null ? '—' : n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const ago = d => { const s = (Date.now() - new Date(d)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  const FOLDERS = { raise: ['Overview', 'Pitch deck', 'Financials', 'Legal & corporate', 'Cap table', 'Team', 'Product & traction', 'Customers & contracts', 'Other'], fund: ['Fund overview', 'Track record', 'Legal (LPA / PPM)', 'Team', 'Portfolio', 'Reporting', 'Other'] };
  const ICON = { pdf: ['picture_as_pdf', '#b3261e'], doc: ['description', '#1d4ed8'], sheet: ['table_chart', '#0a7d43'], slides: ['slideshow', '#c2410c'], image: ['image', '#7c3aed'], video: ['movie', '#0e7490'], other: ['draft', '#4a524d'] };
  const typeOf = n => { const e = (String(n).split('.').pop() || '').toLowerCase(); return e === 'pdf' ? 'pdf' : ['doc', 'docx', 'txt', 'md', 'rtf'].includes(e) ? 'doc' : ['xls', 'xlsx', 'csv'].includes(e) ? 'sheet' : ['ppt', 'pptx', 'key'].includes(e) ? 'slides' : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e) ? 'image' : ['mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a'].includes(e) ? 'video' : 'other'; };
  const TLABEL = { pdf: 'PDF', doc: 'Document', sheet: 'Spreadsheet', slides: 'Presentation', image: 'Image', video: 'Media', other: 'File' };
  const D = { uid: null, rooms: [], shared: [], room: null, files: [], views: [], access: [], names: {}, folder: '', tab: 'contents', q: '', cfg: {}, paid: false, extraFolders: {}, sel: null };

  function inject() {
    const prof = document.querySelector('.nav-item[onclick*="switchTab(\'profile\'"]'), top = $('top-profile');
    if (!prof || !top || !$('panel-profile') || $('panel-dataroom')) return !!$('panel-dataroom');
    prof.insertAdjacentHTML('beforebegin', `<button class="nav-item" onclick="switchTab('dataroom',this)"><span class="mat-ic material-symbols-outlined">folder_shared</span>Data Room</button>`);
    top.insertAdjacentHTML('beforebegin', `<button class="tab-btn" id="top-dataroom" onclick="switchTab('dataroom',null,'top-dataroom')">Data Room</button>`);
    $('panel-profile').insertAdjacentHTML('beforebegin', '<div class="panel" id="panel-dataroom"><div id="dr-root"></div></div>');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const orig = window.switchTab; window.switchTab = function (id) { const r = orig.apply(this, arguments); if (id === 'dataroom') load(); return r; };
    if (/[?&]tab=dataroom/.test(location.search)) setTimeout(() => window.switchTab('dataroom', null, 'top-dataroom'), 300);
    return true;
  }

  async function load() {
    const root = $('dr-root'); root.innerHTML = '<div class="dr-load">Loading…</div>';
    try {
      const sb = await sbc(); const { data: { user } } = await sb.auth.getUser(); if (!user) { root.innerHTML = '<div class="glass-card sect">Please sign in.</div>'; return; }
      D.uid = user.id;
      const [raises, inv, shared, cfg, plan] = await Promise.all([
        sb.from('deal_rooms').select('id,company_name,stage,review_status').eq('submitted_by', user.id).order('created_at', { ascending: false }).then(r => r.data || [], () => []),
        sb.from('investors').select('id,organization,investor_type').eq('user_id', user.id).maybeSingle().then(r => r.data, () => null),
        sb.rpc('dr_shared_rooms').then(r => r.data || [], () => []),
        sb.from('site_settings').select('value').eq('key', 'data_room').maybeSingle().then(r => (r.data && r.data.value) || {}, () => ({})),
        sb.rpc('membership_effective_plan', { uid: user.id }).then(r => r.data, () => null),
      ]);
      D.cfg = cfg; D.paid = !!plan && plan !== 'free';
      D.rooms = [...raises.map(r => ({ key: 'r:' + r.id, kind: 'raise', deal_room_id: r.id, investor_id: null, title: r.company_name || 'My raise', sub: [r.stage, 'Company raise'].filter(Boolean).join(' · '), own: true })),
        ...(inv ? [{ key: 'i:' + inv.id, kind: 'fund', deal_room_id: null, investor_id: inv.id, title: inv.organization || 'My fund', sub: [inv.investor_type, 'Fund / investor'].filter(Boolean).join(' · '), own: true }] : [])];
      D.shared = shared.map(s => ({ key: (s.deal_room_id ? 'r:' : 'i:') + (s.deal_room_id || s.investor_id), kind: s.deal_room_id ? 'raise' : 'fund', deal_room_id: s.deal_room_id, investor_id: s.investor_id, title: s.title, sub: s.subtitle, own: false, can_download: s.can_download, expires_at: s.expires_at }));
      try { D.extraFolders = JSON.parse(localStorage.getItem('dr-folders') || '{}'); } catch (e) { D.extraFolders = {}; }
      if (!D.room || ![...D.rooms, ...D.shared].some(r => r.key === D.room.key)) D.room = D.rooms[0] || D.shared[0] || null;
      if (D.room) await openRoom(D.room.key, true); else empty();
    } catch (e) { root.innerHTML = `<div class="glass-card sect" style="color:#ba1a1a">${esc(e.message)}</div>`; }
  }
  function empty() {
    $('dr-root').innerHTML = `<div class="dr-hero"><div><div class="dr-eye">Data Room</div><h2>Share diligence files securely with investors</h2><p>Create a company raise or an investor profile first — each one gets its own private data room.</p></div></div>
      <div class="glass-card dr-steps"><div><b>1</b><span>Enter your raise or fund in <a href="#" onclick="switchTab('submit',null,'top-submit');return false">My Capital Raise</a> (free)</span></div><div><b>2</b><span>Upload your deck, financials and legal docs here</span></div><div><b>3</b><span>BANAHUB shares the room with approved, relevant investors — and you see who viewed what</span></div></div>`;
  }

  async function openRoom(key, keepFolder) {
    D.room = [...D.rooms, ...D.shared].find(r => r.key === key); if (!D.room) return;
    if (!keepFolder) D.folder = ''; D.sel = null;
    const sb = await sbc(), col = D.room.deal_room_id ? 'deal_room_id' : 'investor_id', id = D.room.deal_room_id || D.room.investor_id;
    D.files = (await sb.from('data_room_files').select('*').eq(col, id).order('folder').order('name')).data || [];
    D.views = []; D.access = []; D.names = {};
    if (D.room.own) {
      const ids = D.files.map(f => f.id);
      const [v, a] = await Promise.all([
        ids.length ? sb.from('data_room_views').select('file_id,viewer_id,action,viewed_at').in('file_id', ids).order('viewed_at', { ascending: false }).limit(500).then(r => r.data || [], () => []) : [],
        sb.from('data_room_access').select('id,grantee_id,can_download,expires_at,revoked_at,created_at').eq(col, id).then(r => r.data || [], () => []),
      ]);
      D.views = v; D.access = a;
      const people = [...new Set([...v.map(x => x.viewer_id), ...a.map(x => x.grantee_id)])];
      if (people.length) ((await sb.rpc('dr_viewer_names', { p_ids: people })).data || []).forEach(p => { D.names[p.id] = p; });
    }
    draw();
  }

  const folders = () => { const base = FOLDERS[D.room.kind] || FOLDERS.raise; const used = [...new Set(D.files.map(f => f.folder))]; const extra = D.extraFolders[D.room.key] || []; return [...new Set([...base, ...used, ...extra])]; };
  const viewsOf = id => D.views.filter(v => v.file_id === id);
  function usage() {
    const mine = D.files.filter(f => f.owner_id === D.uid), lim = D.paid ? { f: D.cfg.paid_files || 500, mb: D.cfg.paid_mb || 5000 } : { f: D.cfg.free_files || 10, mb: D.cfg.free_mb || 100 };
    const mb = mine.reduce((s, f) => s + (Number(f.size) || 0), 0) / 1048576;
    return { files: mine.length, mb, lim, pct: Math.min(100, Math.max(mine.length / lim.f, mb / lim.mb) * 100) };
  }

  function draw() {
    const R = D.room, own = R.own, F = folders(), qs = D.q.toLowerCase();
    const list = D.files.filter(f => (!D.folder || f.folder === D.folder) && (!qs || (f.name + ' ' + f.folder).toLowerCase().includes(qs)));
    const roomBtn = r => `<button type="button" class="dr-room ${D.room.key === r.key ? 'on' : ''}" onclick="drRoom('${r.key}')"><span class="material-symbols-outlined">${r.own ? (r.kind === 'fund' ? 'account_balance' : 'rocket_launch') : 'folder_shared'}</span><span><b>${esc(r.title)}</b><em>${esc(r.sub || '')}</em></span></button>`;
    const U = own ? usage() : null;
    const totalViews = D.views.filter(v => v.action === 'view').length, viewers = new Set(D.views.map(v => v.viewer_id)).size;
    $('dr-root').innerHTML = `
      <div class="dr-hero"><div><div class="dr-eye">Data Room</div><h2>${esc(R.title)}</h2><p>${own ? 'Private by default. BANAHUB shares your room only with approved investors you agree to — you see every view.' : `Shared with you by BANAHUB${R.expires_at ? ' until ' + fmtD(R.expires_at) : ''}. Confidential — do not forward.`}</p></div>
        ${own ? `<div class="dr-kpis"><div><b>${D.files.length}</b><span>files</span></div><div><b>${viewers}</b><span>investors viewed</span></div><div><b>${totalViews}</b><span>views</span></div><div><b>${D.access.filter(a => !a.revoked_at).length}</b><span>with access</span></div></div>` : ''}</div>
      <div class="dr-shell">
        <aside class="dr-side glass-card">
          ${D.rooms.length ? `<div class="dr-lab">My rooms</div>${D.rooms.map(roomBtn).join('')}` : ''}
          ${D.shared.length ? `<div class="dr-lab">Shared with me</div>${D.shared.map(roomBtn).join('')}` : ''}
          <div class="dr-lab">Folders</div>
          <button type="button" class="dr-fold ${!D.folder ? 'on' : ''}" onclick="drFolder('')"><span class="material-symbols-outlined">home</span>All files<i>${D.files.length}</i></button>
          ${F.map(f => { const n = D.files.filter(x => x.folder === f).length; return (own || n) ? `<button type="button" class="dr-fold ${D.folder === f ? 'on' : ''}" onclick="drFolder(${esc(JSON.stringify(f))})"><span class="material-symbols-outlined">folder</span>${esc(f)}<i>${n || ''}</i></button>` : ''; }).join('')}
          ${own ? `<button type="button" class="dr-fold add" onclick="drNewFolder()"><span class="material-symbols-outlined">create_new_folder</span>New folder</button>
            <div class="dr-usage"><div class="dr-ubar"><i style="width:${U.pct}%;${U.pct > 85 ? 'background:#a3261d' : ''}"></i></div><span>${U.files}/${U.lim.f} files · ${U.mb.toFixed(1)} / ${U.lim.mb >= 1000 ? (U.lim.mb / 1000) + ' GB' : U.lim.mb + ' MB'}</span>${D.paid ? '' : `<a href="#" onclick="switchTab('memberships',null,'top-memberships');return false">Upgrade for more space →</a>`}</div>` : ''}
        </aside>
        <section class="dr-main glass-card">
          <div class="dr-tabs">${['contents', ...(own ? ['activity', 'access'] : [])].map(t => `<button type="button" class="${D.tab === t ? 'on' : ''}" onclick="drTab('${t}')">${{ contents: 'Contents', activity: 'Activity', access: 'Access' }[t]}</button>`).join('')}</div>
          ${D.tab === 'activity' && own ? activity() : D.tab === 'access' && own ? accessView() : `
          <div class="dr-bar"><div class="dr-search"><span class="material-symbols-outlined">search</span><input id="dr-q" placeholder="Search files…" value="${esc(D.q)}" oninput="drSearch(this.value)"/></div>
            ${own ? `<label class="btn-p dr-up"><span class="material-symbols-outlined">upload</span> Upload<input type="file" id="dr-file" multiple hidden onchange="drUpload(this.files)"/></label>` : ''}</div>
          <div class="dr-crumb"><a href="#" onclick="drFolder('');return false">Home</a>${D.folder ? ` / <b>${esc(D.folder)}</b>` : ''}</div>
          ${own ? `<div class="dr-drop" id="dr-drop"><span class="material-symbols-outlined">cloud_upload</span> Drag files here to upload${D.folder ? ` to <b>${esc(D.folder)}</b>` : ''} · PDF, Word, Excel, PowerPoint, images, video · max 100 MB each</div>` : ''}
          <div id="dr-prog"></div>
          ${list.length ? `<div class="dr-table ${own ? 'own' : 'ro'}" role="table"><div class="dr-tr dr-th" role="row"><span>Name</span><span>Type</span><span>Size</span>${own ? '<span>Views</span>' : ''}<span>Modified</span><span></span></div>
            ${list.map(f => { const t = typeOf(f.name), ic = ICON[t], vc = viewsOf(f.id).length; return `<div class="dr-tr" role="row"><button type="button" class="dr-name" onclick="drOpen('${f.id}')"><span class="material-symbols-outlined" style="color:${ic[1]}">${ic[0]}</span><span><b>${esc(f.name)}</b>${!D.folder ? `<em>${esc(f.folder)}</em>` : ''}</span></button><span class="dr-c">${TLABEL[t]}</span><span class="dr-c">${kb(f.size)}</span>${own ? `<span class="dr-c">${vc || '–'}</span>` : ''}<span class="dr-c">${fmtD(f.created_at)}</span>
              <span class="dr-act"><button type="button" title="Open" onclick="drOpen('${f.id}')"><span class="material-symbols-outlined">visibility</span></button>${own || R.can_download ? `<button type="button" title="Download" onclick="drDownload('${f.id}')"><span class="material-symbols-outlined">download</span></button>` : ''}${own ? `<button type="button" title="Rename / move" onclick="drEdit('${f.id}')"><span class="material-symbols-outlined">edit</span></button><button type="button" title="Delete" onclick="drDelete('${f.id}')"><span class="material-symbols-outlined">delete</span></button>` : ''}</span></div>`; }).join('')}</div>`
        : `<div class="dr-empty"><span class="material-symbols-outlined">folder_open</span><b>${D.q ? 'No files match your search' : own ? 'No files here yet' : 'No files in this folder'}</b>${own && !D.q ? `<span>Start with: pitch deck, financial model, cap table, incorporation docs${D.room.kind === 'fund' ? ', track record, LPA / PPM' : ''}.</span>` : ''}</div>`}`}
        </section>
      </div>`;
    const dz = $('dr-drop');
    if (dz) { ['dragenter', 'dragover'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('over'); })); ['dragleave', 'drop'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove('over'); })); dz.addEventListener('drop', ev => upload(ev.dataTransfer.files)); }
  }
  function activity() {
    if (!D.views.length) return '<div class="dr-empty"><span class="material-symbols-outlined">insights</span><b>No investor activity yet</b><span>When BANAHUB shares your room, every open and download shows up here.</span></div>';
    const byPerson = {}; D.views.forEach(v => { (byPerson[v.viewer_id] = byPerson[v.viewer_id] || []).push(v); });
    const name = id => { const p = D.names[id]; return p ? `${esc(p.full_name || 'Investor')}${p.company_name ? ' · ' + esc(p.company_name) : ''}` : 'BANAHUB team'; };
    const fname = id => esc((D.files.find(f => f.id === id) || {}).name || 'file');
    return `<div class="dr-sec">By investor</div><div class="dr-people">${Object.entries(byPerson).map(([id, vs]) => `<div class="dr-person"><b>${name(id)}</b><span>${vs.length} view${vs.length > 1 ? 's' : ''} · ${new Set(vs.map(v => v.file_id)).size} file(s) · last ${ago(vs[0].viewed_at)}</span></div>`).join('')}</div>
      <div class="dr-sec">Timeline</div><div class="dr-log">${D.views.slice(0, 100).map(v => `<div><span class="material-symbols-outlined">${v.action === 'download' ? 'download' : 'visibility'}</span><span>${name(v.viewer_id)} ${v.action === 'download' ? 'downloaded' : 'viewed'} <b>${fname(v.file_id)}</b></span><em>${ago(v.viewed_at)}</em></div>`).join('')}</div>`;
  }
  function accessView() {
    const act = D.access.filter(a => !a.revoked_at);
    return `<p class="dr-note">BANAHUB curates access: your room is shared only with approved investors whose mandate fits, and only after review. Want it shared with someone specific? <a href="mailto:hello@banahub.com?subject=Data%20room%20access%20-%20${encodeURIComponent(D.room.title)}">Ask BANAHUB</a>.</p>
      ${act.length ? `<div class="dr-people">${act.map(a => { const p = D.names[a.grantee_id] || {}; return `<div class="dr-person"><b>${esc(p.full_name || 'Investor')}${p.company_name ? ' · ' + esc(p.company_name) : ''}</b><span>Since ${fmtD(a.created_at)}${a.expires_at ? ' · until ' + fmtD(a.expires_at) : ''} · ${a.can_download ? 'can download' : 'view only (watermarked)'}</span></div>`; }).join('')}</div>` : '<div class="dr-empty"><span class="material-symbols-outlined">lock</span><b>Private — nobody else has access</b></div>'}`;
  }

  async function upload(list) {
    if (!D.room || !D.room.own || !list || !list.length) return;
    const sb = await sbc(), prog = $('dr-prog'), folder = D.folder || (FOLDERS[D.room.kind] || FOLDERS.raise)[0];
    let ok = 0;
    for (const f of [...list].slice(0, 20)) {
      const row = document.createElement('div'); row.className = 'dr-pr'; row.textContent = `Uploading ${f.name}…`; prog && prog.appendChild(row);
      try {
        if (f.size > 100 * 1048576) throw new Error('over 100 MB');
        const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120), path = `${D.uid}/${D.room.key.replace(':', '-')}/${Date.now()}-${safe}`;
        const up = await sb.storage.from('dataroom').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
        if (up.error) throw new Error(up.error.message);
        const ins = await sb.from('data_room_files').insert({ owner_id: D.uid, deal_room_id: D.room.deal_room_id, investor_id: D.room.investor_id, folder, name: f.name.slice(0, 200), path, mime: f.type || null, size: f.size });
        if (ins.error) { await sb.storage.from('dataroom').remove([path]); throw new Error(ins.error.message); }
        row.textContent = `✓ ${f.name}`; row.classList.add('ok'); ok++;
      } catch (e) { row.textContent = `✕ ${f.name} — ${e.message}`; row.classList.add('err'); }
    }
    if (ok) setTimeout(() => openRoom(D.room.key, true), 600);
  }
  async function fileUrl(id, download) {
    const sb = await sbc(); const { data, error } = await sb.functions.invoke('dataroom', { body: { action: 'open', file_id: id, download: !!download } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) { } throw new Error(m); }
    if (data && data.error) throw new Error(data.error); return data;
  }
  async function open(id) {
    try { const r = await fileUrl(id, false); if (!window.BanaViewer) { window.open(r.url, '_blank', 'noopener'); return; }
      window.BanaViewer.open({ url: r.url, name: r.name, mime: r.mime, watermark: r.watermark, canDownload: r.can_download, onDownload: () => download(id) });
    } catch (e) { alert(e.message); }
  }
  async function download(id) { try { const r = await fileUrl(id, true); const a = document.createElement('a'); a.href = r.url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { alert(e.message); } }
  async function edit(id) {
    const f = D.files.find(x => x.id === id); if (!f) return;
    const name = prompt('File name', f.name); if (name == null) return;
    const folder = prompt(`Folder (${folders().join(', ')})`, f.folder); if (folder == null) return;
    const sb = await sbc(); const r = await sb.from('data_room_files').update({ name: name.trim() || f.name, folder: folder.trim() || f.folder }).eq('id', id);
    if (r.error) return alert(r.error.message); openRoom(D.room.key, true);
  }
  async function del(id) {
    const f = D.files.find(x => x.id === id); if (!f || !confirm(`Delete “${f.name}”? Investors with access will no longer see it.`)) return;
    const sb = await sbc(); const r = await sb.from('data_room_files').delete().eq('id', id); if (r.error) return alert(r.error.message);
    await sb.storage.from('dataroom').remove([f.path]); openRoom(D.room.key, true);
  }
  function newFolder() {
    const n = (prompt('New folder name') || '').trim().slice(0, 80); if (!n) return;
    (D.extraFolders[D.room.key] = D.extraFolders[D.room.key] || []).push(n); try { localStorage.setItem('dr-folders', JSON.stringify(D.extraFolders)); } catch (e) { }
    D.folder = n; draw();
  }
  let qT; Object.assign(window, {
    drRoom: k => { D.tab = 'contents'; openRoom(k); }, drFolder: f => { D.folder = f; D.tab = 'contents'; draw(); }, drTab: t => { D.tab = t; draw(); },
    drSearch: v => { D.q = v; clearTimeout(qT); qT = setTimeout(() => { draw(); const i = $('dr-q'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 200); },
    drUpload: upload, drOpen: open, drDownload: download, drEdit: edit, drDelete: del, drNewFolder: newFolder, __DR: D,
  });

  const CSS = `#panel-dataroom{max-width:1180px}.dr-load{padding:40px;text-align:center;color:#3a433e}
  .dr-hero{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}.dr-hero h2{margin:4px 0 6px;font-size:24px;color:#0d1b14}.dr-hero p{margin:0;color:#3a433e;max-width:620px}
  .dr-eye{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#735c00}
  .dr-kpis{display:flex;gap:8px;flex-wrap:wrap}.dr-kpis div{background:#fff;border:1px solid rgba(0,53,39,.12);border-radius:12px;padding:8px 14px;min-width:84px}.dr-kpis b{display:block;font-size:20px;color:#003527}.dr-kpis span{font-size:11.5px;color:#3a433e}
  .dr-shell{display:grid;grid-template-columns:260px 1fr;gap:14px;align-items:start}
  .dr-side{padding:10px!important;position:sticky;top:10px;max-height:calc(100vh - 120px);overflow-y:auto}
  .dr-lab{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#3a433e;margin:12px 6px 6px}
  .dr-room,.dr-fold{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;text-align:left;padding:7px 8px;border-radius:9px;cursor:pointer;font:inherit;font-size:13.5px;color:#1b1c1a}
  .dr-room:hover,.dr-fold:hover{background:#f1f5f1}.dr-room.on,.dr-fold.on{background:#e4efe7;color:#003527;font-weight:600}
  .dr-room b{display:block;font-size:13.5px}.dr-room em{font-style:normal;font-size:11.5px;color:#3a433e}.dr-fold i{margin-left:auto;font-style:normal;font-size:11.5px;color:#3a433e}.dr-fold.add{color:#0a5c40}
  .dr-room .material-symbols-outlined,.dr-fold .material-symbols-outlined{font-size:19px;color:#4a524d}
  .dr-usage{margin:14px 6px 4px;font-size:11.5px;color:#3a433e;display:flex;flex-direction:column;gap:5px}.dr-usage a{color:#0a5c40;font-weight:600}
  .dr-ubar{height:6px;border-radius:9px;background:#e4e9e5;overflow:hidden}.dr-ubar i{display:block;height:100%;background:#003527}
  .dr-main{padding:0!important;min-width:0;overflow:hidden}
  .dr-tabs{display:flex;gap:2px;border-bottom:1px solid rgba(0,53,39,.1);padding:0 12px}.dr-tabs button{border:0;background:none;padding:12px 12px;font:600 13.5px inherit;color:#3a433e;cursor:pointer;border-bottom:2px solid transparent}.dr-tabs button.on{color:#003527;border-bottom-color:#003527}
  .dr-bar{display:flex;gap:10px;padding:12px;align-items:center}.dr-search{flex:1;display:flex;align-items:center;gap:6px;border:1px solid rgba(0,53,39,.18);border-radius:10px;padding:0 10px;background:#fff}.dr-search input{border:0;outline:0;flex:1;padding:9px 0;font:inherit;font-size:14px;color:#1b1c1a;background:none}
  .dr-up{display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
  .dr-crumb{padding:0 14px 8px;font-size:13px;color:#3a433e}.dr-crumb a{color:#0a5c40}
  .dr-drop{margin:0 12px 10px;border:1.5px dashed rgba(0,53,39,.25);border-radius:10px;padding:10px;text-align:center;font-size:12.5px;color:#3a433e;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap}.dr-drop.over{background:#e9f4ed;border-color:#0a5c40;color:#0a5c40}
  .dr-pr{margin:0 12px 4px;font-size:12.5px;color:#3a433e}.dr-pr.ok{color:#0a5c40}.dr-pr.err{color:#a3261d}
  .dr-table{overflow-x:auto}.dr-tr{display:grid;grid-template-columns:minmax(220px,1fr) 100px 80px 60px 110px 140px;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid rgba(0,53,39,.07);min-width:720px}
  .dr-table.ro .dr-tr{grid-template-columns:minmax(220px,1fr) 100px 80px 110px 100px}
  .dr-th{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#3a433e;border-top:0}
  .dr-name{display:flex;align-items:center;gap:10px;border:0;background:none;text-align:left;cursor:pointer;font:inherit;color:#1b1c1a;min-width:0;padding:4px 0}.dr-name b{display:block;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dr-name em{font-style:normal;font-size:11.5px;color:#3a433e}.dr-name>span:last-child{min-width:0}
  .dr-c{font-size:13px;color:#2b322e}.dr-act{display:flex;gap:2px;justify-content:flex-end}.dr-act button{border:0;background:none;cursor:pointer;color:#3a433e;padding:5px;border-radius:7px}.dr-act button:hover{background:#eef3ef;color:#003527}.dr-act .material-symbols-outlined{font-size:19px}
  .dr-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:40px 16px;text-align:center;color:#3a433e}.dr-empty .material-symbols-outlined{font-size:40px;color:#9aa59f}.dr-empty b{color:#0d1b14}
  .dr-sec{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#3a433e;margin:16px 14px 8px}
  .dr-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;padding:0 14px}.dr-person{border:1px solid rgba(0,53,39,.12);border-radius:10px;padding:10px 12px;background:#fff}.dr-person b{display:block;font-size:13.5px;color:#0d1b14}.dr-person span{font-size:12px;color:#3a433e}
  .dr-log{padding:0 14px 14px}.dr-log div{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(0,53,39,.06);font-size:13px;color:#1b1c1a}.dr-log em{margin-left:auto;font-style:normal;font-size:12px;color:#3a433e;white-space:nowrap}.dr-log .material-symbols-outlined{font-size:18px;color:#4a524d}
  .dr-note{margin:14px;font-size:13.5px;color:#2b322e}.dr-note a{color:#0a5c40;font-weight:600}
  .dr-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;padding:18px!important}.dr-steps div{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#1b1c1a}.dr-steps b{width:28px;height:28px;border-radius:50%;background:#003527;color:#fff;display:grid;place-items:center;flex:none}.dr-steps a{color:#0a5c40;font-weight:600}
  @media (max-width:900px){.dr-shell{grid-template-columns:1fr}.dr-side{position:static;max-height:none;display:flex;flex-wrap:wrap;gap:4px}.dr-side .dr-lab{width:100%}.dr-room,.dr-fold{width:auto;background:#f4f7f4}.dr-usage{width:100%}.dr-hero h2{font-size:20px}}`;

  let tries = 0; (function wait() { if (inject()) return; if (++tries < 60) setTimeout(wait, 250); })();
})();
