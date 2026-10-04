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
const eventPageUrl = e => e.page_url || `/event?id=${encodeURIComponent(e.id)}`;

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
      <div onclick="openPreview('${esc(eventPageUrl(e))}','${esc(e.title).replace(/'/g, '&#39;')}')" title="Open event page"
        style="cursor:pointer;height:120px;background:${e.cover_image ? `url('${esc(e.cover_image)}') center/cover` : 'linear-gradient(135deg,var(--emerald-deep),var(--bg-2))'};position:relative;display:flex;align-items:center;justify-content:center">
        ${e.cover_image ? '' : `<span class="material-symbols-outlined" style="font-size:40px;color:#fff;opacity:.7">event</span>`}
        <div style="position:absolute;top:10px;right:10px;display:flex;gap:6px">
          ${e.invite_only ? '<span class="pill" style="background:rgba(197,160,40,.2);color:var(--gold)">Invite Only</span>' : ''}
          ${e.featured ? '<span class="pill" style="background:#fff;color:#1b1c1a">Featured</span>' : ''}
          <span class="pill pill-${e.published ? 'live' : 'draft'}">${e.published ? 'Live' : 'Draft'}</span>
        </div>
      </div>
      <div style="padding:16px">
        <div style="font-size:14px;font-weight:700;color:var(--ink);margin-bottom:4px;cursor:pointer" onclick="openPreview('${esc(eventPageUrl(e))}','${esc(e.title).replace(/'/g, '&#39;')}')">${esc(e.title)}</div>
        <div style="font-size:12px;color:var(--white-muted);margin-bottom:4px">${esc(e.type || '')} · ${esc(e.location || 'TBD')}</div>
        <div style="font-size:12px;color:var(--emerald)">${e.event_date ? fmtD(e.event_date) : 'Date TBD'}${e.price_amount > 0 ? ` · ${esc(e.currency || 'SGD')} ${Number(e.price_amount).toLocaleString()}` : ' · Free'}</div>
        <div style="font-size:11px;color:var(--white-muted);margin-top:4px;font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(eventPageUrl(e))}</div>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="openPreview('${esc(eventPageUrl(e))}','${esc(e.title).replace(/'/g, '&#39;')}')"><span class="material-symbols-outlined" style="font-size:14px">visibility</span>View page</button>
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
    (!q || [i.full_name, i.organization, i.email, i.notes, i.investor_type, i.geography].join(' ').toLowerCase().includes(q)) &&
    (!t || i.investor_type === t) &&
    (!sec || arr(i.focus_sectors).some(s => s.toLowerCase().includes(sec))) &&
    (!stg || arr(i.preferred_stages).some(s => s.toLowerCase().includes(stg))) &&
    (!geo || (i.geography || '').toLowerCase().includes(geo)) &&
    (!st || i.status === st));
}
function renderInvestors() {
  const rows = invFiltered(), start = inv.page * inv.per, page = rows.slice(start, start + inv.per);
  $('inv-count').textContent = `${rows.length} investor${rows.length === 1 ? '' : 's'}${rows.length !== inv.all.length ? ` (of ${inv.all.length})` : ''}`;
  $('investors-table').innerHTML = rows.length ? `<table class="data-table"><thead><tr>
      <th>Investor</th><th>Type</th><th>Sectors</th><th>Stages</th><th>Geography</th><th>Ticket</th><th>Contact</th><th>Status</th><th></th></tr></thead><tbody>
    ${page.map(i => `<tr>
      <td><div style="font-weight:600;color:var(--ink)">${esc(i.full_name || '—')}</div><div style="font-size:12px;color:var(--white-muted)">${esc(i.organization || '')}</div></td>
      <td style="font-size:12px">${esc(i.investor_type || '—')}</td>
      <td>${chips(i.focus_sectors)}</td>
      <td>${chips(i.preferred_stages, 2)}</td>
      <td style="font-size:12px">${esc(i.geography || '—')}</td>
      <td style="font-size:12px;white-space:nowrap">${esc(i.check_size || (i.check_min || i.check_max ? `${money(i.check_min, '$').replace('$ ', '$')}–${money(i.check_max, '$').replace('$ ', '$')}` : '—'))}</td>
      <td style="font-size:12px;white-space:nowrap">${i.email ? `<a href="mailto:${esc(i.email)}" style="color:var(--emerald)" title="${esc(i.email)}"><span class="material-symbols-outlined" style="font-size:16px">mail</span></a>` : ''}
        ${i.linkedin_url ? `<a href="${esc(i.linkedin_url)}" target="_blank" rel="noopener" style="color:var(--emerald)"><span class="material-symbols-outlined" style="font-size:16px">link</span></a>` : ''}
        ${i.website ? `<a href="${esc(i.website)}" target="_blank" rel="noopener" style="color:var(--emerald)"><span class="material-symbols-outlined" style="font-size:16px">language</span></a>` : ''}</td>
      <td><span class="pill pill-${i.status === 'approved' ? 'live' : i.status === 'pending' ? 'pending' : 'draft'}">${esc(i.status || 'directory')}</span></td>
      <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="openInvestorModal('${i.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteInvestor('${i.id}')">✕</button></td>
    </tr>`).join('')}</tbody></table>
    ${rows.length > inv.per ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;font-size:12px;color:var(--white-muted)">
      <span>Showing ${start + 1}–${Math.min(start + inv.per, rows.length)}</span>
      <span><button class="btn btn-ghost btn-sm" ${inv.page ? '' : 'disabled'} onclick="inv.page--;renderInvestors()">Prev</button>
      <button class="btn btn-ghost btn-sm" ${start + inv.per < rows.length ? '' : 'disabled'} onclick="inv.page++;renderInvestors()">Next</button></span></div>` : ''}`
    : emptyRow(inv.all.length ? 'No investors match these filters.' : `No investors yet. <span style="color:var(--emerald);cursor:pointer" onclick="openImportModal('investor')">Import a CSV / Excel sheet</span> or <span style="color:var(--emerald);cursor:pointer" onclick="openInvestorModal()">add one</span>.`);
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
  $('imp-preview').innerHTML = `<div style="color:var(--white-muted);font-size:13px">Choose a .csv, .xlsx or .xls file. The first row must be column headers — e.g. <code>name, organization, email, type, sectors, stages, geography, check size, linkedin</code>. Lists (sectors, stages) can be separated by commas or semicolons.</div>`;
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
async function handleImportFile(file) {
  if (!file) return;
  imp.type = $('imp-type').value; imp.file = file.name;
  $('imp-preview').innerHTML = '<div style="color:var(--white-muted)">Reading file…</div>';
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    if (!raw.length) throw new Error('No rows found in the first sheet');
    imp.raw = raw; imp.headers = Object.keys(raw[0]);
    const fields = IMPORT_FIELDS[imp.type], norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
    imp.map = {};
    imp.headers.forEach(h => {
      const n = norm(h);
      const f = Object.keys(fields).find(k => norm(k) === n || fields[k].some(c => norm(c) === n));
      if (f && !Object.values(imp.map).includes(f)) imp.map[h] = f;
    });
    buildImportRows();
  } catch (e) { $('imp-preview').innerHTML = `<div style="color:#b3261e">Could not read file: ${esc(e.message || e)}</div>`; }
}
function buildImportRows() {
  imp.rows = (imp.raw || []).map(r => {
    const o = {};
    Object.keys(imp.map).forEach(h => {
      const f = imp.map[h], v = String(r[h] == null ? '' : r[h]).trim(); if (!v) return;
      o[f] = ARRAY_FIELDS.includes(f) ? arr(v) : (f === 'check_min' || f === 'check_max') ? parseMoney(v) : v;
    });
    if (o.email) o.email = o.email.toLowerCase();
    if (imp.type === 'investor' && o.check_size && (o.check_min == null || o.check_max == null)) {
      const [a, b] = parseRange(o.check_size); if (o.check_min == null) o.check_min = a; if (o.check_max == null) o.check_max = b;
    }
    o.source = 'import:' + String(imp.file || '').slice(0, 60);
    return o;
  }).filter(o => imp.type === 'investor' ? (o.full_name || o.organization || o.email) : (o.company_name || o.email));
  renderImportPreview();
}
function renderImportPreview() {
  const fields = Object.keys(IMPORT_FIELDS[imp.type]);
  const mapRows = imp.headers.map((h, idx) => `<tr><td style="font-size:12px">${esc(h)}</td><td><select class="f-input f-select" style="padding:4px 8px;font-size:12px" onchange="remapImport(${idx},this.value)">
      <option value="">— skip —</option>${fields.map(f => `<option ${imp.map[h] === f ? 'selected' : ''}>${f}</option>`).join('')}</select></td></tr>`).join('');
  const cols = [...new Set(Object.values(imp.map))];
  $('imp-preview').innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(220px,280px) 1fr;gap:16px">
      <div><div class="f-label">Column mapping</div><table class="data-table">${mapRows}</table></div>
      <div style="overflow:auto"><div class="f-label">${imp.rows.length} rows ready · preview</div>
        <table class="data-table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>
        ${imp.rows.slice(0, 8).map(r => `<tr>${cols.map(c => `<td style="font-size:12px">${esc(Array.isArray(r[c]) ? r[c].join(', ') : r[c] == null ? '' : r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
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
  logActivity('admin.network_import', 'admin', `${imp.type}: +${ins} / ~${upd}`);
  if (imp.type === 'investor') loadInvestors(); else loadBusinesses();
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
      <td style="white-space:nowrap">${i.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(i.email)}?subject=${encodeURIComponent('Introduction: ' + raiseName(r))}">Email</a>` : ''}${i.linkedin_url ? ` <a class="btn btn-ghost btn-sm" href="${esc(i.linkedin_url)}" target="_blank" rel="noopener">LinkedIn</a>` : ''}</td>
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
