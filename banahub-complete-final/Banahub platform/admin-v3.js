/* BANAHub Admin OS — v3 modules
 * Visual page editor · Event/program previews · Memberships ·
 * Capital raises + investor matching · Investor/company directory + CSV/Excel import
 * Loaded after admin.html's inline script; uses its globals: api, toast, esc,
 * closeModal, logActivity, nav, events_db, programs_db.
 */
'use strict';

// ── small utils ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const money = (n, c) => (n || n === 0) && n !== '' ? `${c || 'USD'} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';
const arr = v => Array.isArray(v) ? v : (v ? String(v).split(/[;,|\n]/).map(s => s.trim()).filter(Boolean) : []);
const chips = (list, max = 3) => { const a = arr(list); return a.slice(0, max).map(s => `<span class="badge badge-blue" style="margin:1px">${esc(s)}</span>`).join('') + (a.length > max ? `<span style="font-size:11px;color:var(--white-muted)"> +${a.length - max}</span>` : ''); };
const emptyRow = (msg, cols = 1) => `<div style="padding:48px;text-align:center;color:var(--white-muted);grid-column:1/-1">${msg}</div>`;
function downloadFile(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function toCSV(rows, cols) {
  const q = v => { const s = Array.isArray(v) ? v.join('; ') : (v == null ? '' : String(v)); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map(c => c[1]).join(','), ...rows.map(r => cols.map(c => q(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\n');
}
function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const m = String(v).replace(/[, ]/g, '').match(/([\d.]+)\s*(k|m|mn|mm|b|bn)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]), u = (m[2] || '').toLowerCase();
  return n * (u === 'k' ? 1e3 : (u === 'm' || u === 'mn' || u === 'mm') ? 1e6 : (u === 'b' || u === 'bn') ? 1e9 : 1);
}
function parseRange(text) {
  const parts = String(text || '').split(/\s*(?:-|–|to)\s*/i).map(parseMoney).filter(n => n != null);
  return parts.length ? [Math.min(...parts), Math.max(...parts)] : [null, null];
}
let _xlsxReady = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return _xlsxReady || (_xlsxReady = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Could not load Excel parser'));
    document.head.appendChild(s);
  }));
}

// ═════════════════════════════════════════════════════════════════════════
// 1. PREVIEW MODAL (event pages, programs, any site page) — embedded iframe
// ═════════════════════════════════════════════════════════════════════════
function openPreview(url, title) {
  $('pv-title').textContent = title || 'Preview';
  $('pv-url').textContent = url;
  $('pv-open').href = url;
  $('pv-frame').src = url;
  $('modal-preview').style.display = 'flex';
}
function previewDevice(w, btn) {
  $('pv-frame').style.width = w;
  document.querySelectorAll('#modal-preview .pv-dev').forEach(b => b.classList.remove('active'));
  btn && btn.classList.add('active');
}
function closePreview() { $('pv-frame').src = 'about:blank'; closeModal('modal-preview'); }
const eventPageUrl = e => (e.page_url && /^\/[a-z0-9\-\/?=&]*$/i.test(e.page_url)) ? e.page_url : `/event?id=${encodeURIComponent(e.id)}`;
function previewEvent(id) { const e = (events_db || []).find(x => x.id === id); if (e) openPreview(eventPageUrl(e), e.title); }

// ═════════════════════════════════════════════════════════════════════════
// 2. VISUAL PAGE EDITOR
// ═════════════════════════════════════════════════════════════════════════
const PUBLIC_PAGES = [
  ['index', 'Home'], ['about', 'About'], ['services', 'Services'], ['service-gtm', 'GTM & Market Entry'],
  ['service-readiness', 'Investor Readiness'], ['service-introductions', 'Investor Introductions'],
  ['service-portfolio', 'Portfolio Advisory'], ['programs', 'Programs'], ['events', 'Events'],
  ['capital-growth-exchange', 'Capital & Growth Exchange'], ['fundraise', 'Raise Capital'],
  ['membership', 'Membership'], ['insights', 'Insights'], ['contact', 'Contact'],
  ['program-register', 'Program Registration'], ['privacy', 'Privacy'], ['terms', 'Terms'], ['disclosures', 'Disclosures'],
];
const pe = { slug: 'index', sections: {}, dirty: 0, pending: {}, pickKey: null };

function loadPages() {
  $('pe-list').innerHTML = PUBLIC_PAGES.map(([s, l]) =>
    `<button class="nav-item${s === pe.slug ? ' active' : ''}" style="width:100%" data-slug="${s}" onclick="selectPage('${s}')">${esc(l)}<span style="margin-left:auto;font-size:10px;color:var(--white-muted)">/${s === 'index' ? '' : s}</span></button>`).join('');
  selectPage(pe.slug, true);
}
async function selectPage(slug, force) {
  if (!force && pe.dirty && !confirm('You have unsaved edits on this page. Discard them?')) return;
  pe.slug = slug; pe.dirty = 0;
  document.querySelectorAll('#pe-list .nav-item').forEach(b => b.classList.toggle('active', b.dataset.slug === slug));
  const label = (PUBLIC_PAGES.find(p => p[0] === slug) || [slug, slug])[1];
  $('pe-name').textContent = label;
  $('pe-live').href = slug === 'index' ? '/' : `/${slug}`;
  peStatus('Loading…');
  const d = await api(`/api/admin/pages?page=${encodeURIComponent(slug)}`).catch(() => ({}));
  pe.sections = (d && d.sections) || {};
  const meta = pe.sections.cms_meta_draft || pe.sections.cms_meta || {};
  $('pe-seo-title').value = meta.title || '';
  $('pe-seo-desc').value = meta.description || '';
  $('pe-frame').src = `/${slug}.html?cms_edit=1&t=${Date.now()}`;
}
function peStatus(text) {
  const s = pe.sections, pub = s.cms_published_at ? `Published ${fmtD(s.cms_published_at)}` : 'Not yet edited';
  const draftAhead = s.cms_draft && JSON.stringify(s.cms_draft) !== JSON.stringify(s.cms_published || {});
  $('pe-status').innerHTML = text || (pe.dirty
    ? `<span class="pill pill-pending">${pe.dirty} unsaved edit${pe.dirty > 1 ? 's' : ''}</span>`
    : draftAhead ? `<span class="pill pill-pending">Draft not published</span> <span style="color:var(--white-muted)">${pub}</span>`
    : `<span class="pill pill-live">Up to date</span> <span style="color:var(--white-muted)">${pub}</span>`);
}
function peFrame() { return $('pe-frame').contentWindow; }
function peSend(msg) { try { peFrame().postMessage(Object.assign({ source: 'bana-admin' }, msg), location.origin); } catch (e) {} }
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.source !== 'bana-cms') return;
  const d = e.data;
  if (d.type === 'cms:ready') {
    // Only the editor frame drives the editor state
    if (e.source !== peFrame()) return;
    $('pe-seo-title').placeholder = d.title || '';
    $('pe-seo-desc').placeholder = d.description || '';
    peSend({ type: 'cms:load', overrides: pe.sections.cms_draft || pe.sections.cms_published || {}, meta: pe.sections.cms_meta_draft || pe.sections.cms_meta || null });
    pe.dirty = 0; peStatus();
  }
  if (d.type === 'cms:dirty') {
    const saved = Object.keys(pe.sections.cms_draft || pe.sections.cms_published || {}).length;
    pe.dirty = Math.max(0, d.count - saved) || (d.count !== saved ? 1 : 0);
    peStatus();
  }
  if (d.type === 'cms:changes' && pe.pending[d.requestId]) { pe.pending[d.requestId](d); delete pe.pending[d.requestId]; }
  if (d.type === 'cms:pick-image') openImagePicker(d.current, url => peSend({ type: 'cms:set-image', key: d.key, url }));
});
function peCollect() {
  return new Promise(res => {
    const id = Date.now() + Math.random();
    pe.pending[id] = res;
    peSend({ type: 'cms:collect', requestId: id });
    setTimeout(() => { if (pe.pending[id]) { delete pe.pending[id]; res(null); } }, 4000);
  });
}
async function savePageCms(mode) {
  const c = await peCollect();
  if (!c) { toast('Editor not ready — wait for the page to load', 'warn'); return; }
  const meta = { title: $('pe-seo-title').value.trim(), description: $('pe-seo-desc').value.trim() };
  if (!meta.title) delete meta.title; if (!meta.description) delete meta.description;
  const r = await api('/api/admin/pages', 'PATCH', { page: pe.slug, mode, overrides: c.overrides, meta });
  if (!r || r.error) { toast('Save failed: ' + ((r && r.error) || 'unknown'), 'warn'); return; }
  pe.sections = (r.page && r.page.sections) || pe.sections; pe.dirty = 0; peStatus();
  toast(mode === 'publish' ? 'Published to the live website' : 'Draft saved', 'success');
  logActivity(mode === 'publish' ? 'admin.page_publish' : 'admin.page_draft', 'admin', `${mode}: ${pe.slug} (${Object.keys(c.overrides).length} edits)`);
}
function savePageDraft() { return savePageCms('draft'); }
function publishPage() { return savePageCms('publish'); }
async function revertPage() {
  if (!confirm('Discard the draft and reload the currently published version?')) return;
  const r = await api('/api/admin/pages', 'PATCH', { page: pe.slug, mode: 'revert' });
  if (r && r.page) pe.sections = r.page.sections;
  pe.dirty = 0; selectPage(pe.slug, true);
}
async function resetPage() {
  if (!confirm('Remove ALL edits on this page (draft and published) and restore the original HTML content?')) return;
  await api('/api/admin/pages', 'PATCH', { page: pe.slug, mode: 'reset' });
  pe.dirty = 0; toast('Page restored to original', 'warn'); selectPage(pe.slug, true);
}
function peDevice(w, btn) {
  $('pe-frame').style.width = w;
  document.querySelectorAll('#panel-pages .pv-dev').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── Image picker (URL, upload to Supabase Storage, or media library) ────
let _imgCb = null;
async function openImagePicker(current, cb) {
  _imgCb = cb;
  $('ip-url').value = current || '';
  $('ip-preview').src = current || '';
  $('ip-file').value = '';
  $('modal-imgpick').style.display = 'flex';
  const grid = $('ip-grid');
  grid.innerHTML = '<div style="color:var(--white-muted);font-size:12px">Loading library…</div>';
  const d = await api('/api/admin/content/media').catch(() => ({}));
  const imgs = ((d && d.media) || []).filter(m => /image|png|jpe?g|webp|gif|svg/i.test((m.file_type || '') + (m.file_url || '')));
  grid.innerHTML = imgs.length ? imgs.slice(0, 60).map(m =>
    `<img src="${esc(m.file_url)}" title="${esc(m.file_name || '')}" onclick="$('ip-url').value=this.src;$('ip-preview').src=this.src" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border)"/>`).join('')
    : '<div style="color:var(--white-muted);font-size:12px">No images in the library yet — upload one above.</div>';
}
async function uploadPickerImage(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Max 10MB', 'warn'); return; }
  toast('Uploading…', 'success');
  try {
    const sb = await window.getBanaSupabaseClient();
    const path = `cms/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '_')}`;
    const { error } = await sb.storage.from('media').upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    const url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
    await api('/api/admin/content/media', 'POST', { file_url: url, file_name: file.name, file_type: file.type, storage_path: path });
    $('ip-url').value = url; $('ip-preview').src = url;
    toast('Uploaded', 'success');
  } catch (e) { toast('Upload failed: ' + (e.message || e), 'warn'); }
}
function applyPickedImage() {
  const url = $('ip-url').value.trim();
  if (!url) { toast('Choose an image', 'warn'); return; }
  closeModal('modal-imgpick');
  _imgCb && _imgCb(url); _imgCb = null;
}

// ═════════════════════════════════════════════════════════════════════════
// 3. EVENTS (adds live refresh, "View page" embed, page URL / slug / video)
// ═════════════════════════════════════════════════════════════════════════
async function loadEvents() {
  const el = $('events-grid');
  try { const d = await api('/api/admin/content/events'); if (d && Array.isArray(d.events)) events_db = d.events; } catch (e) {}
  const rows = events_db || [];
  const card = e => `
    <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden">
      <div onclick="previewEvent('${esc(e.id)}')" title="Open event page"
        style="cursor:pointer;height:120px;background:${e.cover_image ? `url('${esc(e.cover_image)}') center/cover` : 'linear-gradient(135deg,var(--emerald-deep),var(--bg-2))'};position:relative;display:flex;align-items:center;justify-content:center">
        ${e.cover_image ? '' : `<span class="material-symbols-outlined" style="font-size:40px;color:#fff;opacity:.7">event</span>`}
        <div style="position:absolute;top:10px;right:10px;display:flex;gap:6px">
          ${e.invite_only ? '<span class="pill" style="background:rgba(197,160,40,.2);color:var(--gold)">Invite Only</span>' : ''}
          ${e.featured ? '<span class="pill" style="background:#fff;color:#1b1c1a">Featured</span>' : ''}
          <span class="pill pill-${e.published ? 'live' : 'draft'}">${e.published ? 'Live' : 'Draft'}</span>
        </div>
      </div>
      <div style="padding:16px">
        <div style="font-size:14px;font-weight:700;color:var(--ink);margin-bottom:4px;cursor:pointer" onclick="previewEvent('${esc(e.id)}')">${esc(e.title)}</div>
        <div style="font-size:12px;color:var(--white-muted);margin-bottom:4px">${esc(e.type || '')} · ${esc(e.location || 'TBD')}</div>
        <div style="font-size:12px;color:var(--emerald)">${e.event_date ? fmtD(e.event_date) : 'Date TBD'}${e.price_amount > 0 ? ` · ${esc(e.currency || 'SGD')} ${Number(e.price_amount).toLocaleString()}` : ' · Free'}</div>
        <div style="font-size:11px;color:var(--white-muted);margin-top:4px;font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(eventPageUrl(e))}</div>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="previewEvent('${esc(e.id)}')"><span class="material-symbols-outlined" style="font-size:14px">visibility</span>View page</button>
          <button class="btn btn-ghost btn-sm" onclick="editEvent('${e.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleEvent('${e.id}',${!e.published})">${e.published ? 'Unpublish' : 'Publish'}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteEvent('${e.id}')">Delete</button>
        </div>
      </div>
    </div>`;
  el.innerHTML = rows.length ? rows.map(card).join('') + `
    <div style="border:2px dashed var(--border);border-radius:var(--r-lg);display:flex;align-items:center;justify-content:center;min-height:200px;cursor:pointer" onclick="openEventModal()">
      <div style="text-align:center;color:var(--white-muted)"><div style="font-size:32px;margin-bottom:8px">+</div><div style="font-size:13px">New Event</div></div>
    </div>` : emptyRow(`No events yet. <span style="color:var(--emerald);cursor:pointer" onclick="openEventModal()">Create your first</span>`);
}
function previewEventFromModal() {
  const id = $('ev-id').value, url = $('ev-page-url').value.trim() || (id ? `/event?id=${id}` : '');
  if (!url) { toast('Save the event first', 'warn'); return; }
  openPreview(url, $('ev-title').value || 'Event');
}

// Programs: "View page" (programs page, anchored)
function previewProgram(id) {
  const p = (programs_db || []).find(x => x.id === id) || {};
  openPreview(`/programs#program-${id}`, p.title || 'Program');
}

// ═════════════════════════════════════════════════════════════════════════
// 4. MEMBERSHIPS
// ═════════════════════════════════════════════════════════════════════════
let mem = { rows: [] };
async function loadMemberships() {
  const el = $('mem-table');
  el.innerHTML = emptyRow('Loading members…');
  const d = await api('/api/admin/memberships').catch(() => ({}));
  const users = d.users || [], subs = d.subscriptions || [], apps = d.applications || [], pays = d.payments || [];
  const subBy = {}; subs.forEach(s => { if (s.user_id && !subBy[s.user_id]) subBy[s.user_id] = s; });
  const appBy = {}; apps.forEach(a => { if (a.user_id && !appBy[a.user_id]) appBy[a.user_id] = a; });
  const payBy = {}; pays.forEach(p => { const k = p.user_id || (p.email || '').toLowerCase(); if (k && !payBy[k]) payBy[k] = p; });
  const rows = users.map(u => {
    const s = subBy[u.id], p = payBy[u.id] || payBy[(u.email || '').toLowerCase()];
    return { kind: 'user', id: u.id, name: u.full_name, email: u.email, company: u.company_name, role: u.role, account: u.status || 'pending',
      plan: s ? s.plan : null, sub_id: s && s.id, sub_status: s ? s.status : 'none', joined: u.created_at,
      app: appBy[u.id], last_pay: p };
  });
  const known = new Set(users.map(u => u.id).concat(users.map(u => (u.email || '').toLowerCase())));
  pays.filter(p => !known.has(p.user_id) && !known.has((p.email || '').toLowerCase())).forEach(p => rows.push({
    kind: 'guest', id: p.id, name: 'Guest checkout', email: p.email, company: '', role: '—', account: '—', plan: null,
    sub_status: p.status === 'completed' ? 'active' : p.status, joined: p.created_at, last_pay: p,
  }));
  mem.rows = rows;
  const completed = pays.filter(p => p.status === 'completed');
  const rev = {}; completed.forEach(p => { rev[p.currency || 'USD'] = (rev[p.currency || 'USD'] || 0) + Number(p.amount || 0); });
  const since = Date.now() - 30 * 864e5;
  $('mem-kpis').innerHTML = [
    ['Total signups', rows.filter(r => r.kind === 'user').length, 'group'],
    ['New (30 days)', rows.filter(r => new Date(r.joined).getTime() > since).length, 'person_add'],
    ['Active members', rows.filter(r => r.sub_status === 'active').length, 'verified'],
    ['Pending payment', rows.filter(r => r.sub_status === 'pending').length, 'hourglass_top'],
    ['Accounts to approve', rows.filter(r => r.kind === 'user' && r.account === 'pending').length, 'how_to_reg'],
    ['Membership revenue', Object.keys(rev).map(c => money(rev[c], c)).join(' · ') || '—', 'payments'],
  ].map(([l, v, i]) => `<div class="card" style="padding:16px"><div style="display:flex;align-items:center;gap:8px;color:var(--white-muted);font-size:12px"><span class="material-symbols-outlined" style="font-size:16px">${i}</span>${l}</div><div style="font-size:22px;font-weight:700;color:var(--ink);margin-top:6px">${esc(v)}</div></div>`).join('');
  renderMemberships();
}
function renderMemberships() {
  const q = ($('mem-search').value || '').toLowerCase(), st = $('mem-status').value, ac = $('mem-account').value;
  const rows = mem.rows.filter(r =>
    (!q || [r.name, r.email, r.company, r.plan].join(' ').toLowerCase().includes(q)) &&
    (!st || r.sub_status === st) && (!ac || r.account === ac));
  $('mem-count').textContent = `${rows.length} of ${mem.rows.length}`;
  const subSel = r => r.sub_id ? `<select class="f-input f-select" style="padding:4px 8px;font-size:12px;width:120px" onchange="setSubStatus('${r.sub_id}',this.value)">
      ${['active', 'pending', 'cancelled'].map(s => `<option ${s === r.sub_status ? 'selected' : ''}>${s}</option>`).join('')}</select>`
    : `<span class="pill pill-${r.sub_status === 'active' ? 'live' : r.sub_status === 'pending' ? 'pending' : 'draft'}">${esc(r.sub_status)}</span>`;
  $('mem-table').innerHTML = rows.length ? `<table class="data-table"><thead><tr>
      <th>Member</th><th>Company</th><th>Role</th><th>Account</th><th>Plan</th><th>Subscription</th><th>Last payment</th><th>Joined</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td><div style="font-weight:600;color:var(--ink)">${esc(r.name || '—')}</div><div style="font-size:11px;font-family:var(--font-mono);color:var(--white-muted)">${esc(r.email || '')}</div></td>
      <td style="font-size:12px">${esc(r.company || '—')}</td>
      <td style="font-size:12px;text-transform:capitalize">${esc(r.role || '—')}</td>
      <td><span class="pill pill-${r.account === 'approved' ? 'live' : r.account === 'pending' ? 'pending' : r.account === 'rejected' ? 'rejected' : 'draft'}">${esc(r.account)}</span></td>
      <td style="font-size:12px">${esc(r.plan || '—')}</td>
      <td>${subSel(r)}</td>
      <td style="font-size:12px">${r.last_pay ? `${money(r.last_pay.amount, r.last_pay.currency)} <span class="pill pill-${r.last_pay.status === 'completed' ? 'live' : r.last_pay.status === 'pending' ? 'pending' : 'rejected'}">${esc(r.last_pay.status)}</span>` : '—'}</td>
      <td style="font-size:12px;color:var(--white-muted)">${fmtD(r.joined)}</td>
      <td style="white-space:nowrap">${r.kind === 'user' && r.account !== 'approved' ? `<button class="btn btn-approve btn-sm" onclick="approveMember('${r.id}')">Approve</button>` : ''}
        ${r.app ? `<button class="btn btn-ghost btn-sm" onclick="nav('applications')">Application</button>` : ''}</td>
    </tr>`).join('')}</tbody></table>` : emptyRow('No members match these filters.');
}
async function approveMember(id) {
  const r = await api(`/api/admin/users/${id}`, 'PATCH', { status: 'approved' });
  if (r && r.error) { toast(r.error, 'warn'); return; }
  toast('Member approved', 'success'); logActivity('admin.member_approve', 'admin', id); loadMemberships();
}
async function setSubStatus(id, status) {
  const r = await api(`/api/admin/subscriptions/${id}`, 'PATCH', { status });
  if (r && r.error) { toast(r.error, 'warn'); return; }
  toast(`Subscription set to ${status}`, 'success'); logActivity('admin.subscription_update', 'admin', `${id} → ${status}`); loadMemberships();
}
function exportMemberships() {
  downloadFile(`banahub-members-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(mem.rows, [
    ['name', 'Name'], ['email', 'Email'], ['company', 'Company'], ['role', 'Role'], ['account', 'Account status'],
    ['plan', 'Plan'], ['sub_status', 'Subscription'], [r => r.last_pay ? r.last_pay.amount : '', 'Last payment'],
    [r => r.last_pay ? r.last_pay.status : '', 'Payment status'], [r => fmtD(r.joined), 'Joined']]));
}

// ═════════════════════════════════════════════════════════════════════════
// 5. INVESTOR DIRECTORY + IMPORT
// ═════════════════════════════════════════════════════════════════════════
let inv = { all: [], page: 0, per: 100 };
const INVESTOR_TYPES = ['VC', 'Angel', 'Family Office', 'Private Equity', 'Corporate VC', 'Hedge Fund', 'LP / Fund of Funds', 'Accelerator', 'Bank / Debt', 'Sovereign / Government', 'Other'];
const STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth', 'Pre-IPO', 'Buyout', 'Debt'];
async function loadInvestors() {
  $('investors-table').innerHTML = emptyRow('Loading investors…');
  const d = await api('/api/admin/investors').catch(() => ({}));
  if (d && d.error) { $('investors-table').innerHTML = emptyRow('Could not load investors: ' + esc(d.error) + '<br/>Run SQL migration 08 if columns are missing.'); return; }
  inv.all = (d && d.investors) || []; inv.page = 0;
  const types = [...new Set(inv.all.map(i => i.investor_type).filter(Boolean).concat(INVESTOR_TYPES))];
  $('inv-type').innerHTML = '<option value="">All types</option>' + types.map(t => `<option>${esc(t)}</option>`).join('');
  renderInvestors();
}
function invFiltered() {
  const q = ($('inv-search').value || '').toLowerCase(), t = $('inv-type').value, sec = ($('inv-sector').value || '').toLowerCase(),
        stg = $('inv-stage').value.toLowerCase(), geo = ($('inv-geo').value || '').toLowerCase(), st = $('inv-status').value;
  return inv.all.filter(i =>
    (!q || [i.full_name, i.organization, i.email, i.phone, i.notes, i.investor_type, i.geography, i.website].join(' ').toLowerCase().includes(q)) &&
    (!t || i.investor_type === t) &&
    (!sec || arr(i.focus_sectors).some(s => s.toLowerCase().includes(sec))) &&
    (!stg || arr(i.preferred_stages).some(s => s.toLowerCase().includes(stg))) &&
    (!geo || (i.geography || '').toLowerCase().includes(geo)) &&
    (!st || i.status === st));
}
function openInvestorModal(id) {
  const i = id ? inv.all.find(x => x.id === id) || {} : {};
  $('im-id').value = id || '';
  $('im-title').textContent = id ? 'Edit Investor' : 'Add Investor';
  $('im-type').innerHTML = INVESTOR_TYPES.map(t => `<option>${t}</option>`).join('');
  [['im-name', 'full_name'], ['im-org', 'organization'], ['im-email', 'email'], ['im-phone', 'phone'], ['im-geo', 'geography'],
   ['im-check', 'check_size'], ['im-min', 'check_min'], ['im-max', 'check_max'], ['im-web', 'website'], ['im-li', 'linkedin_url'], ['im-notes', 'notes']]
    .forEach(([el, k]) => $(el).value = i[k] == null ? '' : i[k]);
  $('im-type').value = i.investor_type || 'VC';
  $('im-sectors').value = arr(i.focus_sectors).join(', ');
  $('im-stages').value = arr(i.preferred_stages).join(', ');
  $('im-status').value = i.status || 'directory';
  $('modal-investor').style.display = 'flex';
}
async function saveInvestor() {
  const id = $('im-id').value;
  const p = {
    full_name: $('im-name').value.trim(), organization: $('im-org').value.trim(), email: $('im-email').value.trim() || null,
    phone: $('im-phone').value.trim() || null, investor_type: $('im-type').value, focus_sectors: arr($('im-sectors').value),
    preferred_stages: arr($('im-stages').value), geography: $('im-geo').value.trim() || null, check_size: $('im-check').value.trim() || null,
    check_min: parseMoney($('im-min').value), check_max: parseMoney($('im-max').value), website: $('im-web').value.trim() || null,
    linkedin_url: $('im-li').value.trim() || null, notes: $('im-notes').value.trim() || null, status: $('im-status').value,
  };
  if (!p.full_name && !p.organization) { toast('Name or organisation required', 'warn'); return; }
  if ((p.check_min == null || p.check_max == null) && p.check_size) { const [a, b] = parseRange(p.check_size); if (p.check_min == null) p.check_min = a; if (p.check_max == null) p.check_max = b; }
  const r = id ? await api(`/api/admin/investors/${id}`, 'PATCH', p) : await api('/api/admin/investors', 'POST', p);
  if (!r || r.error) { toast('Save failed: ' + ((r && r.error) || ''), 'warn'); return; }
  toast(id ? 'Investor updated' : 'Investor added', 'success'); closeModal('modal-investor'); loadInvestors();
}
async function deleteInvestor(id) {
  if (!confirm('Delete this investor from the directory?')) return;
  const r = await api(`/api/admin/investors/${id}`, 'DELETE');
  if (r && r.error) { toast(r.error, 'warn'); return; }
  toast('Deleted', 'warn'); loadInvestors();
}
function exportInvestors() {
  downloadFile(`banahub-investors-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(invFiltered(), [
    ['full_name', 'name'], ['organization', 'organization'], ['email', 'email'], ['phone', 'phone'], ['investor_type', 'investor_type'],
    ['focus_sectors', 'sectors'], ['preferred_stages', 'stages'], ['geography', 'geography'], ['check_size', 'check_size'],
    ['check_min', 'check_min'], ['check_max', 'check_max'], ['website', 'website'], ['linkedin_url', 'linkedin'], ['notes', 'notes'], ['status', 'status']]));
}

// ── Import (CSV / XLSX / XLS) ──────────────────────────────────────────
const IMPORT_FIELDS = {
  investor: {
    full_name: ['name', 'full name', 'fullname', 'contact', 'contact name', 'investor name', 'first name', 'partner'],
    organization: ['organization', 'organisation', 'firm', 'fund', 'company', 'fund name', 'firm name', 'investor'],
    email: ['email', 'e-mail', 'email address', 'mail'],
    phone: ['phone', 'mobile', 'tel', 'telephone', 'phone number'],
    investor_type: ['type', 'investor type', 'category', 'investor category'],
    focus_sectors: ['sectors', 'sector', 'focus', 'focus sectors', 'industries', 'industry', 'verticals', 'thesis'],
    preferred_stages: ['stages', 'stage', 'preferred stage', 'preferred stages', 'investment stage', 'round'],
    geography: ['geography', 'region', 'regions', 'location', 'country', 'countries', 'hq', 'markets'],
    check_size: ['check size', 'ticket', 'ticket size', 'cheque size', 'investment size', 'check'],
    check_min: ['check min', 'min check', 'min ticket', 'minimum', 'min investment'],
    check_max: ['check max', 'max check', 'max ticket', 'maximum', 'max investment'],
    website: ['website', 'url', 'web', 'site'],
    linkedin_url: ['linkedin', 'linkedin url', 'linkedin profile'],
    notes: ['notes', 'note', 'comments', 'description', 'remarks'],
  },
  company: {
    company_name: ['company', 'company name', 'name', 'business', 'startup', 'organisation', 'organization'],
    contact_name: ['contact', 'contact name', 'founder', 'ceo', 'full name'],
    email: ['email', 'e-mail', 'email address'],
    website: ['website', 'url', 'web'],
    industry: ['industry', 'sector', 'sectors', 'industries', 'vertical'],
    stage: ['stage', 'round', 'funding stage'],
    description: ['description', 'about', 'summary', 'notes'],
    linkedin_url: ['linkedin', 'linkedin url'],
  },
};
const ARRAY_FIELDS = ['focus_sectors', 'preferred_stages', 'industry'];
let imp = { type: 'investor', rows: [], map: {}, headers: [] };
function openImportModal(type) {
  imp = { type: type || 'investor', rows: [], map: {}, headers: [] };
  $('imp-type').value = imp.type; $('imp-file').value = '';
  $('imp-preview').innerHTML = `<div style="color:var(--white-muted);font-size:13px;line-height:1.6">Drop in any .csv, .xlsx or .xls list — it is arranged automatically:<br>• header row found even below titles; columns detected by name <em>or</em> content (Fund/Firm, Email Address, HQ, Ticket…)<br>• first + last names joined, types/sectors/stages/regions standardised, tickets formatted, emails & websites cleaned<br>• duplicates merged, extra columns kept in notes, list grouped by investor type.</div>`;
  $('imp-go').disabled = true; $('imp-result').textContent = '';
  $('modal-import').style.display = 'flex';
}
function downloadTemplate() {
  const t = $('imp-type').value;
  const csv = t === 'company'
    ? 'company_name,contact_name,email,website,industry,stage,description,linkedin\nAcme Pte Ltd,Jane Tan,jane@acme.sg,https://acme.sg,"Fintech; Payments",Seed,Cross-border payments for SMEs,https://linkedin.com/company/acme\n'
    : 'name,organization,email,phone,type,sectors,stages,geography,check_size,website,linkedin,notes\nAlex Lim,Lion Ventures,alex@lionvc.com,+65 6000 0000,VC,"Fintech; SaaS; AI","Seed; Series A","Singapore, SEA",$250k-$2M,https://lionvc.com,https://linkedin.com/in/alexlim,Met at SFF 2026\n';
  downloadFile(`banahub-${t}-import-template.csv`, csv);
}

// ═════════════════════════════════════════════════════════════════════════
// 6. BUSINESSES (companies table)
// ═════════════════════════════════════════════════════════════════════════
let cos = [];
async function loadBusinesses() {
  $('businesses-table').innerHTML = emptyRow('Loading…');
  const d = await api('/api/admin/companies').catch(() => ({}));
  cos = (d && d.companies) || [];
  renderBusinesses();
}
function renderBusinesses() {
  const q = ($('biz-search').value || '').toLowerCase();
  const rows = cos.filter(c => !q || [c.company_name, c.contact_name, c.email, c.stage, arr(c.industry).join(' ')].join(' ').toLowerCase().includes(q));
  $('businesses-table').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Company</th><th>Contact</th><th>Industry</th><th>Stage</th><th>Status</th><th>Added</th><th></th></tr></thead><tbody>
    ${rows.map(c => `<tr>
      <td><div style="font-weight:600;color:var(--ink)">${esc(c.company_name || '—')}</div>${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--emerald)">${esc(c.website)}</a>` : ''}</td>
      <td style="font-size:12px">${esc(c.contact_name || '')}<div style="font-family:var(--font-mono);font-size:11px;color:var(--white-muted)">${esc(c.email || '')}</div></td>
      <td>${chips(c.industry)}</td><td style="font-size:12px">${esc(c.stage || '—')}</td>
      <td><span class="pill pill-${c.status === 'approved' ? 'live' : c.status === 'pending' ? 'pending' : 'draft'}">${esc(c.status || '')}</span></td>
      <td style="font-size:12px;color:var(--white-muted)">${fmtD(c.created_at)}</td>
      <td style="white-space:nowrap"><button class="btn btn-primary btn-sm" onclick="openRaiseModal(null,'${c.id}')">Create raise</button>
        <button class="btn btn-ghost btn-sm" onclick="openBusinessModal('${c.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteBusiness('${c.id}')">✕</button></td></tr>`).join('')}</tbody></table>`
    : emptyRow(`No companies yet. <span style="color:var(--emerald);cursor:pointer" onclick="openBusinessModal()">Add one</span> or <span style="color:var(--emerald);cursor:pointer" onclick="openImportModal('company')">import a sheet</span>.`);
}
function openBusinessModal(id) {
  const c = id ? cos.find(x => x.id === id) || {} : {};
  $('bm-id').value = id || '';
  $('bm-title').textContent = id ? 'Edit Company' : 'Add Company';
  [['bm-name', 'company_name'], ['bm-contact', 'contact_name'], ['bm-email', 'email'], ['bm-web', 'website'], ['bm-stage', 'stage'], ['bm-desc', 'description'], ['bm-li', 'linkedin_url']]
    .forEach(([el, k]) => $(el).value = c[k] || '');
  $('bm-industry').value = arr(c.industry).join(', ');
  $('bm-status').value = c.status || 'approved';
  $('modal-business').style.display = 'flex';
}
async function saveBusiness() {
  const id = $('bm-id').value;
  const p = { company_name: $('bm-name').value.trim(), contact_name: $('bm-contact').value.trim() || null, email: $('bm-email').value.trim() || null,
    website: $('bm-web').value.trim() || null, industry: arr($('bm-industry').value), stage: $('bm-stage').value.trim() || null,
    description: $('bm-desc').value.trim() || null, linkedin_url: $('bm-li').value.trim() || null, status: $('bm-status').value };
  if (!p.company_name) { toast('Company name required', 'warn'); return; }
  const r = id ? await api(`/api/admin/companies/${id}`, 'PATCH', p) : await api('/api/admin/companies', 'POST', p);
  if (!r || r.error) { toast('Save failed: ' + ((r && r.error) || ''), 'warn'); return; }
  toast('Saved', 'success'); closeModal('modal-business'); loadBusinesses();
}
async function deleteBusiness(id) {
  if (!confirm('Delete this company? Linked capital raises are deleted too.')) return;
  const r = await api(`/api/admin/companies/${id}`, 'DELETE');
  if (r && r.error) { toast(r.error, 'warn'); return; }
  loadBusinesses();
}

// ═════════════════════════════════════════════════════════════════════════
// 7. CAPITAL RAISES + INVESTOR MATCHING
// ═════════════════════════════════════════════════════════════════════════
let cap = { raises: [] };
async function loadCapital() {
  $('cap-table').innerHTML = emptyRow('Loading…');
  const [d, c] = await Promise.all([api('/api/admin/capital').catch(() => ({})), cos.length ? null : api('/api/admin/companies').catch(() => ({}))]);
  if (c) cos = c.companies || [];
  if (d && d.error) { $('cap-table').innerHTML = emptyRow('Could not load raises: ' + esc(d.error) + '<br/>Run SQL migration 08.'); return; }
  cap.raises = (d && d.raises) || [];
  const open = cap.raises.filter(r => r.status === 'open');
  const tgt = {}; open.forEach(r => { tgt[r.currency || 'USD'] = (tgt[r.currency || 'USD'] || 0) + Number(r.target_raise || 0); });
  $('cap-kpis').innerHTML = [
    ['Open raises', open.length], ['Live on member dashboard', open.filter(r => r.published).length],
    ['Total target (open)', Object.keys(tgt).map(k => money(tgt[k], k)).join(' · ') || '—'], ['Drafts', cap.raises.filter(r => r.status === 'draft').length],
  ].map(([l, v]) => `<div class="card" style="padding:16px"><div style="color:var(--white-muted);font-size:12px">${l}</div><div style="font-size:22px;font-weight:700;color:var(--ink);margin-top:6px">${esc(v)}</div></div>`).join('');
  renderCapital();
  $('match-raise').innerHTML = '<option value="">Select a raise…</option>' + cap.raises.map(r => `<option value="${r.id}">${esc(raiseName(r))}</option>`).join('');
}
const raiseName = r => r.name || r.company_name || (r.companies && r.companies.company_name) || 'Untitled raise';
function renderCapital() {
  const rows = cap.raises;
  $('cap-table').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Raise</th><th>Sectors</th><th>Stage</th><th>Target</th><th>Progress</th><th>Status</th><th>Dashboard</th><th></th></tr></thead><tbody>
    ${rows.map(r => { const pct = r.target_raise && r.raised_amount ? Math.min(100, Math.round(r.raised_amount / r.target_raise * 100)) : 0; return `<tr>
      <td><div style="font-weight:600;color:var(--ink)">${esc(raiseName(r))}</div><div style="font-size:12px;color:var(--white-muted)">${esc(r.company_name || (r.companies && r.companies.company_name) || '')}${r.close_date ? ' · closes ' + fmtD(r.close_date) : ''}</div></td>
      <td>${chips(arr(r.sectors).length ? r.sectors : r.industry)}</td>
      <td style="font-size:12px">${esc(r.stage || '—')}<div style="color:var(--white-muted)">${esc(r.investment_type || '')}</div></td>
      <td style="font-size:12px;white-space:nowrap">${money(r.target_raise, r.currency)}</td>
      <td style="min-width:90px"><div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--emerald)"></div></div><div style="font-size:11px;color:var(--white-muted);margin-top:3px">${pct}%</div></td>
      <td><span class="pill pill-${r.status === 'open' ? 'live' : r.status === 'closed' ? 'rejected' : 'draft'}">${esc(r.status || 'draft')}</span></td>
      <td><label class="toggle"><input type="checkbox" ${r.published ? 'checked' : ''} onchange="toggleRaisePublish('${r.id}',this.checked)"/><span class="toggle-slider"></span></label></td>
      <td style="white-space:nowrap"><button class="btn btn-primary btn-sm" onclick="matchForRaise('${r.id}')"><span class="material-symbols-outlined" style="font-size:14px">person_search</span>Find investors</button>
        <button class="btn btn-ghost btn-sm" onclick="openRaiseModal('${r.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRaise('${r.id}')">✕</button></td></tr>`; }).join('')}</tbody></table>`
    : emptyRow(`No capital raises yet. <span style="color:var(--emerald);cursor:pointer" onclick="openRaiseModal()">Create the first raise</span>.`);
}
function capTab(tab, btn) {
  ['raises', 'match'].forEach(t => $(`cap-tab-${t}`).style.display = t === tab ? '' : 'none');
  document.querySelectorAll('#panel-capital .s-tab').forEach(b => b.classList.remove('active'));
  btn && btn.classList.add('active');
  if (tab === 'match' && !inv.all.length) loadInvestorsSilently();
}
async function loadInvestorsSilently() { const d = await api('/api/admin/investors').catch(() => ({})); inv.all = (d && d.investors) || []; }
function openRaiseModal(id, companyId) {
  const r = id ? cap.raises.find(x => x.id === id) || {} : {};
  const co = companyId ? cos.find(c => c.id === companyId) || {} : {};
  if (companyId && $('panel-capital') && !$('panel-capital').classList.contains('active')) nav('capital');
  $('rm-id').value = id || '';
  $('rm-title').textContent = id ? 'Edit Capital Raise' : 'New Capital Raise';
  $('rm-company-id').innerHTML = '<option value="">— none / external —</option>' + cos.map(c => `<option value="${c.id}">${esc(c.company_name || c.email)}</option>`).join('');
  $('rm-company-id').value = r.company_id || companyId || '';
  $('rm-name').value = r.name || (co.company_name ? `${co.company_name} — ${co.stage || 'Fundraise'}` : '');
  $('rm-company').value = r.company_name || co.company_name || '';
  $('rm-sectors').value = arr(r.sectors).length ? arr(r.sectors).join(', ') : arr(r.industry || co.industry).join(', ');
  $('rm-stage').value = r.stage || co.stage || 'Seed';
  $('rm-type').value = r.investment_type || 'Equity';
  $('rm-geo').value = r.geography || '';
  $('rm-currency').value = r.currency || 'USD';
  $('rm-target').value = r.target_raise || '';
  $('rm-raised').value = r.raised_amount || '';
  $('rm-min').value = r.min_ticket || '';
  $('rm-close').value = r.close_date ? String(r.close_date).slice(0, 10) : '';
  $('rm-desc').value = r.description || co.description || '';
  $('rm-deck').value = r.deck_url || '';
  $('rm-notes').value = r.notes || '';
  $('rm-status').value = r.status || 'draft';
  $('rm-pub').checked = !!r.published;
  $('modal-raise').style.display = 'flex';
}
function raiseCompanyPicked(sel) {
  const c = cos.find(x => x.id === sel.value); if (!c) return;
  if (!$('rm-company').value) $('rm-company').value = c.company_name || '';
  if (!$('rm-sectors').value) $('rm-sectors').value = arr(c.industry).join(', ');
  if (!$('rm-desc').value) $('rm-desc').value = c.description || '';
}
async function saveRaise() {
  const id = $('rm-id').value, sectors = arr($('rm-sectors').value);
  const p = {
    name: $('rm-name').value.trim(), company_id: $('rm-company-id').value || null, company_name: $('rm-company').value.trim() || null,
    sectors, industry: sectors.join(', ') || null, stage: $('rm-stage').value, investment_type: $('rm-type').value,
    geography: $('rm-geo').value.trim() || null, currency: $('rm-currency').value, target_raise: parseMoney($('rm-target').value),
    raised_amount: parseMoney($('rm-raised').value), min_ticket: parseMoney($('rm-min').value), close_date: $('rm-close').value || null,
    description: $('rm-desc').value.trim() || null, deck_url: $('rm-deck').value.trim() || null, notes: $('rm-notes').value.trim() || null,
    status: $('rm-status').value, published: $('rm-pub').checked,
  };
  if (!p.name && !p.company_name) { toast('Raise name or company required', 'warn'); return; }
  if (p.published && p.status !== 'open') { if (!confirm('Only "open" raises appear on the member dashboard. Set status to open?')) p.published = false; else p.status = 'open'; }
  const r = id ? await api(`/api/admin/capital/${id}`, 'PATCH', p) : await api('/api/admin/capital', 'POST', p);
  if (!r || r.error) { toast('Save failed: ' + ((r && r.error) || ''), 'warn'); return; }
  toast(id ? 'Raise updated' : 'Raise created', 'success');
  logActivity(id ? 'admin.raise_update' : 'admin.raise_create', 'admin', p.name || p.company_name);
  closeModal('modal-raise'); loadCapital();
}
async function toggleRaisePublish(id, on) {
  const r0 = cap.raises.find(x => x.id === id) || {};
  const p = on ? { published: true, status: 'open' } : { published: false };
  if (on && r0.status !== 'open' && !confirm('Publishing sets status to "open" and shows it on members\' Capital Flows. Continue?')) { renderCapital(); return; }
  const r = await api(`/api/admin/capital/${id}`, 'PATCH', p);
  if (r && r.error) { toast(r.error, 'warn'); return; }
  toast(on ? 'Live on member dashboard' : 'Hidden from dashboard', 'success'); loadCapital();
}
async function deleteRaise(id) {
  if (!confirm('Delete this raise?')) return;
  const r = await api(`/api/admin/capital/${id}`, 'DELETE');
  if (r && r.error) { toast(r.error, 'warn'); return; }
  loadCapital();
}

// ── Matching engine ─────────────────────────────────────────────────────
const normStage = s => String(s || '').toLowerCase().replace(/[^a-z0-9+]/g, '').replace('seriesc+', 'seriesc').replace('preseed', 'preseed');
function tokens(s) { return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1); }
function scoreInvestor(i, r) {
  const reasons = []; let score = 0;
  // Sector fit (40)
  const rs = arr(r.sectors).concat(arr(r.industry)).map(s => s.toLowerCase());
  const is = arr(i.focus_sectors).map(s => s.toLowerCase());
  if (!is.length) { score += 12; reasons.push('Sector-agnostic'); }
  else if (rs.length) {
    const hit = rs.filter(a => is.some(b => a.includes(b) || b.includes(a) || tokens(a).some(t => tokens(b).includes(t))));
    if (hit.length) { score += Math.min(40, 25 + hit.length * 8); reasons.push('Sector: ' + [...new Set(hit)].slice(0, 3).join(', ')); }
  }
  // Stage fit (25)
  const st = arr(i.preferred_stages).map(normStage), rst = normStage(r.stage);
  if (!st.length) { score += 8; }
  else if (rst && st.some(s => s === rst || s.includes(rst) || rst.includes(s))) { score += 25; reasons.push('Stage: ' + r.stage); }
  // Geography (20)
  const ig = tokens(i.geography), rg = tokens(r.geography);
  if (!ig.length) score += 6;
  else if (ig.includes('global') || ig.includes('worldwide')) { score += 14; reasons.push('Global mandate'); }
  else if (rg.length && rg.some(t => ig.includes(t) || (t === 'sea' && ig.some(x => ['asean', 'southeast', 'singapore', 'indonesia', 'vietnam', 'malaysia', 'thailand', 'philippines'].includes(x))))) { score += 20; reasons.push('Geography: ' + i.geography); }
  // Ticket (15)
  let [mn, mx] = [i.check_min, i.check_max];
  if (mn == null && mx == null && i.check_size) [mn, mx] = parseRange(i.check_size);
  const lo = r.min_ticket || (r.target_raise ? r.target_raise * 0.02 : null), hi = r.target_raise || null;
  if (mn == null && mx == null) score += 5;
  else if (lo != null || hi != null) {
    const a = mn == null ? 0 : mn, b = mx == null ? Infinity : mx, c = lo == null ? 0 : lo, d = hi == null ? Infinity : hi;
    if (a <= d && c <= b) { score += 15; reasons.push('Ticket fits'); }
  }
  // Type nudge
  const t = (i.investor_type || '').toLowerCase(), it = (r.investment_type || '').toLowerCase();
  if (it.includes('debt') && /debt|bank|credit|private credit/.test(t)) { score += 5; reasons.push('Debt investor'); }
  return { score: Math.min(100, Math.round(score)), reasons };
}
function matchForRaise(id) {
  capTab('match', document.querySelectorAll('#panel-capital .s-tab')[1]);
  $('match-raise').value = id;
  runMatch();
}
async function runMatch() {
  const r = cap.raises.find(x => x.id === $('match-raise').value);
  const out = $('match-results');
  if (!r) { out.innerHTML = emptyRow('Select a raise to find matching investors.'); return; }
  if (!inv.all.length) await loadInvestorsSilently();
  $('match-summary').innerHTML = `<b>${esc(raiseName(r))}</b> · ${esc(arr(r.sectors).join(', ') || r.industry || 'any sector')} · ${esc(r.stage || 'any stage')} · ${esc(r.geography || 'any geography')} · target ${money(r.target_raise, r.currency)}${r.min_ticket ? ' · min ticket ' + money(r.min_ticket, r.currency) : ''}`;
  const q = ($('match-q').value || '').toLowerCase(), t = $('match-type').value, min = Number($('match-min').value || 0);
  const shortlist = new Set(arr(r.shortlist));
  const res = inv.all
    .filter(i => (!t || i.investor_type === t) && (!q || [i.full_name, i.organization, i.notes, i.geography, arr(i.focus_sectors).join(' ')].join(' ').toLowerCase().includes(q)))
    .map(i => Object.assign({ i }, scoreInvestor(i, r)))
    .filter(x => x.score >= min)
    .sort((a, b) => b.score - a.score).slice(0, 200);
  cap.lastMatch = { raise: r, res };
  out.innerHTML = res.length ? `<table class="data-table"><thead><tr><th style="width:110px">Fit</th><th>Investor</th><th>Type</th><th>Why</th><th>Ticket</th><th>Contact</th><th></th></tr></thead><tbody>
    ${res.map(({ i, score, reasons }) => `<tr>
      <td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:${score}%;background:${score >= 70 ? 'var(--emerald)' : score >= 45 ? 'var(--gold)' : 'var(--white-muted)'}"></div></div><b style="font-size:12px">${score}</b></div></td>
      <td><div style="font-weight:600;color:var(--ink)">${esc(i.full_name || i.organization || '—')}</div><div style="font-size:12px;color:var(--white-muted)">${esc(i.full_name ? i.organization || '' : '')}</div></td>
      <td style="font-size:12px">${esc(i.investor_type || '—')}</td>
      <td style="font-size:11px;color:var(--white-dim)">${reasons.map(esc).join(' · ') || '—'}</td>
      <td style="font-size:12px;white-space:nowrap">${esc(i.check_size || '—')}</td>
      <td style="white-space:nowrap">${i.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(i.email)}?subject=${encodeURIComponent('Introduction: ' + raiseName(r))}">Email</a>` : ''}${i.linkedin_url ? ` <a class="btn btn-ghost btn-sm" href="${esc(i.linkedin_url)}" target="_blank" rel="noopener">LinkedIn</a>` : ''}${i.phone ? ` <a class="btn btn-ghost btn-sm" href="tel:${esc(String(i.phone).replace(/[^\d+]/g, ''))}" title="${esc(i.phone)}">Call</a>` : ''}${i.phone ? `<div style="font-size:11px;color:var(--white-muted);margin-top:3px">${esc(i.phone)}</div>` : ''}</td>
      <td><button class="btn ${shortlist.has(i.id) ? 'btn-approve' : 'btn-ghost'} btn-sm" onclick="toggleShortlist('${r.id}','${i.id}')">${shortlist.has(i.id) ? '★ Shortlisted' : '☆ Shortlist'}</button></td>
    </tr>`).join('')}</tbody></table>`
    : emptyRow(inv.all.length ? 'No investors meet the minimum fit score. Lower the threshold or broaden the raise criteria.' : `Your investor directory is empty. <span style="color:var(--emerald);cursor:pointer" onclick="nav('investors');openImportModal('investor')">Import investors</span> first.`);
}
async function toggleShortlist(raiseId, invId) {
  const r = cap.raises.find(x => x.id === raiseId); if (!r) return;
  const s = new Set(arr(r.shortlist)); s.has(invId) ? s.delete(invId) : s.add(invId);
  r.shortlist = [...s];
  const res = await api(`/api/admin/capital/${raiseId}`, 'PATCH', { shortlist: r.shortlist });
  if (res && res.error) { toast(res.error, 'warn'); return; }
  runMatch();
}
function exportMatches(onlyShortlist) {
  const m = cap.lastMatch; if (!m) { toast('Run a search first', 'warn'); return; }
  const sl = new Set(arr(m.raise.shortlist));
  const rows = m.res.filter(x => !onlyShortlist || sl.has(x.i.id)).map(x => Object.assign({ score: x.score, why: x.reasons.join('; ') }, x.i));
  downloadFile(`matches-${raiseName(m.raise).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, toCSV(rows, [
    ['score', 'fit_score'], ['full_name', 'name'], ['organization', 'organization'], ['email', 'email'], ['investor_type', 'type'],
    ['focus_sectors', 'sectors'], ['preferred_stages', 'stages'], ['geography', 'geography'], ['check_size', 'check_size'], ['linkedin_url', 'linkedin'], ['why', 'why']]));
}

// ═════════════════════════════════════════════════════════════════════════
// 8. ENQUIRY TRACKER  (contact + every other website form)
// ═════════════════════════════════════════════════════════════════════════
const ENQ_STATUS = { new: ['New', 'pending'], in_progress: ['In progress', 'pending'], responded: ['Responded', 'live'], closed: ['Closed', 'draft'] };
const enqStatusOf = q => q.status === 'pending' || !q.status ? 'new' : q.status === 'resolved' ? 'closed' : q.status;
const enqTypeOf = q => q.type || String(q.source || 'contact').replace(/_(enquiry|form|request|interest|campaign)$/, '');
const enqRef = q => (q.data && q.data.reference) || '';
let enquiries_db = [], enqTab = 'open';
async function loadEnquiries() {
  const el = $('enquiries-table');
  el.innerHTML = emptyRow('Loading…');
  const d = await api('/api/admin/enquiries').catch(() => ({}));
  enquiries_db = (d && d.enquiries) || [];
  const types = [...new Set(enquiries_db.map(enqTypeOf))].sort();
  $('enq-type-f').innerHTML = '<option value="">All types</option>' + types.map(t => `<option value="${esc(t)}">${esc(t.replace(/_/g, ' '))}</option>`).join('');
  const cnt = s => enquiries_db.filter(q => enqStatusOf(q) === s).length;
  const week = enquiries_db.filter(q => Date.now() - new Date(q.created_at) < 7 * 864e5).length;
  const resp = enquiries_db.filter(q => q.responded_at).map(q => (new Date(q.responded_at) - new Date(q.created_at)) / 36e5);
  const avg = resp.length ? Math.round(resp.reduce((a, b) => a + b, 0) / resp.length) : null;
  $('enq-kpis').innerHTML = [['New', cnt('new'), 'mark_email_unread'], ['In progress', cnt('in_progress'), 'pending_actions'], ['Responded', cnt('responded'), 'forward_to_inbox'],
    ['Closed', cnt('closed'), 'task_alt'], ['Last 7 days', week, 'date_range'], ['Avg. response', avg == null ? '—' : avg < 48 ? avg + ' h' : Math.round(avg / 24) + ' d', 'timer']]
    .map(([l, v, i]) => `<div class="card" style="padding:14px"><div style="display:flex;align-items:center;gap:6px;color:var(--white-muted);font-size:12px"><span class="material-symbols-outlined" style="font-size:16px">${i}</span>${l}</div><div style="font-size:22px;font-weight:700;color:var(--ink);margin-top:4px">${esc(v)}</div></div>`).join('');
  $('enq-tabs').innerHTML = [['open', `Open (${cnt('new') + cnt('in_progress')})`], ['new', `New (${cnt('new')})`], ['in_progress', 'In progress'], ['responded', 'Responded'], ['closed', 'Closed'], ['all', `All (${enquiries_db.length})`]]
    .map(([k, l]) => `<button class="s-tab${enqTab === k ? ' active' : ''}" onclick="enqTab='${k}';loadEnquiriesTabs()">${l}</button>`).join('');
  setBadge('nb-enquiries', cnt('new'));
  renderEnquiries();
}
function loadEnquiriesTabs() { document.querySelectorAll('#enq-tabs .s-tab').forEach(b => b.classList.toggle('active', b.getAttribute('onclick').includes(`'${enqTab}'`))); renderEnquiries(); }
function filterEnquiries() { renderEnquiries(); }
function enqRows() {
  const q = ($('enq-search').value || '').toLowerCase(), t = $('enq-type-f').value, pr = $('enq-priority-f').value;
  return enquiries_db.filter(e => {
    const st = enqStatusOf(e);
    if (enqTab === 'open' && !(st === 'new' || st === 'in_progress')) return false;
    if (!['open', 'all'].includes(enqTab) && st !== enqTab) return false;
    if (t && enqTypeOf(e) !== t) return false;
    if (pr && (e.priority || 'normal') !== pr) return false;
    if (q && ![e.name, e.email, e.company, e.message, e.notes, enqRef(e)].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderEnquiries() {
  const rows = enqRows();
  $('enq-count').textContent = `${rows.length} shown`;
  const typeBadge = e => { const src = (typeof SOURCE_LABELS !== 'undefined' && SOURCE_LABELS[e.source]) || { label: enqTypeOf(e), color: '#0a5c40' };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:${src.color}18;color:${src.color};border:1px solid ${src.color}40;text-transform:capitalize">${esc(src.label)}</span>`; };
  const age = d => { const h = (Date.now() - new Date(d)) / 36e5; return h < 1 ? 'just now' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
  $('enquiries-table').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>From</th><th>Type</th><th>Message</th><th>Status</th><th>Priority</th><th>Received</th><th></th></tr></thead><tbody>
    ${rows.map(e => { const st = enqStatusOf(e), S = ENQ_STATUS[st] || [st, 'draft']; return `<tr style="cursor:pointer${st === 'new' ? ';font-weight:600' : ''}" onclick="openEnquiry('${e.id}')">
      <td><div style="color:var(--ink)">${esc(e.name || '—')}</div><div style="font-size:11px;font-family:var(--font-mono);color:var(--white-muted);font-weight:400">${esc(e.email || '')}</div>${e.company ? `<div style="font-size:11px;color:var(--white-dim);font-weight:400">${esc(e.company)}</div>` : ''}</td>
      <td>${typeBadge(e)}</td>
      <td style="max-width:320px;font-size:12px;font-weight:400;color:var(--white-dim)">${esc((e.message || '').slice(0, 120))}${(e.message || '').length > 120 ? '…' : ''}</td>
      <td onclick="event.stopPropagation()"><select class="f-input f-select" style="padding:4px 8px;font-size:12px;width:130px" onchange="setEnquiryStatus('${e.id}',this.value)">${Object.keys(ENQ_STATUS).map(k => `<option value="${k}" ${k === st ? 'selected' : ''}>${ENQ_STATUS[k][0]}</option>`).join('')}</select></td>
      <td><span class="pill pill-${e.priority === 'high' ? 'rejected' : e.priority === 'low' ? 'draft' : 'pending'}">${esc(e.priority || 'normal')}</span></td>
      <td style="font-size:12px;color:var(--white-muted);font-weight:400;white-space:nowrap" title="${esc(new Date(e.created_at).toLocaleString())}">${age(e.created_at)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEnquiry('${e.id}')">Open</button></td></tr>`; }).join('')}</tbody></table>`
    : emptyRow(enquiries_db.length ? 'No enquiries in this view.' : 'No enquiries yet. Submissions from the Contact page, events, fundraise and program forms appear here automatically.');
}
function openEnquiry(id) {
  const e = enquiries_db.find(x => x.id === id); if (!e) return;
  $('eq-id').value = id;
  $('eq-title').textContent = e.name || e.email || 'Enquiry';
  $('eq-sub').textContent = [enqTypeOf(e), e.company, enqRef(e) && 'Ref ' + enqRef(e)].filter(Boolean).join(' · ');
  $('eq-message').textContent = e.message || '(no message)';
  const fields = [['Email', e.email && `<a href="mailto:${esc(e.email)}" style="color:var(--emerald)">${esc(e.email)}</a>`], ['Phone', e.phone && `<a href="tel:${esc(e.phone)}" style="color:var(--emerald)">${esc(e.phone)}</a>`],
    ['Title', esc(e.title || '')], ['Company', esc(e.company || '')], ['Service', esc(e.service || '')], ['Source', esc(e.source || '')], ['Page', esc(e.page_url || '')]]
    .concat(Object.keys(e.data || {}).filter(k => k !== 'reference').map(k => [k.replace(/_/g, ' '), esc(typeof e.data[k] === 'object' ? JSON.stringify(e.data[k]) : e.data[k])]))
    .filter(f => f[1]);
  $('eq-fields').innerHTML = fields.map(([k, v]) => `<tr><td style="font-size:12px;color:var(--white-muted);text-transform:capitalize;width:120px">${esc(k)}</td><td style="font-size:12px">${v}</td></tr>`).join('');
  $('eq-status').value = enqStatusOf(e);
  $('eq-priority').value = e.priority || 'normal';
  $('eq-assigned').value = e.assigned_to || '';
  $('eq-notes').value = e.notes || '';
  $('eq-reply').href = `mailto:${encodeURIComponent(e.email || '')}?subject=${encodeURIComponent('Re: your BANAHUB enquiry' + (enqRef(e) ? ' (' + enqRef(e) + ')' : ''))}`;
  $('eq-reply').onclick = () => { if (enqStatusOf(e) === 'new' || enqStatusOf(e) === 'in_progress') $('eq-status').value = 'responded'; };
  $('eq-timeline').innerHTML = [`Received ${new Date(e.created_at).toLocaleString()}`, e.responded_at && `Responded ${new Date(e.responded_at).toLocaleString()}`, e.updated_at && e.updated_at !== e.created_at && `Last updated ${new Date(e.updated_at).toLocaleString()}`].filter(Boolean).join('<br/>');
  $('modal-enquiry').style.display = 'flex';
  if (enqStatusOf(e) === 'new') { $('eq-status').value = 'in_progress'; setEnquiryStatus(id, 'in_progress', true); }
}
async function saveEnquiry() {
  const id = $('eq-id').value;
  const r = await api(`/api/admin/enquiries/${id}`, 'PATCH', { status: $('eq-status').value, priority: $('eq-priority').value, assigned_to: $('eq-assigned').value.trim() || null, notes: $('eq-notes').value.trim() || null });
  if (!r || r.error) { toast('Save failed: ' + ((r && r.error) || ''), 'warn'); return; }
  toast('Enquiry updated', 'success'); logActivity('admin.enquiry_update', 'admin', `${id} → ${$('eq-status').value}`);
  closeModal('modal-enquiry'); loadEnquiries();
}
async function setEnquiryStatus(id, status, silent) {
  const r = await api(`/api/admin/enquiries/${id}`, 'PATCH', { status });
  if (!r || r.error) { toast('Update failed: ' + ((r && r.error) || ''), 'warn'); return; }
  const e = enquiries_db.find(x => x.id === id); if (e && r.enquiry) Object.assign(e, r.enquiry);
  if (!silent) { toast(`Marked ${ENQ_STATUS[status][0].toLowerCase()}`, 'success'); loadEnquiries(); }
  else { setBadge('nb-enquiries', enquiries_db.filter(q => enqStatusOf(q) === 'new').length); renderEnquiries(); }
}
async function resolveEnquiry(id) { return setEnquiryStatus(id, 'closed'); }
function exportEnquiries() {
  downloadFile(`banahub-enquiries-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(enqRows(), [
    [e => new Date(e.created_at).toISOString(), 'received'], [enqRef, 'reference'], [enqTypeOf, 'type'], ['name', 'name'], ['email', 'email'], ['phone', 'phone'],
    ['company', 'company'], ['title', 'title'], ['service', 'service'], ['message', 'message'], [enqStatusOf, 'status'], ['priority', 'priority'],
    ['assigned_to', 'assigned_to'], ['notes', 'notes'], ['responded_at', 'responded_at'], [e => JSON.stringify(e.data || {}), 'other_fields']]));
}

// ═════════════════════════════════════════════════════════════════════════
// 9. DASHBOARD + BADGES (real stats)
// ═════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  try {
    const d = await api('/api/admin/stats');
    set('ds-users', d.total_members ?? '—');
    set('ds-pending', d.pending_approvals ?? '—');
    set('ds-access', d.pending_access ?? '—');
    set('ds-enquiries', d.open_enquiries ?? '—');
    set('ds-enq-d', d.new_enquiries ? `${d.new_enquiries} new` : '');
    set('ds-businesses', d.total_companies ?? '—');
    const rev = d.revenue || {};
    set('ds-revenue', Object.keys(rev).length ? Object.keys(rev).map(c => money(rev[c], c)).join(' · ') : '0');
    applyBadges(d);
  } catch (e) { ['ds-users', 'ds-pending', 'ds-access', 'ds-enquiries', 'ds-businesses', 'ds-revenue'].forEach(id => set(id, '—')); }
  const [ud, eq, ac, tx, lg] = await Promise.all([
    api('/api/admin/users').catch(() => ({})), api('/api/admin/enquiries').catch(() => ({})), api('/api/admin/access-requests').catch(() => ({})),
    api('/api/admin/transactions').catch(() => ({})), api('/api/admin/logs').catch(() => ({})),
  ]);
  try { renderPendingUsers((ud.users || []).filter(u => u.status === 'pending')); } catch (e) {}
  try { renderAccessPreview((ac.requests || ac.access_requests || []).filter(r => r.status === 'pending')); } catch (e) {}
  try { renderPaymentsPreview((tx.transactions || []).slice(0, 5)); } catch (e) {}
  try { renderActivity((lg.logs || []).slice(0, 10)); } catch (e) {}
  const recent = (eq.enquiries || []).slice(0, 6);
  $('dash-enquiries-list').innerHTML = recent.length ? recent.map(e => { const st = enqStatusOf(e); return `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--border);cursor:pointer" onclick="nav('enquiries');setTimeout(()=>openEnquiry('${e.id}'),400)">
      <span class="material-symbols-outlined" style="font-size:18px;color:${st === 'new' ? 'var(--gold)' : 'var(--white-muted)'}">${st === 'new' ? 'mark_email_unread' : 'mail'}</span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:${st === 'new' ? 700 : 500};color:var(--ink)">${esc(e.name || e.email || '—')} <span style="font-weight:400;color:var(--white-muted);text-transform:capitalize">· ${esc(enqTypeOf(e))}</span></div>
        <div style="font-size:12px;color:var(--white-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((e.message || '').slice(0, 140))}</div></div>
      <span class="pill pill-${(ENQ_STATUS[st] || [0, 'draft'])[1]}">${esc((ENQ_STATUS[st] || [st])[0])}</span>
      <span style="font-size:11px;color:var(--white-muted);white-space:nowrap">${fmtD(e.created_at)}</span>
    </div>`; }).join('') : '<div style="padding:20px;font-size:13px;color:var(--white-muted)">No enquiries yet — Contact page submissions appear here instantly.</div>';
}
function applyBadges(d) {
  setBadge('nb-users', d.pending_approvals || 0);
  setBadge('nb-apps', d.pending_applications || 0);
  setBadge('nb-kyc', d.kyc_uploads || 0);
  setBadge('nb-access', d.pending_access || 0);
  setBadge('nb-enquiries', d.new_enquiries || 0);
  const nb = $('nb-alerts'); if (nb) nb.style.display = (d.pending_approvals || d.new_enquiries) ? 'block' : 'none';
}
async function pollBadges() {
  try { applyBadges(await api('/api/admin/stats')); } catch (e) {}
  try { setBadge('nb-drafts', (articles || []).filter(a => a.status === 'draft').length); } catch (e) {}
}

// ── Events: status tabs (All / Published / Drafts / Upcoming / Past) ─────
let evTab = 'all';
const _loadEventsBase = loadEvents;
loadEvents = async function () {
  await _loadEventsBase();
  const all = events_db || [], now = Date.now();
  const tests = { all: () => true, published: e => e.published, draft: e => !e.published,
    upcoming: e => e.event_date && new Date(e.event_date) >= now, past: e => e.event_date && new Date(e.event_date) < now };
  $('ev-tabs').innerHTML = [['all', 'All'], ['published', 'Published'], ['draft', 'Drafts'], ['upcoming', 'Upcoming'], ['past', 'Past']]
    .map(([k, l]) => `<button class="s-tab${evTab === k ? ' active' : ''}" onclick="evTab='${k}';loadEvents()">${l} (${all.filter(tests[k]).length})</button>`).join('');
  if (evTab === 'all') return;
  const keep = new Set(all.filter(tests[evTab]).map(e => e.id));
  const grid = $('events-grid');
  [...grid.children].forEach(card => {
    const m = card.innerHTML.match(/editEvent\('([^']+)'\)/);
    if (m && !keep.has(m[1])) card.remove();
  });
  if (!grid.querySelector('[onclick*="editEvent"]')) grid.insertAdjacentHTML('afterbegin', emptyRow(evTab === 'draft' ? 'No drafts — use "Save as Draft" when creating an event.' : 'No events in this view.'));
};
function renderPaymentsPreview(items) {
  const el = $('dash-payments-list');
  if (!items.length) { el.innerHTML = '<div style="padding:20px;font-size:13px;color:var(--white-muted)">No payments yet</div>'; return; }
  el.innerHTML = items.slice(0, 5).map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 20px;border-bottom:1px solid var(--border)">
      <div style="min-width:0"><div style="font-size:13px;color:var(--ink)">${money(p.amount, p.currency)}</div><div style="font-size:11px;color:var(--white-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((p.type || '').replace(/_/g, ' '))} · ${esc(p.email || '')}</div></div>
      <span class="pill pill-${p.status === 'completed' ? 'live' : p.status === 'pending' ? 'pending' : 'rejected'}">${esc(p.status)}</span>
    </div>`).join('');
}
function renderActivity(items) {
  const el = $('dash-activity');
  if (!items.length) { el.innerHTML = '<div style="padding:16px 0;font-size:13px;color:var(--white-muted)">No admin activity logged yet</div>'; return; }
  el.innerHTML = items.map(l => `
    <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0;background:${/approve|publish|create/.test(l.action || '') ? 'var(--emerald)' : /reject|delete/.test(l.action || '') ? '#b3261e' : 'var(--gold)'}"></span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.description || l.action)}</div>
        <div style="font-size:11px;color:var(--white-muted)">${esc(l.actor_email || '')} · ${new Date(l.created_at).toLocaleString()}</div></div>
    </div>`).join('');
}

// ═════════════════════════════════════════════════════════════════════════
// 10. MEMBERS & APPROVALS
// ═════════════════════════════════════════════════════════════════════════
const PROVIDERS = { google: ['Google', '#4285F4'], linkedin_oidc: ['LinkedIn', '#0A66C2'], linkedin: ['LinkedIn', '#0A66C2'], email: ['Email', '#5f6b66'] };
const provBadge = p => { const [l, c] = PROVIDERS[p] || PROVIDERS.email; return `<span style="font-size:11px;font-weight:600;color:${c};border:1px solid ${c}40;background:${c}10;border-radius:20px;padding:1px 8px">${l}</span>`; };
const U_STATUS_PILL = { approved: 'live', pending: 'pending', vetting: 'pending', rejected: 'rejected', blocked: 'rejected', invited: 'draft' };
let users_db = [], uTab = 'pending';
async function loadUsers() {
  $('users-table').innerHTML = emptyRow('Loading…');
  const d = await api('/api/admin/users').catch(() => ({}));
  users_db = (d && d.users) || [];
  renderUsers();
}
function renderUsers() {
  const cnt = st => users_db.filter(u => st === 'pending' ? ['pending', 'vetting'].includes(u.status) : u.status === st).length;
  $('u-tabs').innerHTML = [['pending', `Pending approval (${cnt('pending')})`], ['approved', `Approved (${cnt('approved')})`], ['rejected', `Rejected (${cnt('rejected')})`], ['blocked', `Blocked (${cnt('blocked')})`], ['all', `All (${users_db.length})`]]
    .map(([k, l]) => `<button class="s-tab${uTab === k ? ' active' : ''}" onclick="uTab='${k}';renderUsers()">${l}</button>`).join('');
  setBadge('nb-users', cnt('pending'));
  const q = ($('u-search').value || '').toLowerCase(), r = $('u-role-f').value, pv = $('u-prov-f').value;
  const rows = users_db.filter(u => (uTab === 'all' || (uTab === 'pending' ? ['pending', 'vetting'].includes(u.status) : u.status === uTab)) &&
    (!r || u.role === r) && (!pv || (u.auth_provider || 'email') === pv) &&
    (!q || [u.full_name, u.email, u.company_name, u.title, u.country].join(' ').toLowerCase().includes(q)));
  $('u-count').textContent = `${rows.length} shown`;
  $('users-table').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Member</th><th>Signed up with</th><th>Company</th><th>Type</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>
    ${rows.map(u => `<tr style="cursor:pointer" onclick="openUserModal('${esc(u.id)}')">
      <td><div style="display:flex;align-items:center;gap:10px">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover"/>` : `<div style="width:28px;height:28px;border-radius:50%;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${esc(((u.full_name || u.email || '?')[0] || '?').toUpperCase())}</div>`}
        <div><div style="font-weight:600;color:var(--ink)">${esc(u.full_name || '—')}</div><div style="font-size:11px;font-family:var(--font-mono);color:var(--white-muted)">${esc(u.email)}</div></div></div></td>
      <td>${provBadge(u.auth_provider)}</td>
      <td style="font-size:12px">${esc(u.company_name || '—')}${u.title ? `<div style="color:var(--white-muted)">${esc(u.title)}</div>` : ''}</td>
      <td style="font-size:12px;text-transform:capitalize">${esc(u.role || '—')}</td>
      <td><span class="pill pill-${U_STATUS_PILL[u.status] || 'draft'}">${esc(u.status || '—')}</span></td>
      <td style="font-size:12px;color:var(--white-muted)">${fmtD(u.created_at)}</td>
      <td style="white-space:nowrap" onclick="event.stopPropagation()">${u.status !== 'approved' && u.role !== 'admin' ? `<button class="btn btn-approve btn-sm" onclick="quickApprove('${esc(u.id)}')">Approve</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="openUserModal('${esc(u.id)}')">Review</button></td></tr>`).join('')}</tbody></table>`
    : emptyRow(uTab === 'pending' ? 'No sign-ups waiting for approval.' : 'No members in this view.');
}
async function quickApprove(id) {
  const r = await api(`/api/admin/members/${id}`, 'PATCH', { status: 'approved' });
  if (!r || r.error) { toast('Approve failed: ' + ((r && r.error) || ''), 'warn'); return; }
  const u = users_db.find(x => x.id === id); logActivity('admin.member_approve', 'admin', `Approved ${u ? u.email : id}`);
  toast('Member approved — portal unlocked', 'success');
  if (currentPanel === 'dashboard') loadDashboard(); else loadUsers();
}
async function rejectUser(id) { const r = await api(`/api/admin/members/${id}`, 'PATCH', { status: 'rejected' }); if (r && !r.error) { toast('Rejected', 'warn'); loadUsers(); } }
let _uModal = null;
async function openUserModal(id) {
  $('u-id').value = id; $('modal-user').style.display = 'flex';
  $('u-profile').innerHTML = '<tr><td>Loading…</td></tr>'; $('u-apps').textContent = ''; $('u-kyc').textContent = '';
  const d = await api(`/api/admin/members/${id}`).catch(() => ({}));
  const u = d.user || users_db.find(x => x.id === id) || {}; _uModal = d;
  $('u-modal-title').textContent = u.full_name || u.email || 'Member';
  $('u-modal-sub').innerHTML = `${esc(u.email || '')} · ${provBadge(u.auth_provider)}`;
  $('u-avatar').src = u.avatar_url || ''; $('u-avatar').style.display = u.avatar_url ? '' : 'none';
  const link = v => v ? `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer" style="color:var(--emerald)">${esc(v)}</a>` : '';
  $('u-profile').innerHTML = [['Title', esc(u.title || '')], ['Company', esc(u.company_name || '')], ['Phone', esc(u.phone || '')], ['Country', esc(u.country || '')],
    ['LinkedIn', link(u.linkedin_url)], ['Website', link(u.website)], ['Bio', esc(u.bio || '')]].filter(r => r[1])
    .map(([k, v]) => `<tr><td style="width:100px;font-size:12px;color:var(--white-muted)">${k}</td><td style="font-size:12px">${v}</td></tr>`).join('') || '<tr><td style="font-size:12px;color:var(--white-muted)">Profile not completed yet</td></tr>';
  $('u-apps').innerHTML = (d.applications || []).length ? d.applications.map(a => `<div style="background:var(--surface);border-radius:8px;padding:10px;margin-bottom:6px">
      <b style="text-transform:capitalize">${esc((a.type || '').replace(/_/g, ' '))}</b> · <span class="pill pill-${U_STATUS_PILL[a.status] || 'draft'}">${esc(a.status)}</span> · ${fmtD(a.created_at)}
      <div style="margin-top:6px;color:var(--white-dim)">${Object.entries(a.data || {}).filter(([k, v]) => v && !['type', 'csrf_token'].includes(k)).map(([k, v]) => `<div><span style="color:var(--white-muted)">${esc(k.replace(/_/g, ' '))}:</span> ${esc(Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v)}</div>`).join('')}</div></div>`).join('')
    : '<span style="color:var(--white-muted)">No application submitted (OAuth sign-ups complete their profile in the portal).</span>';
  $('u-kyc').innerHTML = (d.kyc || []).length ? d.kyc.map(k => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span class="material-symbols-outlined" style="font-size:16px">description</span><span>${esc(k.file_name || k.document_type || 'Document')}</span>
      <span class="pill pill-${['approved', 'verified'].includes(k.status) ? 'live' : k.status === 'pending' ? 'pending' : 'rejected'}">${esc(k.status)}</span>
      <button class="btn btn-ghost btn-sm" onclick="viewKyc('${esc(k.id)}')">View</button></div>`).join('') : '<span style="color:var(--white-muted)">None uploaded</span>';
  $('u-status-edit').value = u.status || 'pending'; $('u-role-edit').value = u.role || 'applicant'; $('u-note').value = u.blocked_reason || '';
  $('u-timeline').innerHTML = [`Joined ${new Date(u.created_at || Date.now()).toLocaleString()}`, u.approved_at && `Approved ${new Date(u.approved_at).toLocaleString()}`, u.updated_at && `Profile updated ${new Date(u.updated_at).toLocaleString()}`].filter(Boolean).join('<br/>');
}
async function saveUserEdit(force) {
  const id = $('u-id').value, status = force || $('u-status-edit').value;
  const patch = { status, role: $('u-role-edit').value, blocked: status === 'blocked', blocked_reason: ['blocked', 'rejected'].includes(status) ? ($('u-note').value.trim() || null) : null };
  if (patch.role === 'admin' && !confirm('Grant FULL ADMIN access to this account?')) return;
  const r = await api(`/api/admin/members/${id}`, 'PATCH', patch);
  if (!r || r.error) { toast('Save failed: ' + ((r && r.error) || ''), 'warn'); return; }
  logActivity('admin.member_update', 'admin', `${(r.user && r.user.email) || id} → ${status}/${patch.role}`);
  toast(status === 'approved' ? 'Member approved' : 'Member updated', 'success'); closeModal('modal-user'); loadUsers();
}
async function viewKyc(id) {
  const r = await api(`/api/kyc/admin/${id}/url`).catch(() => ({}));
  if (r && r.url) window.open(r.url, '_blank', 'noopener'); else toast('Could not open document: ' + ((r && r.error) || 'no file'), 'warn');
}
function exportMembers() {
  downloadFile(`banahub-members-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(users_db, [['full_name', 'name'], ['email', 'email'], ['auth_provider', 'sign_in'], ['company_name', 'company'], ['title', 'title'],
    ['role', 'type'], ['status', 'status'], ['country', 'country'], ['phone', 'phone'], ['linkedin_url', 'linkedin'], [u => u.created_at, 'joined'], ['approved_at', 'approved_at']]));
}

// ── KYC panel ─────────────────────────────────────────────────────────────
async function loadKYC() {
  const d = await api('/api/kyc/admin/all').catch(() => ({}));
  const rows = (d && d.uploads) || [];
  $('kyc-table').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Uploaded</th><th>Member</th><th>Document</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(k => `<tr><td style="font-size:12px;color:var(--white-muted)">${fmtD(k.created_at)}</td>
      <td style="font-size:13px">${esc((k.users && (k.users.full_name || k.users.email)) || '—')}<div style="font-size:11px;color:var(--white-muted)">${esc((k.users && k.users.company_name) || '')}</div></td>
      <td style="font-size:12px">${esc(k.file_name || k.document_type || '—')}</td>
      <td><span class="pill pill-${['approved', 'verified'].includes(k.status) ? 'live' : k.status === 'pending' ? 'pending' : 'rejected'}">${esc(k.status)}</span></td>
      <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="viewKyc('${esc(k.id)}')">View</button>
        ${k.status !== 'approved' ? `<button class="btn btn-approve btn-sm" onclick="approveKYC('${esc(k.id)}')">Approve</button>` : ''}
        ${k.status !== 'rejected' ? `<button class="btn btn-danger btn-sm" onclick="rejectKYC('${esc(k.id)}')">Reject</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : emptyRow('No KYC documents');
  setBadge('nb-kyc', rows.filter(k => k.status === 'pending').length);
}
async function setKyc(id, status) { const r = await api(`/api/kyc/admin/${id}/status`, 'PATCH', { status }); if (!r || r.error) { toast('Failed: ' + ((r && r.error) || ''), 'warn'); return; } toast(`KYC ${status}`, 'success'); logActivity('admin.kyc_' + status, 'admin', id); loadKYC(); }
function approveKYC(id) { return setKyc(id, 'approved'); }
function rejectKYC(id) { return setKyc(id, 'rejected'); }

// ═════════════════════════════════════════════════════════════════════════
// 11. CRM
// ═════════════════════════════════════════════════════════════════════════
const CRM_STAGES = [['new', 'New', '#5f6b66'], ['contacted', 'Contacted', '#1a4d7a'], ['qualified', 'Qualified', '#735c00'], ['proposal', 'Proposal', '#5a3e7a'],
  ['negotiation', 'Negotiation', '#8a4a1a'], ['won', 'Won', '#0a5c40'], ['lost', 'Lost', '#8a1a1a']];
let crm_db = [], crmView = 'board';
const today = () => new Date().toISOString().slice(0, 10);
async function loadCrm() {
  $('crm-body').innerHTML = emptyRow('Loading…');
  const d = await api('/api/admin/crm').catch(() => ({}));
  if (d && d.error) { $('crm-body').innerHTML = emptyRow('Could not load CRM: ' + esc(d.error) + '<br/>Run SQL migration 11.'); return; }
  crm_db = (d && d.contacts) || [];
  renderCrm();
}
function crmRows() {
  const q = ($('crm-search').value || '').toLowerCase(), t = $('crm-type-f').value, due = $('crm-due-f').checked;
  return crm_db.filter(c => (!t || c.contact_type === t) && (!due || (c.next_action_date && c.next_action_date <= today() && !['won', 'lost'].includes(c.pipeline_stage))) &&
    (!q || [c.name, c.email, c.company, c.title, c.notes, arr(c.tags).join(' ')].join(' ').toLowerCase().includes(q)));
}
function renderCrm() {
  const rows = crmRows(), open = crm_db.filter(c => !['won', 'lost'].includes(c.pipeline_stage));
  const sum = list => { const o = {}; list.forEach(c => { if (c.deal_value) o[c.currency || 'SGD'] = (o[c.currency || 'SGD'] || 0) + Number(c.deal_value); }); return Object.keys(o).map(k => money(o[k], k)).join(' · ') || '—'; };
  const dueN = open.filter(c => c.next_action_date && c.next_action_date <= today()).length;
  setBadge('nb-crm', dueN);
  $('crm-kpis').innerHTML = [['Contacts', crm_db.length], ['Open pipeline', sum(open)], ['Won', sum(crm_db.filter(c => c.pipeline_stage === 'won'))], ['Follow-ups due', dueN]]
    .map(([l, v]) => `<div class="card" style="padding:14px"><div style="color:var(--white-muted);font-size:12px">${l}</div><div style="font-size:20px;font-weight:700;color:var(--ink);margin-top:4px">${esc(v)}</div></div>`).join('');
  $('crm-count').textContent = `${rows.length} shown`;
  const card = c => { const late = c.next_action_date && c.next_action_date <= today() && !['won', 'lost'].includes(c.pipeline_stage); return `
    <div onclick="openCrm('${esc(c.id)}')" style="background:var(--bg-3);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;cursor:pointer">
      <div style="font-weight:600;font-size:13px;color:var(--ink)">${esc(c.name || c.email || '—')}</div>
      <div style="font-size:11px;color:var(--white-muted)">${esc(c.company || '')}${c.contact_type ? ' · ' + esc(c.contact_type) : ''}</div>
      ${c.deal_value ? `<div style="font-size:12px;font-weight:600;margin-top:4px">${money(c.deal_value, c.currency)}</div>` : ''}
      ${c.next_action ? `<div style="font-size:11px;margin-top:4px;color:${late ? '#b3261e' : 'var(--white-dim)'}">→ ${esc(c.next_action)}${c.next_action_date ? ' · ' + fmtD(c.next_action_date) : ''}</div>` : ''}
      <select class="f-input f-select" style="margin-top:6px;padding:2px 6px;font-size:11px" onclick="event.stopPropagation()" onchange="moveCrm('${esc(c.id)}',this.value)">${CRM_STAGES.map(([k, l]) => `<option value="${k}" ${k === c.pipeline_stage ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>`; };
  if (crmView === 'board') {
    $('crm-body').innerHTML = `<div style="display:grid;grid-template-columns:repeat(${CRM_STAGES.length},minmax(190px,1fr));gap:10px;overflow-x:auto;padding-bottom:8px">
      ${CRM_STAGES.map(([k, l, col]) => { const list = rows.filter(c => (c.pipeline_stage || 'new') === k); return `<div style="background:var(--surface);border-radius:12px;padding:10px;min-height:200px">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:${col};margin-bottom:8px"><span>${l}</span><span>${list.length}</span></div>${list.map(card).join('')}</div>`; }).join('')}</div>`;
  } else {
    $('crm-body').innerHTML = `<div class="card" style="overflow:auto">${rows.length ? `<table class="data-table"><thead><tr><th>Name</th><th>Company</th><th>Type</th><th>Stage</th><th>Value</th><th>Next action</th><th>Owner</th><th>Updated</th></tr></thead><tbody>
      ${rows.map(c => `<tr style="cursor:pointer" onclick="openCrm('${esc(c.id)}')"><td><b>${esc(c.name || '—')}</b><div style="font-size:11px;color:var(--white-muted)">${esc(c.email || '')}</div></td><td style="font-size:12px">${esc(c.company || '')}</td>
        <td style="font-size:12px;text-transform:capitalize">${esc(c.contact_type || '')}</td><td style="font-size:12px">${esc((CRM_STAGES.find(s => s[0] === c.pipeline_stage) || ['', c.pipeline_stage || 'New'])[1])}</td>
        <td style="font-size:12px">${c.deal_value ? money(c.deal_value, c.currency) : '—'}</td><td style="font-size:12px">${esc(c.next_action || '')}${c.next_action_date ? ' · ' + fmtD(c.next_action_date) : ''}</td>
        <td style="font-size:12px">${esc(c.owner || '')}</td><td style="font-size:12px;color:var(--white-muted)">${fmtD(c.updated_at || c.created_at)}</td></tr>`).join('')}</tbody></table>` : emptyRow('No contacts')}</div>`;
  }
}
async function moveCrm(id, stage) {
  const r = await api(`/api/admin/crm/${id}`, 'PATCH', { pipeline_stage: stage });
  if (!r || r.error) { toast('Failed: ' + ((r && r.error) || ''), 'warn'); return; }
  await api(`/api/admin/crm/${id}/activities`, 'POST', { kind: 'stage', body: `Moved to ${stage}` });
  const c = crm_db.find(x => x.id === id); if (c) c.pipeline_stage = stage; renderCrm();
}
async function openCrm(id, prefill) {
  const c = id ? crm_db.find(x => x.id === id) || {} : (prefill || {});
  $('crm-id').value = id || '';
  $('crm-title').textContent = id ? (c.name || 'Contact') : 'New Contact';
  $('crm-sub').textContent = id ? `Added ${fmtD(c.created_at)}${c.source ? ' · from ' + c.source : ''}` : '';
  $('crm-stage').innerHTML = CRM_STAGES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  [['crm-name', 'name'], ['crm-email', 'email'], ['crm-company', 'company'], ['crm-ttl', 'title'], ['crm-phone', 'phone'], ['crm-li', 'linkedin_url'],
   ['crm-value', 'deal_value'], ['crm-owner', 'owner'], ['crm-source', 'source'], ['crm-next', 'next_action'], ['crm-due', 'next_action_date'], ['crm-notes', 'notes']]
    .forEach(([el, k]) => $(el).value = c[k] == null ? '' : c[k]);
  $('crm-type').value = c.contact_type || 'company'; $('crm-stage').value = c.pipeline_stage || 'new'; $('crm-cur').value = c.currency || 'SGD';
  $('crm-tags').value = arr(c.tags).join(', ');
  $('crm-del').style.display = id ? '' : 'none';
  $('crm-activity').innerHTML = id ? 'Loading…' : '<span style="color:var(--white-muted)">Save the contact to start logging activity.</span>';
  $('modal-crm').style.display = 'flex';
  if (id) loadCrmActivity(id);
}
async function loadCrmActivity(id) {
  {
    const d = await api(`/api/admin/crm/${id}/activities`).catch(() => ({}));
    const icon = { note: 'sticky_note_2', call: 'call', email: 'mail', meeting: 'groups', stage: 'swap_horiz' };
    $('crm-activity').innerHTML = (d.activities || []).map(a => `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span class="material-symbols-outlined" style="font-size:16px;color:var(--white-muted)">${icon[a.kind] || 'notes'}</span>
      <div><div>${esc(a.body || '')}</div><div style="font-size:10px;color:var(--white-muted)">${esc(a.created_by || '')} · ${new Date(a.created_at).toLocaleString()}</div></div></div>`).join('') || '<span style="color:var(--white-muted)">No activity yet.</span>';
  }
}
async function saveCrm() {
  const id = $('crm-id').value;
  const p = { name: $('crm-name').value.trim(), email: $('crm-email').value.trim().toLowerCase() || null, company: $('crm-company').value.trim() || null,
    title: $('crm-ttl').value.trim() || null, phone: $('crm-phone').value.trim() || null, linkedin_url: $('crm-li').value.trim() || null,
    contact_type: $('crm-type').value, pipeline_stage: $('crm-stage').value, deal_value: parseMoney($('crm-value').value), currency: $('crm-cur').value,
    owner: $('crm-owner').value.trim() || null, source: $('crm-source').value.trim() || null, next_action: $('crm-next').value.trim() || null,
    next_action_date: $('crm-due').value || null, tags: arr($('crm-tags').value), notes: $('crm-notes').value.trim() || null };
  if (!p.name) { toast('Name required', 'warn'); return; }
  const r = id ? await api(`/api/admin/crm/${id}`, 'PATCH', p) : await api('/api/admin/crm', 'POST', p);
  if (!r || r.error) { toast('Save failed: ' + ((r && r.error) || ''), 'warn'); return; }
  toast(r.existing ? 'Contact already in CRM — opened it' : id ? 'Contact saved' : 'Contact added', 'success');
  closeModal('modal-crm'); await loadCrm(); if (r.existing && r.contact) openCrm(r.contact.id);
}
async function addCrmActivity() {
  const id = $('crm-id').value, body = $('crm-act-body').value.trim();
  if (!id) { toast('Save the contact first', 'warn'); return; } if (!body) return;
  const r = await api(`/api/admin/crm/${id}/activities`, 'POST', { kind: $('crm-act-kind').value, body });
  if (!r || r.error) { toast('Failed: ' + ((r && r.error) || ''), 'warn'); return; }
  $('crm-act-body').value = ''; loadCrmActivity(id);
}
async function deleteCrm() {
  const id = $('crm-id').value; if (!id || !confirm('Delete this contact and its activity history?')) return;
  const r = await api(`/api/admin/crm/${id}`, 'DELETE'); if (r && r.error) { toast(r.error, 'warn'); return; }
  closeModal('modal-crm'); loadCrm();
}
function exportCrm() {
  downloadFile(`banahub-crm-${today()}.csv`, toCSV(crmRows(), [['name', 'name'], ['email', 'email'], ['company', 'company'], ['title', 'title'], ['phone', 'phone'], ['contact_type', 'type'],
    ['pipeline_stage', 'stage'], ['deal_value', 'value'], ['currency', 'currency'], ['owner', 'owner'], ['next_action', 'next_action'], ['next_action_date', 'due'], ['tags', 'tags'], ['source', 'source'], ['notes', 'notes']]));
}
async function crmCreateFrom(prefill) {
  const r = await api('/api/admin/crm', 'POST', prefill);
  if (!r || r.error) { toast('Could not add to CRM: ' + ((r && r.error) || ''), 'warn'); return; }
  toast(r.existing ? 'Already in CRM' : 'Added to CRM', 'success');
  if (!r.existing) await api(`/api/admin/crm/${r.contact.id}/activities`, 'POST', { kind: 'note', body: `Created from ${prefill.source}` });
}
function enquiryToCrm() {
  const e = enquiries_db.find(x => x.id === $('eq-id').value); if (!e) return;
  crmCreateFrom({ name: e.name || e.email, email: e.email, company: e.company, title: e.title, phone: e.phone, contact_type: ['investor', 'partner'].includes(enqTypeOf(e)) ? enqTypeOf(e) : 'company',
    pipeline_stage: 'new', source: 'enquiry', source_id: e.id, notes: (e.message || '').slice(0, 2000) });
}
function memberToCrm() {
  const u = (_uModal && _uModal.user) || {}; if (!u.id) return;
  crmCreateFrom({ name: u.full_name || u.email, email: u.email, company: u.company_name, title: u.title, phone: u.phone, linkedin_url: u.linkedin_url,
    contact_type: u.role === 'investor' ? 'investor' : u.role === 'partner' ? 'partner' : 'member', pipeline_stage: 'qualified', source: 'member', source_id: u.id });
}

// ═════════════════════════════════════════════════════════════════════════
// 12. EVENT EDITOR (create · draft · publish · edit · image upload · links)
// ═════════════════════════════════════════════════════════════════════════
const SITE_ORIGIN = location.origin;
function evImgPreview() {
  const url = $('ev-img').value.trim(), box = $('ev-img-preview');
  if (url && /^https?:\/\//i.test(url)) { box.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`; box.textContent = ''; }
  else { box.style.backgroundImage = ''; box.textContent = 'No image'; }
}
async function uploadEventImage(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Use a JPG, PNG or WEBP image', 'warn'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB', 'warn'); return; }
  const box = $('ev-img-preview'); box.textContent = 'Uploading…';
  try {
    const sb = await window.getBanaSupabaseClient();
    const path = `events/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '_')}`;
    const { error } = await sb.storage.from('media').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '31536000' });
    if (error) throw error;
    const url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
    await api('/api/admin/content/media', 'POST', { file_url: url, file_name: file.name, file_type: file.type, storage_path: path });
    $('ev-img').value = url; evImgPreview(); toast('Image uploaded', 'success');
  } catch (e) { box.textContent = 'Upload failed'; toast('Upload failed: ' + (e.message || e), 'warn'); }
}
function evShowPublicLink(e) {
  const el = $('ev-public-link');
  if (!e || !e.id) { el.style.display = 'none'; return; }
  const url = SITE_ORIGIN + eventPageUrl(e);
  el.style.display = '';
  el.innerHTML = `<div style="color:var(--white-muted);margin-bottom:4px">${e.published ? 'Live at' : 'Draft — will be live at'}</div>
    <div style="display:flex;gap:6px;align-items:center"><code style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(url)}</code>
    <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(url)}');toast('Link copied','success')">Copy</button></div>`;
}
function _evSet(e) {
  const v = (id, val) => { $(id).value = val == null ? '' : val; };
  const dt = d => d ? new Date(new Date(d).getTime() - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  v('ev-id', e.id); v('ev-title', e.title); $('ev-type').value = e.type || 'Summit'; $('ev-format').value = e.format || 'In-Person';
  v('ev-start', dt(e.event_date)); v('ev-end', dt(e.end_date)); v('ev-location', e.location); v('ev-desc', e.description);
  v('ev-reg', e.registration_url); v('ev-luma-url', e.luma_url); v('ev-video', e.video_url); v('ev-img', e.cover_image);
  v('ev-price', e.price_amount || ''); $('ev-currency').value = e.currency || 'SGD'; v('ev-cap', e.capacity); v('ev-slug', e.slug); v('ev-page-url', e.page_url);
  $('ev-pub').checked = !!e.published; $('ev-featured').checked = !!e.featured; $('ev-invite-only').checked = !!e.invite_only; $('ev-require-approval').checked = !!e.require_approval;
  $('ev-desc-count').textContent = `${(e.description || '').length} / 10000`;
  evImgPreview(); evShowPublicLink(e.id ? e : null);
  $('ev-luma-btn').style.display = e.id ? '' : 'none';
  $('ev-luma-status').innerHTML = e.luma_event_id ? `Synced to Luma · <span style="color:var(--emerald);cursor:pointer" onclick="syncEventRsvps('${esc(e.id)}')">Sync RSVPs</span>` : '';
  document.querySelector('#modal-event .modal-title').textContent = e.id ? 'Edit Event' : 'Create Event';
  $('ev-save-btn').textContent = e.id && e.published ? 'Save & keep live' : 'Publish';
}
function openEventModal() { _evSet({}); $('modal-event').style.display = 'flex'; setTimeout(() => $('ev-title').focus(), 50); }
function editEvent(id) { const e = (events_db || []).find(x => x.id === id); if (!e) return; _evSet(e); $('modal-event').style.display = 'flex'; }
document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'ev-desc') $('ev-desc-count').textContent = `${ev.target.value.length} / 10000`; });
const _okUrl = u => !u || /^https:\/\/[^\s]+$/i.test(u) || /^http:\/\/[^\s]+$/i.test(u);
async function saveEvent(publish) {
  const id = $('ev-id').value;
  if (typeof publish === 'boolean') $('ev-pub').checked = publish;
  const val = x => $(x).value.trim();
  const toIso = x => val(x) ? new Date(val(x)).toISOString() : null;
  const slug = val('ev-slug').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;
  const p = {
    title: val('ev-title'), type: $('ev-type').value, format: $('ev-format').value,
    event_date: toIso('ev-start'), end_date: toIso('ev-end'), location: val('ev-location') || null, description: $('ev-desc').value.trim() || null,
    registration_url: val('ev-reg') || null, luma_url: val('ev-luma-url') || null, video_url: val('ev-video') || null, cover_image: val('ev-img') || null,
    price_amount: Number(val('ev-price')) || 0, currency: $('ev-currency').value, capacity: val('ev-cap') ? Number(val('ev-cap')) : null,
    slug, page_url: val('ev-page-url') || null,
    published: $('ev-pub').checked, featured: $('ev-featured').checked, invite_only: $('ev-invite-only').checked, require_approval: $('ev-require-approval').checked,
  };
  if (!p.title) { toast('Event title is required', 'warn'); $('ev-title').focus(); return; }
  if (p.published && !p.event_date) { toast('Add a start date before publishing', 'warn'); $('ev-start').focus(); return; }
  if (p.end_date && p.event_date && p.end_date < p.event_date) { toast('End must be after start', 'warn'); return; }
  for (const [k, l] of [['registration_url', 'Event link'], ['luma_url', 'Luma URL'], ['video_url', 'Video URL'], ['cover_image', 'Image URL']])
    if (!_okUrl(p[k])) { toast(`${l} must start with https://`, 'warn'); return; }
  if (p.page_url && !/^\/[a-z0-9\-\/]*$/i.test(p.page_url)) { toast('Custom landing page must be a site path like /capital-growth-exchange', 'warn'); return; }
  const btn = $('ev-save-btn'); btn.disabled = true;
  try {
    const r = id ? await api(`/api/admin/content/events/${id}`, 'PATCH', p) : await api('/api/admin/content/events', 'POST', p);
    const saved = r && r.event;
    if (!saved) throw new Error((r && (r.error || r.detail)) || 'Save failed — check you are signed in as admin');
    toast(p.published ? (id ? 'Event updated — live on website' : 'Event published') : 'Saved as draft', 'success');
    logActivity(id ? 'admin.event_update' : 'admin.event_create', 'admin', `${p.title} (${p.published ? 'published' : 'draft'})`);
    await loadEvents();
    _evSet(saved);   // stay in the editor: shows the public link, enables Luma sync
  } catch (e) { toast(e.message || 'Could not save event', 'warn'); }
  finally { btn.disabled = false; }
}
async function toggleEvent(id, publish) {
  const e = (events_db || []).find(x => x.id === id);
  if (publish && e && !e.event_date) { toast('Add a start date before publishing', 'warn'); editEvent(id); return; }
  const r = await api(`/api/admin/content/events/${id}`, 'PATCH', { published: publish });
  if (!r || !r.event) { toast('Could not update: ' + ((r && (r.error || r.detail)) || ''), 'warn'); return; }
  toast(publish ? 'Published — live on website' : 'Unpublished (draft)', 'success'); loadEvents();
}
async function deleteEvent(id) {
  const e = (events_db || []).find(x => x.id === id);
  if (!confirm(`Delete "${e ? e.title : 'this event'}"? This cannot be undone.`)) return;
  const r = await api(`/api/admin/content/events/${id}`, 'DELETE');
  if (r && r.error) { toast(r.error, 'warn'); return; }
  toast('Event deleted', 'warn'); loadEvents();
}

// ═════════════════════════════════════════════════════════════════════════
// 13. SMART IMPORT — auto-detects columns and arranges investor data
//     (header-row detection, fuzzy + content-based column matching,
//      standardised type / sectors / stages / geography / ticket,
//      tidy names, emails and links, duplicate merge, nothing dropped)
// ═════════════════════════════════════════════════════════════════════════
const _n = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const _title = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/\w[^\s-]*/g, w => (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
const _fixCase = s => String(s || '').trim().replace(/\s+/g, ' ').split(' ').map(w => (w === w.toLowerCase() || (w === w.toUpperCase() && w.length > 2)) ? w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, a, c) => a + c.toUpperCase()) : w).join(' ');
const HEADER_SYNONYMS = {
  investor: {
    full_name: ['name', 'full name', 'contact', 'contact name', 'contact person', 'investor name', 'partner', 'partner name', 'person', 'decision maker', 'key contact', 'managing partner'],
    first_name: ['first name', 'firstname', 'given name', 'first'],
    last_name: ['last name', 'lastname', 'surname', 'family name', 'last'],
    organization: ['organization', 'organisation', 'firm', 'fund', 'company', 'fund name', 'firm name', 'investor', 'institution', 'vc firm', 'fund firm', 'company name', 'entity', 'family office', 'investor firm'],
    email: ['email', 'e mail', 'email address', 'mail', 'work email', 'contact email', 'business email'],
    phone: ['phone', 'mobile', 'tel', 'telephone', 'phone number', 'contact number', 'whatsapp', 'cell', 'handphone', 'hand phone', 'hp', 'hp no', 'hp number', 'handphone number', 'mobile number', 'mobile no', 'phone no', 'tel no', 'contact no', 'whatsapp number', 'cell phone', 'direct line', 'office phone', 'mobile phone'],
    investor_type: ['type', 'investor type', 'category', 'investor category', 'type of investor', 'fund type', 'investor class', 'segment'],
    focus_sectors: ['sectors', 'sector', 'focus', 'focus sectors', 'industries', 'industry', 'verticals', 'vertical', 'thesis', 'sector focus', 'industry focus', 'investment focus', 'areas of interest', 'interests', 'themes'],
    preferred_stages: ['stages', 'stage', 'preferred stage', 'preferred stages', 'investment stage', 'investment stages', 'round', 'rounds', 'stage focus', 'funding stage'],
    geography: ['geography', 'region', 'regions', 'location', 'country', 'countries', 'hq', 'markets', 'geo', 'geographic focus', 'city', 'based in', 'headquarters', 'market focus', 'target markets'],
    check_size: ['check size', 'ticket', 'ticket size', 'cheque size', 'investment size', 'check', 'typical check', 'investment range', 'ticket range', 'deal size', 'cheque'],
    check_min: ['check min', 'min check', 'min ticket', 'minimum', 'min investment', 'minimum ticket', 'min'],
    check_max: ['check max', 'max check', 'max ticket', 'maximum', 'max investment', 'maximum ticket', 'max'],
    website: ['website', 'url', 'web', 'site', 'homepage', 'web address', 'company website'],
    linkedin_url: ['linkedin', 'linkedin url', 'linkedin profile', 'li', 'linkedin link'],
    notes: ['notes', 'note', 'comments', 'comment', 'description', 'remarks', 'bio', 'about', 'details'],
  },
  company: {
    company_name: ['company', 'company name', 'name', 'business', 'startup', 'organisation', 'organization', 'brand'],
    contact_name: ['contact', 'contact name', 'founder', 'ceo', 'full name', 'founder name'],
    email: ['email', 'e mail', 'email address', 'contact email'],
    website: ['website', 'url', 'web', 'homepage'],
    industry: ['industry', 'sector', 'sectors', 'industries', 'vertical', 'category'],
    stage: ['stage', 'round', 'funding stage', 'current stage'],
    description: ['description', 'about', 'summary', 'notes', 'pitch', 'one liner'],
    linkedin_url: ['linkedin', 'linkedin url'],
  },
};
// keep the older name working for anything still referencing it
const IMPORT_FIELDS_ALL = HEADER_SYNONYMS;

const TYPE_RULES = [
  [/sovereign|\bswf\b|government|\bgov\b|state fund|public fund/, 'Sovereign / Government'],
  [/venture debt|\bbank\b|lender|lending|private credit|\bdebt\b|credit fund/, 'Bank / Debt'],
  [/family office|\bs?m?fo\b|single family|multi family/, 'Family Office'],
  [/corporate|\bcvc\b|strategic/, 'Corporate VC'],
  [/fund of funds|\bfof\b|\blps?\b|limited partner|pension|endowment|insurance|asset manag|institutional/, 'LP / Fund of Funds'],
  [/private equity|\bpe\b|buy ?out|growth equity/, 'Private Equity'],
  [/hedge/, 'Hedge Fund'],
  [/accelerator|incubator|venture studio|\bstudio\b/, 'Accelerator'],
  [/angel|individual|\bhnwi?\b|syndicate|super angel/, 'Angel'],
  [/venture|\bvc\b|micro ?vc|seed fund|early stage fund/, 'VC'],
];
const SECTOR_RULES = [
  [/generalist|agnostic|all sectors|sector neutral|^any$|^all$/, 'Generalist'],
  [/web ?3|crypto|blockchain|defi|digital asset|\bnft/, 'Web3 / Digital Assets'],
  [/fin ?tech|financial (services|tech)|payment|banking|insur ?tech|wealth ?tech|lending|regtech|neobank/, 'Fintech'],
  [/\bai\b|artificial intelligence|machine learning|\bml\b|gen ?ai|\bllm|data (science|analytics)|\bdata\b/, 'AI / Data'],
  [/cyber|security/, 'Cybersecurity'],
  [/deep ?tech|semiconductor|quantum|space ?tech|\bspace\b|advanced material/, 'Deep Tech'],
  [/saas|software|b2b|enterprise|cloud|dev ?tools|productivity/, 'SaaS / Software'],
  [/health|med ?tech|bio ?tech|life science|pharma|medical|wellness|femtech|digital health/, 'Healthcare / Life Sciences'],
  [/climate|clean ?tech|energy|renewable|sustainab|\besg\b|green|carbon|solar|battery|circular/, 'Climate / Energy'],
  [/prop ?tech|real estate|property|construction|con ?tech/, 'Real Estate / PropTech'],
  [/agri|ag ?tech|food ?tech|aquaculture|farming/, 'Agri / Food Tech'],
  [/consumer|e ?commerce|retail|d2c|\bdtc\b|fmcg|\bf ?b\b|food|beverage|lifestyle|fashion|beauty|marketplace/, 'Consumer / E-commerce'],
  [/ed ?tech|education|learning/, 'Education'],
  [/logistic|supply chain|transport|mobility|shipping|automotive|\bev\b/, 'Logistics / Mobility'],
  [/industrial|manufactur|hardware|robotic|\biot\b|automation/, 'Industrial / Hardware'],
  [/media|entertainment|gaming|games|content|creator|sports/, 'Media / Gaming'],
  [/hr ?tech|future of work|workforce|recruit/, 'HR / Future of Work'],
  [/travel|hospitality|tourism/, 'Travel / Hospitality'],
  [/telecom|connectivity|5g/, 'Telecom'],
];
const STAGE_RULES = [
  [/pre ?seed|idea|concept/, ['Pre-seed']],
  [/early stage|early/, ['Seed', 'Series A']],
  [/late stage|late/, ['Series C+', 'Growth']],
  [/pre ?ipo|mezz/, ['Pre-IPO']],
  [/(?<!pre ?)\bseed\b/, ['Seed']],
  [/series ?a\b|\ba round\b/, ['Series A']],
  [/series ?b\b|\bb round\b/, ['Series B']],
  [/series ?[c-z]\b|series ?c\+/, ['Series C+']],
  [/growth|expansion|scale ?up/, ['Growth']],
  [/buy ?out|\bmbo\b|\blbo\b|control/, ['Buyout']],
  [/debt|credit|loan/, ['Debt']],
];
const GEO_RULES = [
  [/global|worldwide|international|all regions|any/, 'Global'],
  [/south ?east asia|\bsea\b|asean/, 'Southeast Asia'],
  [/^sg$|singapore/, 'Singapore'], [/^(my|malaysia|kuala lumpur|kl)$/, 'Malaysia'], [/^(id|indonesia|jakarta)$/, 'Indonesia'],
  [/^(vn|vietnam|viet nam|ho chi minh|hanoi)$/, 'Vietnam'], [/^(th|thailand|bangkok)$/, 'Thailand'], [/^(ph|philippines|manila)$/, 'Philippines'],
  [/\buae\b|dubai|abu dhabi|emirates/, 'UAE'], [/saudi|\bksa\b|riyadh/, 'Saudi Arabia'], [/qatar|doha/, 'Qatar'],
  [/\bgcc\b|gulf|middle east|\bmena\b/, 'Middle East / GCC'],
  [/hong ?kong|^hk$/, 'Hong Kong'], [/^(cn|china|prc|shanghai|beijing|shenzhen)$/, 'China'], [/japan|tokyo|^jp$/, 'Japan'], [/korea|seoul|^kr$/, 'South Korea'],
  [/^(in|india|mumbai|bangalore|bengaluru|delhi)$/, 'India'], [/australia|\banz\b|sydney|melbourne|new zealand/, 'Australia / NZ'],
  [/^(us|usa|united states|america|north america|new york|san francisco|silicon valley)$/, 'United States'],
  [/^(uk|united kingdom|london|britain|england)$/, 'United Kingdom'], [/europe|^eu$|emea/, 'Europe'], [/africa/, 'Africa'], [/latin america|latam/, 'Latin America'],
  [/^asia$|^apac$|asia pacific|asia-pacific/, 'Asia Pacific'],
];
const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail|gmx|qq|163)\./i;
function normType(v) { const t = _n(v); if (!t) return null; for (const [re, c] of TYPE_RULES) if (re.test(t)) return c; return _fixCase(v); }
function normSectors(v) {
  const out = [];
  String(v || '').split(/[;,|\n\/]+| and /i).map(x => x.trim()).filter(Boolean).forEach(x => {
    const t = _n(x); const hit = SECTOR_RULES.find(([re]) => re.test(t));
    const c = hit ? hit[1] : _fixCase(x); if (c && !out.includes(c)) out.push(c);
  });
  return out.length > 1 ? out.filter(c => c !== 'Generalist') : out;
}
function normStages(v) {
  const t = _n(v); if (!t) return [];
  if (/agnostic|all stages|any stage|^all$|^any$/.test(t)) return [];
  const out = [];
  String(v).split(/[;,|\n\/]+| to | - | and /i).forEach(part => {
    const p = _n(part); STAGE_RULES.forEach(([re, cs]) => { if (re.test(p)) cs.forEach(c => { if (!out.includes(c)) out.push(c); }); });
  });
  const order = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth', 'Pre-IPO', 'Buyout', 'Debt'];
  return out.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
function normGeo(v) {
  const out = [];
  String(v || '').split(/[;,|\n\/]+| and /i).map(x => x.trim()).filter(Boolean).forEach(x => {
    const t = _n(x); const hit = GEO_RULES.find(([re]) => re.test(t));
    const c = hit ? hit[1] : _fixCase(x); if (c && !out.includes(c)) out.push(c);
  });
  return out.join(', ') || null;
}
function normUrl(v, linkedin) {
  let u = String(v || '').trim(); if (!u || /^n\/?a$|^-$/i.test(u)) return null;
  u = u.replace(/^<|>$/g, '').split(/\s+/)[0];
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  u = u.replace(/^http:\/\//i, 'https://');
  if (linkedin) u = u.replace(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com/i, 'https://www.linkedin.com');
  return u.replace(/\/+$/, '');
}
function normEmail(v) { const m = String(v || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); return m ? m[0].toLowerCase() : null; }
function normPhone(v) { const t = String(v || '').trim(); if (!t || !/\d{6,}/.test(t.replace(/[\s().-]/g, ''))) return null; return t.replace(/\s+/g, ' '); }
function orgFromEmail(email) {
  if (!email || FREE_MAIL.test(email)) return null;
  const d = email.split('@')[1].split('.'); const stem = d.length > 2 && d[d.length - 2].length <= 3 ? d[d.length - 3] : d[d.length - 2];
  return stem ? _title(stem.replace(/[-_]/g, ' ')) : null;
}
function fmtTicket(a, b) {
  const f = n => n == null ? '' : n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;
  return a != null && b != null && a !== b ? `${f(a)} – ${f(b)}` : (f(a) || f(b) || null);
}
// Arrange one investor record into the directory's standard shape
function arrangeInvestor(o) {
  const r = Object.assign({}, o), changed = [];
  const set = (k, v) => { const before = JSON.stringify(r[k] == null ? null : r[k]); r[k] = v; if (JSON.stringify(v == null ? null : v) !== before) changed.push(k); };
  if (r.first_name || r.last_name) { if (!r.full_name) set('full_name', [r.first_name, r.last_name].filter(Boolean).join(' ')); delete r.first_name; delete r.last_name; }
  if (r.full_name) set('full_name', _fixCase(r.full_name));
  if (r.organization) set('organization', String(r.organization).trim().replace(/\s+/g, ' '));
  if (r.email != null) set('email', normEmail(r.email));
  if (!r.organization && r.email) { const o2 = orgFromEmail(r.email); if (o2) set('organization', o2); }
  if (r.phone != null) set('phone', normPhone(r.phone));
  if (r.investor_type != null) set('investor_type', normType(r.investor_type));
  if (!r.investor_type) { const g = normType(`${r.organization || ''} ${r.notes || ''}`); if (g && TYPE_RULES.some(([, c]) => c === g)) set('investor_type', g); }
  if (r.focus_sectors != null) set('focus_sectors', normSectors(arr(r.focus_sectors).join(';')));
  if (r.preferred_stages != null) set('preferred_stages', normStages(arr(r.preferred_stages).join(';')));
  if (r.geography != null) set('geography', normGeo(r.geography));
  if (r.website != null) set('website', normUrl(r.website));
  if (r.linkedin_url != null) set('linkedin_url', normUrl(r.linkedin_url, true));
  if (r.website && /linkedin\.com/i.test(r.website) && !r.linkedin_url) { set('linkedin_url', normUrl(r.website, true)); set('website', null); }
  let mn = r.check_min != null && r.check_min !== '' ? parseMoney(r.check_min) : null, mx = r.check_max != null && r.check_max !== '' ? parseMoney(r.check_max) : null;
  if ((mn == null || mx == null) && r.check_size) { const [a, b] = parseRange(r.check_size); if (mn == null) mn = a; if (mx == null) mx = b; }
  if (mn != null && mx != null && mn > mx) [mn, mx] = [mx, mn];
  if (mn != null || r.check_min != null) set('check_min', mn); if (mx != null || r.check_max != null) set('check_max', mx);
  if (mn != null || mx != null) set('check_size', fmtTicket(mn, mx));
  return { row: r, changed };
}
function arrangeCompany(o) {
  const r = Object.assign({}, o);
  if (r.company_name) r.company_name = String(r.company_name).trim().replace(/\s+/g, ' ');
  if (r.contact_name) r.contact_name = _fixCase(r.contact_name);
  if (r.email != null) r.email = normEmail(r.email);
  if (r.industry != null) r.industry = normSectors(arr(r.industry).join(';'));
  if (r.stage) r.stage = normStages(r.stage)[0] || _fixCase(r.stage);
  if (r.website != null) r.website = normUrl(r.website);
  if (r.linkedin_url != null) r.linkedin_url = normUrl(r.linkedin_url, true);
  return { row: r, changed: [] };
}

// Column detection ------------------------------------------------------
function matchHeader(h, type) {
  const n = _n(h); if (!n) return null;
  const syn = HEADER_SYNONYMS[type];
  let best = null, bestScore = 0;
  Object.keys(syn).forEach(f => {
    [f.replace(/_/g, ' ')].concat(syn[f]).forEach(c => {
      const cn = _n(c); let sc = 0;
      if (n === cn) sc = 100;
      else if (n.replace(/ /g, '') === cn.replace(/ /g, '')) sc = 95;
      else if (cn.length > 3 && (` ${n} `).includes(` ${cn} `)) sc = 60 + cn.length;
      if (sc > bestScore) { bestScore = sc; best = f; }
    });
  });
  return bestScore >= 60 ? best : null;
}
function sniffColumn(values) {
  const v = values.map(x => String(x || '').trim()).filter(Boolean).slice(0, 40); if (v.length < 2) return null;
  const share = re => v.filter(x => re.test(x)).length / v.length;
  if (share(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) > 0.6) return 'email';
  if (share(/linkedin\.com/i) > 0.6) return 'linkedin_url';
  if (share(/^(https?:\/\/|www\.)|\.(com|io|co|vc|net|org|sg|ai|capital|fund|ventures)(\/|$)/i) > 0.6) return 'website';
  if (share(/^\+?[\d\s().-]{7,}$/) > 0.7) return 'phone';
  if (share(/\$|usd|sgd|\d+(\.\d+)?\s*(k|m|mn|b|bn)\b/i) > 0.6) return 'check_size';
  if (share(/series|seed|growth|pre-?ipo|buyout/i) > 0.6) return 'preferred_stages';
  return null;
}
async function handleImportFile(file) {
  if (!file) return;
  imp.type = $('imp-type').value; imp.file = file.name;
  $('imp-preview').innerHTML = '<div style="color:var(--white-muted)">Reading and arranging…</div>';
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    // pick the sheet + header row with the most recognisable column names
    let best = null;
    wb.SheetNames.forEach(sn => {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false, blankrows: true });
      for (let i = 0; i < Math.min(15, grid.length); i++) {
        const score = grid[i].filter(h => matchHeader(h, imp.type)).length;
        if (score >= 1 && (!best || score > best.score)) best = { sn, grid, i, score };
      }
    });
    if (!best) { const sn = wb.SheetNames[0]; const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false, blankrows: true }); best = { sn, grid, i: 0, score: 0 }; }
    const headerRow = best.grid[best.i].map((h, k) => String(h || '').trim() || `Column ${k + 1}`);
    const seen = {}; imp.headers = headerRow.map(h => { seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? `${h} (${seen[h]})` : h; });
    imp.raw = best.grid.slice(best.i + 1).filter(r => r.some(c => String(c).trim()))
      .map(r => Object.fromEntries(imp.headers.map((h, k) => [h, r[k] == null ? '' : r[k]])));
    imp.sheet = best.sn; imp.headerAt = best.i + 1;
    if (!imp.raw.length) throw new Error('No data rows found under the header row');
    imp.map = {};
    imp.headers.forEach(h => { const f = matchHeader(h, imp.type); if (f && !Object.values(imp.map).includes(f)) imp.map[h] = f; });
    imp.headers.filter(h => !imp.map[h]).forEach(h => { const f = sniffColumn(imp.raw.map(r => r[h])); if (f && HEADER_SYNONYMS[imp.type][f] && !Object.values(imp.map).includes(f)) imp.map[h] = f; });
    imp.sniffed = true;
    buildImportRows();
  } catch (e) { $('imp-preview').innerHTML = `<div style="color:#b3261e">Could not read file: ${esc(e.message || e)}</div>`; }
}
function buildImportRows() {
  const isInv = imp.type === 'investor', stats = { cleaned: 0, merged: 0, extra: 0, types: {} };
  const unmapped = imp.headers.filter(h => !imp.map[h]);
  let rows = (imp.raw || []).map(r => {
    const o = {};
    Object.keys(imp.map).forEach(h => {
      const f = imp.map[h], v = String(r[h] == null ? '' : r[h]).trim(); if (!v || /^(n\/?a|none|-|—)$/i.test(v)) return;
      o[f] = ['focus_sectors', 'preferred_stages', 'industry'].includes(f) ? arr(v) : v;
    });
    // keep every other column instead of dropping it
    const extras = unmapped.map(h => { const v = String(r[h] == null ? '' : r[h]).trim(); return v && !/^(n\/?a|-)$/i.test(v) ? `${h}: ${v}` : null; }).filter(Boolean);
    if (extras.length) { o.notes = [o.notes, ...extras].filter(Boolean).join('\n'); stats.extra++; }
    const { row, changed } = isInv ? arrangeInvestor(o) : arrangeCompany(o);
    if (changed.length) stats.cleaned++;
    row.source = 'import:' + String(imp.file || '').slice(0, 60);
    return row;
  }).filter(o => isInv ? (o.full_name || o.organization || o.email) : (o.company_name || o.email));
  // merge duplicates inside the file (same email, or same name + organisation)
  const byKey = new Map(), out = [];
  rows.forEach(o => {
    const key = o.email || _n(isInv ? `${o.full_name}|${o.organization}` : o.company_name);
    const ex = key && byKey.get(key);
    if (!ex) { byKey.set(key, o); out.push(o); return; }
    stats.merged++;
    Object.keys(o).forEach(k => {
      if (Array.isArray(o[k])) ex[k] = [...new Set(arr(ex[k]).concat(o[k]))];
      else if (k === 'notes' && o.notes && ex.notes !== o.notes) ex.notes = [ex.notes, o.notes].filter(Boolean).join('\n');
      else if (ex[k] == null || ex[k] === '') ex[k] = o[k];
    });
  });
  // arrange: by type, then organisation, then name
  const typeOrder = INVESTOR_TYPES;
  if (isInv) out.sort((a, b) => (typeOrder.indexOf(a.investor_type || 'Other') + 100 * !a.investor_type) - (typeOrder.indexOf(b.investor_type || 'Other') + 100 * !b.investor_type)
    || String(a.organization || '').localeCompare(String(b.organization || '')) || String(a.full_name || '').localeCompare(String(b.full_name || '')));
  out.forEach(o => { const t = o.investor_type || 'Unclassified'; stats.types[t] = (stats.types[t] || 0) + 1; });
  imp.rows = out; imp.stats = stats;
  renderImportPreview();
}
function renderImportPreview() {
  const fields = Object.keys(HEADER_SYNONYMS[imp.type]).filter(f => !['first_name', 'last_name'].includes(f) || imp.type === 'investor');
  const st = imp.stats || { types: {} };
  const mapRows = imp.headers.map((h, idx) => `<tr><td style="font-size:12px">${esc(h)}</td><td><select class="f-input f-select" style="padding:4px 8px;font-size:12px" onchange="remapImport(${idx},this.value)">
      <option value="">→ keep in notes</option>${fields.map(f => `<option value="${f}" ${imp.map[h] === f ? 'selected' : ''}>${f.replace(/_/g, ' ')}</option>`).join('')}</select></td></tr>`).join('');
  const cols = imp.type === 'investor' ? ['full_name', 'organization', 'investor_type', 'focus_sectors', 'preferred_stages', 'geography', 'check_size', 'email', 'phone', 'linkedin_url', 'website', 'notes']
    : ['company_name', 'contact_name', 'email', 'industry', 'stage', 'website'];
  const typeChips = Object.entries(st.types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="badge badge-blue" style="margin:2px">${esc(t)} · ${n}</span>`).join('');
  $('imp-preview').innerHTML = `
    <div style="background:rgba(10,92,64,.06);border:1px solid rgba(10,92,64,.18);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13px">
      <b>${imp.rows.length}</b> ${imp.type === 'investor' ? 'investors' : 'companies'} ready · sheet “${esc(imp.sheet || '')}”, header on row ${imp.headerAt || 1}
      · <b>${Object.keys(imp.map).length}</b> of ${imp.headers.length} columns matched${st.merged ? ` · <b>${st.merged}</b> duplicates merged` : ''}${st.cleaned ? ` · <b>${st.cleaned}</b> rows tidied` : ''}${st.extra ? ` · extra columns kept in notes` : ''}
      ${typeChips ? `<div style="margin-top:8px">${typeChips}</div>` : ''}
      <div style="font-size:11px;color:var(--white-muted);margin-top:6px">Types, sectors, stages and regions are standardised; names, emails, links and ticket sizes are cleaned; rows are arranged by type → organisation.</div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(220px,280px) minmax(0,1fr);gap:16px">
      <div><div class="f-label">Columns detected (change if needed)</div><div style="max-height:360px;overflow:auto"><table class="data-table">${mapRows}</table></div></div>
      <div style="overflow:auto;max-height:400px"><div class="f-label">Preview (arranged)</div>
        <table class="data-table"><thead><tr>${cols.map(c => `<th>${c.replace(/_/g, ' ')}</th>`).join('')}</tr></thead><tbody>
        ${imp.rows.slice(0, 12).map(r => `<tr>${cols.map(c => `<td style="font-size:12px;${['email', 'phone', 'check_size'].includes(c) ? 'white-space:nowrap' : ''}${c === 'notes' ? 'min-width:200px;white-space:pre-line' : ''}">${Array.isArray(r[c]) ? chips(r[c], 3) : esc(r[c] == null ? '' : c === 'notes' && String(r[c]).length > 140 ? String(r[c]).slice(0, 140) + '…' : r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </div>`;
  $('imp-go').disabled = !imp.rows.length;
}
function remapImport(idx, field) {
  const header = imp.headers[idx];
  Object.keys(imp.map).forEach(h => { if (imp.map[h] === field) delete imp.map[h]; });
  if (field) imp.map[header] = field; else delete imp.map[header];
  buildImportRows();
}
async function runImport() {
  const btn = $('imp-go'); btn.disabled = true;
  let ins = 0, upd = 0; const errs = [];
  for (let i = 0; i < imp.rows.length; i += 300) {
    btn.textContent = `Importing ${Math.min(i + 300, imp.rows.length)}/${imp.rows.length}…`;
    const r = await api('/api/admin/network/import', 'POST', { type: imp.type, rows: imp.rows.slice(i, i + 300) }).catch(e => ({ errors: [e.message] }));
    ins += r.imported || 0; upd += r.updated || 0; (r.errors || []).forEach(e => errs.push(e));
  }
  btn.textContent = 'Import';
  $('imp-result').innerHTML = `<b>${ins}</b> added · <b>${upd}</b> updated${errs.length ? ` · <span style="color:#b3261e">${esc(errs[0])}</span>` : ''}`;
  toast(`Import complete: ${ins} added, ${upd} updated`, errs.length ? 'warn' : 'success');
  logActivity('admin.network_import', 'admin', `${imp.type}: +${ins} / ~${upd} from ${imp.file}`);
  if (imp.type === 'investor') { inv.sort = 'type'; if ($('inv-sort')) $('inv-sort').value = 'type'; loadInvestors(); } else loadBusinesses();
}

// Directory: arranged view (grouped by type) + one-click tidy of existing data
function invGroup(i) { return i.investor_type ? (normType(i.investor_type) || i.investor_type) : 'Unclassified'; }
function invSorted(rows) {
  const s = inv.sort || 'type', by = (k) => (a, b) => String(a[k] || '~').localeCompare(String(b[k] || '~'));
  const t = i => { const k = INVESTOR_TYPES.indexOf(invGroup(i)); return k < 0 ? 99 : k; };
  const list = rows.slice();
  if (s === 'type') list.sort((a, b) => t(a) - t(b) || by('organization')(a, b) || by('full_name')(a, b));
  else if (s === 'org') list.sort((a, b) => by('organization')(a, b) || by('full_name')(a, b));
  else if (s === 'name') list.sort(by('full_name'));
  else if (s === 'ticket') list.sort((a, b) => (b.check_max || b.check_min || 0) - (a.check_max || a.check_min || 0));
  else list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return list;
}
function renderInvestors() {
  const rows = invSorted(invFiltered()), start = inv.page * inv.per, page = rows.slice(start, start + inv.per);
  $('inv-count').textContent = `${rows.length} investor${rows.length === 1 ? '' : 's'}${rows.length !== inv.all.length ? ` (of ${inv.all.length})` : ''}`;
  const grouped = (inv.sort || 'type') === 'type';
  let lastType = null;
  const rowHtml = i => {
    const head = grouped && invGroup(i) !== lastType
      ? `<tr><td colspan="9" style="background:var(--surface);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--emerald);padding:8px 12px">${esc((lastType = invGroup(i)))} · ${rows.filter(x => invGroup(x) === lastType).length}</td></tr>` : '';
    return head + `<tr>
      <td><div style="font-weight:600;color:var(--ink)">${esc(i.full_name || '—')}</div><div style="font-size:12px;color:var(--white-muted)">${esc(i.organization || '')}</div></td>
      <td style="font-size:12px">${esc(i.investor_type || '—')}</td>
      <td>${chips(i.focus_sectors)}</td>
      <td>${chips(i.preferred_stages, 2)}</td>
      <td style="font-size:12px">${esc(i.geography || '—')}</td>
      <td style="font-size:12px;white-space:nowrap">${esc(i.check_size || fmtTicket(i.check_min, i.check_max) || '—')}</td>
      <td style="font-size:12px;line-height:1.5">${i.email ? `<div style="white-space:nowrap"><a href="mailto:${esc(i.email)}" style="color:var(--emerald)">${esc(i.email)}</a></div>` : ''}
        ${i.phone ? `<div style="white-space:nowrap"><a href="tel:${esc(String(i.phone).replace(/[^\d+]/g, ''))}" style="color:var(--ink)">${esc(i.phone)}</a>${/^\+?\d/.test(i.phone) ? ` <a href="https://wa.me/${esc(String(i.phone).replace(/\D/g, ''))}" target="_blank" rel="noopener noreferrer" style="color:var(--emerald);font-size:11px">WhatsApp</a>` : ''}</div>` : ''}
        <div>${i.linkedin_url ? `<a href="${esc(i.linkedin_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--emerald)" title="LinkedIn"><span class="material-symbols-outlined" style="font-size:16px">link</span></a>` : ''}
        ${i.website ? `<a href="${esc(i.website)}" target="_blank" rel="noopener noreferrer" style="color:var(--emerald)" title="Website"><span class="material-symbols-outlined" style="font-size:16px">language</span></a>` : ''}${!i.email && !i.phone && !i.linkedin_url && !i.website ? '—' : ''}</div>
        ${i.notes ? `<div style="font-size:11px;color:var(--white-muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(i.notes)}">${esc(String(i.notes).split('\n')[0])}</div>` : ''}</td>

      <td><span class="pill pill-${i.status === 'approved' ? 'live' : i.status === 'pending' ? 'pending' : 'draft'}">${esc(i.status || 'directory')}</span></td>
      <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="openInvestorModal('${esc(i.id)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteInvestor('${esc(i.id)}')">✕</button></td></tr>`;
  };
  $('investors-table').innerHTML = rows.length ? `<div style="overflow-x:auto"><table class="data-table"><thead><tr>
      <th>Investor</th><th>Type</th><th>Sectors</th><th>Stages</th><th>Geography</th><th>Ticket</th><th>Contact</th><th>Status</th><th></th></tr></thead><tbody>
    ${page.map(rowHtml).join('')}</tbody></table></div>
    ${rows.length > inv.per ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;font-size:12px;color:var(--white-muted)">
      <span>Showing ${start + 1}–${Math.min(start + inv.per, rows.length)}</span>
      <span><button class="btn btn-ghost btn-sm" ${inv.page ? '' : 'disabled'} onclick="inv.page--;renderInvestors()">Prev</button>
      <button class="btn btn-ghost btn-sm" ${start + inv.per < rows.length ? '' : 'disabled'} onclick="inv.page++;renderInvestors()">Next</button></span></div>` : ''}`
    : emptyRow(inv.all.length ? 'No investors match these filters.' : `No investors yet. <span style="color:var(--emerald);cursor:pointer" onclick="openImportModal('investor')">Import a CSV / Excel sheet</span> or <span style="color:var(--emerald);cursor:pointer" onclick="openInvestorModal()">add one</span>.`);
}
async function tidyInvestors() {
  const todo = inv.all.map(i => { const { row, changed } = arrangeInvestor(i); return changed.length ? [i.id, Object.fromEntries(changed.map(k => [k, row[k]]))] : null; }).filter(Boolean);
  if (!todo.length) { toast('Directory is already tidy', 'success'); return; }
  if (!confirm(`Standardise ${todo.length} investor record${todo.length > 1 ? 's' : ''} (types, sectors, stages, regions, links, ticket sizes)?`)) return;
  let done = 0, fail = 0;
  for (let k = 0; k < todo.length; k += 5) {
    await Promise.all(todo.slice(k, k + 5).map(([id, patch]) => api(`/api/admin/investors/${id}`, 'PATCH', patch).then(r => { if (r && !r.error) done++; else fail++; }).catch(() => fail++)));
    $('inv-count').textContent = `Tidying… ${done + fail}/${todo.length}`;
  }
  toast(`Tidied ${done} records${fail ? ` · ${fail} failed` : ''}`, fail ? 'warn' : 'success');
  logActivity('admin.investors_tidy', 'admin', `${done} records standardised`);
  loadInvestors();
}
