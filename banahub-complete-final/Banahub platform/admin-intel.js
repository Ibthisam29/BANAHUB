/* BANAHUB Admin OS — Investor intelligence (no AI, no API costs)
 *  • Smart paste: paste a list, email signature block, LinkedIn post or copied table → arranged investor rows (import preview)
 *  • Review queue: pasted rows and Ben's research land as review_status 'ben_review' (inactive) until approved
 *  • Data-gap filter + "Match to company": score every investor against a company, raise or custom criteria
 *  • Investor documents: decks, mandates, portfolio sheets, LP letters, screenshots (private bucket, in-browser viewer)
 * Depends on admin-v3.js globals: inv, imp, renderInvestors, loadInvestors, buildImportRows, matchHeader, scoreInvestor, arr, api, toast.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t) => (window.toast ? window.toast(m, t || 'success') : alert(m));
  const sb = () => (window.__OS || {}).sb;
  async function q(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
  const log = (a, d) => { try { if (typeof logActivity === 'function') logActivity(a, 'admin', d); } catch (e) { } };
  const fmtSize = n => n == null ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  /* ───────────── Smart paste → rows ───────────── */
  const RE_EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
  const RE_LI = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company|pub)\/[^\s,;)<>"']+/ig;
  const RE_URL = /\b(?:https?:\/\/|www\.)[^\s,;)<>"']+/ig;
  const RE_PHONE = /(?:\+|00)\d[\d\s().-]{6,18}\d|\b\d{3,4}[\s-]\d{3,4}[\s-]\d{3,4}\b/g;
  const ORG_WORDS = /\b(capital|ventures?|partners|fund|funds|family office|holdings?|investments?|invest|group|management|advisors?|advisory|asset|assets|equity|lp|llp|ltd|limited|pte|inc|llc|gmbh|ag|bank|securities|wealth|trust|foundation|endowment|office|vc|angels?|syndicate|accelerator|labs?|corp|corporation|company|co\.)\b/i;
  const TITLE_WORDS = /\b(founder|co-founder|partner|managing|director|principal|associate|ceo|cio|cfo|coo|head|vp|vice president|investment manager|analyst|chairman|chair|president|md|gp|lp|advisor|investor|owner)\b/i;
  const GENERIC = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail|qq|163|126)\./i;
  const isName = l => /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3}$/.test(l) && !ORG_WORDS.test(l) && !TITLE_WORDS.test(l);
  const clean = l => l.replace(/^[\s•*\-–—>#\d.)]+/, '').replace(/\s{2,}/g, ' ').trim();

  function parseBlock(text) {
    const r = { name: '', org: '', email: '', phone: '', li: '', web: '', notes: [] };
    let t = String(text);
    r.li = ((t.match(RE_LI) || [])[0] || '').replace(/[.]+$/, ''); t = t.replace(RE_LI, ' ');
    const emails = [...new Set(t.match(RE_EMAIL) || [])]; r.email = emails[0] || ''; t = t.replace(RE_EMAIL, ' ');
    const urls = (t.match(RE_URL) || []).map(u => u.replace(/[.]+$/, '')); r.web = urls[0] || ''; t = t.replace(RE_URL, ' ');
    const phones = (t.match(RE_PHONE) || []).filter(p => p.replace(/\D/g, '').length >= 8); r.phone = (phones[0] || '').trim(); phones.forEach(p => { t = t.replace(p, ' '); });
    if (emails.length > 1) r.notes.push('Other emails: ' + emails.slice(1).join(', '));
    let lines = t.split(/\n|\s\|\s|\s·\s/).map(clean).filter(l => l && !/^(email|e-mail|tel|phone|mobile|linkedin|web|website|m|t|e|w)\s*:?\s*$/i.test(l));
    lines = lines.map(l => l.replace(/^(name|contact|firm|fund|organisation|organization|company|title|role)\s*:\s*/i, m => { r['_' + m.toLowerCase().replace(/[^a-z]/g, '')] = 1; return m; }));
    // labelled fields first ("Firm: X", "Name: Y")
    lines = lines.filter(l => {
      const m = l.match(/^(name|contact)\s*:\s*(.+)$/i); if (m && !r.name) { r.name = m[2].trim(); return false; }
      const o = l.match(/^(firm|fund|organisation|organization|company)\s*:\s*(.+)$/i); if (o && !r.org) { r.org = o[2].trim(); return false; }
      return true;
    });
    lines = lines.filter(l => {
      // "Jane Tan, Partner at Acme Ventures" / "Jane Tan — Acme Ventures"
      let m = l.match(/^(.+?)\s*(?:,|–|—|-)\s*(.+?)\s+(?:at|@)\s+(.+)$/i);
      if (m && !r.name && isName(m[1].trim())) { r.name = m[1].trim(); r.org = r.org || m[3].trim(); r.notes.push('Title: ' + m[2].trim()); return false; }
      m = l.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
      if (m && TITLE_WORDS.test(m[1]) && !r.org) { r.org = m[2].trim(); r.notes.push('Title: ' + m[1].trim()); return false; }
      if (m && !r.name && isName(m[1].trim())) { r.name = m[1].trim(); r.org = r.org || m[2].trim(); return false; }
      m = l.match(/^(.+?)\s+(?:–|—|-|,)\s+(.+)$/);
      if (m && !r.name && isName(m[1].trim()) && !r.org && ORG_WORDS.test(m[2])) { r.name = m[1].trim(); r.org = m[2].trim(); return false; }
      return true;
    });
    lines.forEach(l => {
      if (!r.name && isName(l)) r.name = l;
      else if (!r.org && ORG_WORDS.test(l) && l.length <= 80) r.org = l;
      else if (TITLE_WORDS.test(l) && l.length <= 80 && !r.notes.some(n => n.startsWith('Title:'))) r.notes.push('Title: ' + l);
      else r.notes.push(l);
    });
    if (!r.org && r.email && !GENERIC.test(r.email.split('@')[1])) {
      const dom = r.email.split('@')[1]; r.web = r.web || 'https://' + dom;
      r.org = dom.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      r.notes.push('Firm name guessed from email domain — verify');
    }
    const tidy = v => String(v || '').replace(/^[\s,;:|•·—–-]+|[\s,;:|•·—–-]+$/g, '').trim();
    r.name = tidy(r.name); r.org = tidy(r.org); r.notes = r.notes.map(tidy).filter(Boolean);
    if (r.web && !/^https?:\/\//i.test(r.web)) r.web = 'https://' + r.web;
    if (r.li && !/^https?:\/\//i.test(r.li)) r.li = 'https://' + r.li;
    return { Name: r.name, Organisation: r.org, Email: r.email, Phone: r.phone, LinkedIn: r.li, Website: r.web, Notes: r.notes.join('\n').slice(0, 1500) };
  }
  function splitBlocks(text) {
    const t = String(text).replace(/\r/g, '').trim();
    let blocks = t.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
    // one record per line when lines each carry their own contact detail, or for simple name/firm lists
    if (blocks.length === 1) {
      const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
      const hasE = l => new RegExp(RE_EMAIL.source, 'i').test(l) || new RegExp(RE_LI.source, 'i').test(l);
      const perLine = lines.filter(l => hasE(l) || /\s(?:at|@|–|—|-|,)\s/.test(l));
      if (lines.length > 1 && perLine.length >= Math.ceil(lines.length * 0.6)) blocks = lines;
      else if (lines.length > 2 && lines.every(l => l.length < 90 && !/[.:]\s/.test(l))) blocks = lines;
    }
    return blocks;
  }
  function pasteToTable(text) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
    const tabbed = lines.filter(l => l.includes('\t')).length;
    if (lines.length >= 2 && tabbed >= Math.ceil(lines.length * 0.7)) {
      const grid = lines.map(l => l.split('\t').map(c => c.trim()));
      const hdr = grid[0].filter(h => typeof matchHeader === 'function' && matchHeader(h, 'investor')).length >= 2;
      const width = Math.max(...grid.map(r => r.length));
      const headers = hdr ? grid[0].map((h, k) => h || `Column ${k + 1}`) : Array.from({ length: width }, (_, k) => `Column ${k + 1}`);
      const rows = (hdr ? grid.slice(1) : grid).map(r => Object.fromEntries(headers.map((h, k) => [h, r[k] || ''])));
      return { headers, rows, mode: 'table' };
    }
    const rows = splitBlocks(text).map(parseBlock).filter(r => r.Name || r.Organisation || r.Email || r.LinkedIn);
    return { headers: ['Name', 'Organisation', 'Email', 'Phone', 'LinkedIn', 'Website', 'Notes'], rows, mode: 'text' };
  }
  function arrangePaste() {
    const text = ($('imp-paste').value || '').trim();
    if (text.length < 3) return notify('Paste a list, post, email signature or copied table first', 'warn');
    const { headers, rows, mode } = pasteToTable(text);
    if (!rows.length) { $('imp-preview').innerHTML = '<div style="color:#b3261e">No names, firms, emails or LinkedIn links found in the pasted text.</div>'; return; }
    imp.type = 'investor'; if ($('imp-type')) $('imp-type').value = 'investor';
    imp.file = 'pasted text ' + new Date().toISOString().slice(0, 10); imp.pasted = true; imp.sheet = mode === 'table' ? 'Pasted table' : 'Pasted text'; imp.headerAt = 1;
    imp.headers = headers; imp.raw = rows; imp.map = {};
    headers.forEach(h => { const f = matchHeader(h, 'investor'); if (f && !Object.values(imp.map).includes(f)) imp.map[h] = f; });
    if (typeof sniffColumn === 'function') headers.filter(h => !imp.map[h]).forEach(h => { const f = sniffColumn(rows.map(r => r[h])); if (f && !Object.values(imp.map).includes(f)) imp.map[h] = f; });
    if ($('imp-review')) $('imp-review').checked = true;
    buildImportRows();
  }

  /* ───────────── Review queue ───────────── */
  async function setReview(ids, approve) {
    if (!ids.length) return;
    const patch = approve ? { review_status: 'approved', active: true, verified_at: new Date().toISOString() } : { review_status: 'rejected', active: false };
    try {
      for (let k = 0; k < ids.length; k += 100) await q(sb().from('investors').update(patch).in('id', ids.slice(k, k + 100)));
      inv.all.forEach(i => { if (ids.includes(i.id)) Object.assign(i, patch); });
      notify(`${ids.length} investor${ids.length > 1 ? 's' : ''} ${approve ? 'approved — now used for matching' : 'rejected'}`);
      log(approve ? 'admin.investor_review_approve' : 'admin.investor_review_reject', `${ids.length} record(s)`);
      refreshBar(); renderInvestors();
    } catch (e) { notify('Could not update: ' + e.message, 'error'); }
  }
  function reviewVisible(approve) {
    const ids = invFiltered().filter(i => i.review_status === 'ben_review').map(i => i.id);
    if (!ids.length) return notify('No records waiting for review in this view', 'warn');
    if (!confirm(`${approve ? 'Approve' : 'Reject'} all ${ids.length} records in this view?`)) return;
    setReview(ids, approve);
  }
  function showQueue() { $('inv-status').value = '__review'; inv.page = 0; refreshBar(); renderInvestors(); }

  /* ───────────── Match to company ───────────── */
  const M = { companies: [], raises: [] };
  async function openMatch() {
    $('modal-intel-match').style.display = 'flex';
    try {
      const [c, r] = await Promise.all([q(sb().from('companies').select('id,company_name,industry,industries,stage,description').order('company_name').limit(1000)), q(sb().from('deal_rooms').select('*').order('created_at', { ascending: false }).limit(300))]);
      M.companies = c || []; M.raises = r || [];
      $('mi-from').innerHTML = '<option value="">Custom criteria</option>' +
        (M.raises.length ? '<optgroup label="Capital raises">' + M.raises.map(x => `<option value="r:${x.id}">${esc(x.name || x.company_name || 'Raise')}${x.stage ? ' · ' + esc(x.stage) : ''}</option>`).join('') + '</optgroup>' : '') +
        (M.companies.length ? '<optgroup label="Companies">' + M.companies.map(x => `<option value="c:${x.id}">${esc(x.company_name)}${x.stage ? ' · ' + esc(x.stage) : ''}</option>`).join('') + '</optgroup>' : '');
    } catch (e) { notify('Could not load companies: ' + e.message, 'warn'); }
  }
  function fillFrom(v) {
    const [k, id] = String(v).split(':');
    const x = k === 'r' ? M.raises.find(r => r.id === id) : k === 'c' ? M.companies.find(c => c.id === id) : null;
    if (!x) return;
    $('mi-sector').value = arr(x.sectors).concat(arr(x.industries), arr(x.industry)).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    $('mi-stage').value = x.stage || '';
    $('mi-geo').value = x.geography || 'Singapore, Southeast Asia';
    $('mi-raise').value = x.target_raise || '';
    $('mi-min').value = x.min_ticket || '';
    $('mi-label').value = x.name || x.company_name || '';
  }
  function applyMatch() {
    const r = { sectors: arr($('mi-sector').value), industry: [], stage: $('mi-stage').value.trim(), geography: $('mi-geo').value.trim(),
      target_raise: parseMoney($('mi-raise').value), min_ticket: parseMoney($('mi-min').value), investment_type: $('mi-inst').value };
    if (!r.sectors.length && !r.stage && !r.geography) return notify('Add at least a sector, stage or geography', 'warn');
    inv.all.forEach(i => { i._fit = scoreInvestor(i, r); });
    inv.fit = { label: $('mi-label').value.trim() || 'custom criteria', r };
    inv.sort = 'fit'; if ($('inv-sort')) { if (![...$('inv-sort').options].some(o => o.value === 'fit')) $('inv-sort').insertAdjacentHTML('beforeend', '<option value="fit">Best fit</option>'); $('inv-sort').value = 'fit'; }
    if ($('inv-status').value === '') { /* keep review records visible but they sort by score too */ }
    inv.page = 0; closeModal('modal-intel-match'); refreshBar(); renderInvestors();
    const strong = inv.all.filter(i => i.review_status !== 'rejected' && (i._fit || {}).score >= 70).length;
    notify(`Scored ${inv.all.length} investors · ${strong} strong fits (70+)`);
  }
  function clearMatch() { inv.fit = null; inv.all.forEach(i => { delete i._fit; }); inv.sort = 'type'; if ($('inv-sort')) $('inv-sort').value = 'type'; refreshBar(); renderInvestors(); }
  function exportFit() {
    const rows = invSorted(invFiltered()).filter(i => i._fit);
    if (typeof downloadFile !== 'function' || typeof toCSV !== 'function') return;
    downloadFile(`banahub-fit-${(inv.fit.label || 'match').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(rows.map(i => Object.assign({}, i, { fit_score: i._fit.score, fit_reasons: i._fit.reasons.join('; '), review: i.review_status || '' })),
        ['fit_score', 'fit_reasons', 'organization', 'full_name', 'investor_type', 'focus_sectors', 'preferred_stages', 'geography', 'check_size', 'email', 'linkedin_url', 'website', 'review']));
  }

  /* ───────────── Documents ───────────── */
  const D = { inv: null, list: [] };
  const KINDS = [['auto', 'Detect from file'], ['deck', 'Fund deck'], ['mandate', 'Mandate / thesis'], ['portfolio', 'Portfolio list'], ['lp_letter', 'LP letter / report'], ['research', 'Research / notes'], ['screenshot', 'Screenshot / post'], ['other', 'Other']];
  async function openDocs(id) {
    D.inv = inv.all.find(i => i.id === id) || { id };
    $('idoc-title').textContent = D.inv.organization || D.inv.full_name || 'Investor';
    $('idoc-sub').textContent = [D.inv.full_name && D.inv.organization ? D.inv.full_name : '', D.inv.investor_type].filter(Boolean).join(' · ') || 'Documents';
    $('modal-intel-docs').style.display = 'flex';
    await loadDocs();
  }
  async function loadDocs() {
    $('idoc-list').innerHTML = '<div style="padding:16px;color:var(--white-muted)">Loading…</div>';
    try { D.list = await q(sb().from('investor_documents').select('*').eq('investor_id', D.inv.id).order('created_at', { ascending: false })); }
    catch (e) { $('idoc-list').innerHTML = `<div style="padding:16px;color:#b3261e">${esc(e.message)}${/does not exist|schema cache/i.test(e.message) ? ' — apply SQL migration 32' : ''}</div>`; return; }
    D.inv._docs = D.list.length;
    $('idoc-list').innerHTML = D.list.length ? `<table class="data-table"><thead><tr><th>Document</th><th>Type</th><th>Added</th><th></th></tr></thead><tbody>${D.list.map(d => `<tr>
        <td><b>${esc(d.name)}</b><div style="font-size:11px;color:var(--white-muted)">${esc(fmtSize(d.size))}${d.note ? ' · ' + esc(d.note) : ''}</div></td>
        <td style="font-size:12px">${esc((KINDS.find(k => k[0] === d.kind) || [0, d.kind])[1])}</td><td style="font-size:12px;white-space:nowrap">${fmtD(d.created_at)}</td>
        <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="INTEL.view('${d.id}')">View</button><button class="btn btn-ghost btn-sm" onclick="INTEL.download('${d.id}')">Download</button><button class="btn btn-danger btn-sm" onclick="INTEL.delDoc('${d.id}')">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<div style="padding:18px;color:var(--white-muted);font-size:13px">No documents yet. Add fund decks, mandates, portfolio sheets, LP letters, screenshots of posts or research notes.</div>';
    renderInvestors();
  }
  async function uploadDocs(files) {
    files = [...(files || [])]; if (!files.length) return;
    const kind = $('idoc-kind').value, note = $('idoc-note').value.trim().slice(0, 300);
    const ok = /\.(pdf|docx?|xlsx?|csv|pptx?|key|txt|md|png|jpe?g|webp|gif|heic)$/i;
    let n = 0;
    for (const f of files) {
      if (!ok.test(f.name)) { notify(`${f.name}: file type not supported`, 'warn'); continue; }
      if (f.size > 50 * 1048576) { notify(`${f.name} is over 50 MB`, 'warn'); continue; }
      const path = `${D.inv.id}/${Date.now().toString(36)}-${f.name.replace(/[^\w.\-]+/g, '_').slice(-120)}`;
      try {
        $('idoc-status').textContent = `Uploading ${f.name}…`;
        await q(sb().storage.from('investor-docs').upload(path, f, { contentType: f.type || undefined, upsert: false }));
        await q(sb().from('investor_documents').insert({ investor_id: D.inv.id, name: f.name.slice(0, 200), path, mime: f.type || null, size: f.size, kind: kind !== 'auto' ? kind : /^image\/|\.(png|jpe?g|webp|gif|heic)$/i.test(f.type + ' ' + f.name) ? 'screenshot' : /\.(pdf|pptx?|key)$/i.test(f.name) ? 'deck' : /\.(xlsx?|csv)$/i.test(f.name) ? 'portfolio' : 'other', note: note || null, uploaded_by: (window.__OS || {}).uid || null }));
        n++;
      } catch (e) { notify(`${f.name}: ${e.message}`, 'error'); }
    }
    $('idoc-status').textContent = ''; $('idoc-file').value = ''; $('idoc-note').value = '';
    if (n) { notify(`${n} document${n > 1 ? 's' : ''} added`); log('admin.investor_docs_upload', `${n} file(s) → ${D.inv.organization || D.inv.id}`); }
    loadDocs();
  }
  async function signed(id, download) {
    const d = D.list.find(x => x.id === id); if (!d) return null;
    const r = await sb().storage.from('investor-docs').createSignedUrl(d.path, 300, download ? { download: d.name } : undefined);
    if (r.error) { notify(r.error.message, 'error'); return null; }
    return { d, url: r.data.signedUrl };
  }
  async function view(id) {
    const s = await signed(id); if (!s) return;
    if (window.BanaViewer) window.BanaViewer.open({ url: s.url, name: s.d.name, mime: s.d.mime, canDownload: true, onDownload: () => download(id) });
    else window.open(s.url, '_blank', 'noopener');
  }
  async function download(id) { const s = await signed(id, true); if (s) window.open(s.url, '_blank', 'noopener'); }
  async function delDoc(id) {
    const d = D.list.find(x => x.id === id); if (!d || !confirm(`Delete ${d.name}?`)) return;
    try { await q(sb().storage.from('investor-docs').remove([d.path])); await q(sb().from('investor_documents').delete().eq('id', id)); notify('Document deleted'); loadDocs(); }
    catch (e) { notify(e.message, 'error'); }
  }

  /* ───────────── UI injection ───────────── */
  function refreshBar() {
    const n = (inv.all || []).filter(i => i.review_status === 'ben_review').length;
    const b = $('intel-queue-btn'); if (b) { b.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px">fact_check</span>Review queue${n ? ` <span class="badge badge-gold" style="margin-left:4px">${n}</span>` : ''}`; }
    const bar = $('intel-bar'); if (!bar) return;
    const inQueue = $('inv-status').value === '__review';
    bar.innerHTML = [
      inQueue ? `<div class="intel-note"><b>Review queue</b> — records from Ben's research and pasted lists. They are not used for matching or emails until approved. Check the source links, fix anything wrong with Edit, then approve.
        <span style="display:inline-flex;gap:6px;margin-left:8px"><button class="btn btn-primary btn-sm" onclick="INTEL.reviewVisible(true)">Approve all in view</button><button class="btn btn-ghost btn-sm" onclick="INTEL.reviewVisible(false)">Reject all in view</button></span></div>` : '',
      inv.fit ? `<div class="intel-note"><b>Fit scores for ${esc(inv.fit.label)}</b> — sector 40 · stage 25 · geography 20 · ticket 15. Unknown fields get partial credit.
        <span style="display:inline-flex;gap:6px;margin-left:8px"><button class="btn btn-ghost btn-sm" onclick="INTEL.exportFit()">Export shortlist</button><button class="btn btn-ghost btn-sm" onclick="INTEL.openMatch()">Change criteria</button><button class="btn btn-ghost btn-sm" onclick="INTEL.clearMatch()">Clear</button></span></div>` : ''].join('');
  }
  function inject() {
    const P = $('panel-investors'); if (!P || $('intel-queue-btn')) return;
    if (!$('intel-css')) document.head.insertAdjacentHTML('beforeend', `<style id="intel-css">
      .intel-note{background:rgba(10,92,64,.06);border:1px solid rgba(10,92,64,.18);border-radius:10px;padding:10px 14px;font-size:12.5px;margin:0 0 10px;line-height:1.6}
      #imp-paste{min-height:110px;font-family:inherit}.intel-paste{border:1px dashed var(--border);border-radius:10px;padding:12px}
      .intel-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.intel-grid{grid-template-columns:1fr}}</style>`);
    const btns = P.querySelector('.page-header > div:last-child');
    btns.insertAdjacentHTML('afterbegin', `<button class="btn btn-ghost" id="intel-queue-btn" onclick="INTEL.queue()"></button>
      <button class="btn btn-ghost" onclick="INTEL.openMatch()" title="Score every investor against a company, raise or criteria"><span class="material-symbols-outlined" style="font-size:15px">join_inner</span>Match to company</button>
      <button class="btn btn-ghost" onclick="INTEL.paste()" title="Paste a list, post, email signature or copied table"><span class="material-symbols-outlined" style="font-size:15px">content_paste</span>Paste list</button>`);
    const st = $('inv-status');
    st.insertAdjacentHTML('beforeend', '<option value="__review">Review queue</option><option value="__rejected">Rejected</option>');
    st.addEventListener('change', refreshBar);
    st.insertAdjacentHTML('afterend', `<select id="inv-gap" class="f-input f-select" style="width:170px" onchange="inv.page=0;renderInvestors()" title="Find records with missing data">
      <option value="">All data</option><option value="contact">Missing all contact</option><option value="email">Missing email</option><option value="linkedin">Missing LinkedIn</option><option value="stage">Missing stage</option><option value="ticket">Missing ticket size</option><option value="sector">Missing sector</option><option value="geo">Missing geography</option><option value="type">Type to confirm</option></select>`);
    $('inv-facets').insertAdjacentHTML('beforebegin', '<div id="intel-bar"></div>');

    // paste area inside the import modal
    const prev = $('imp-preview');
    prev.insertAdjacentHTML('beforebegin', `<div class="intel-paste" id="intel-paste-box">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><label class="f-label" style="margin:0">Or paste text — a list, LinkedIn post, email signatures or rows copied from Excel / Google Sheets</label>
        <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="imp-review"/> Send to review queue</label></div>
      <textarea id="imp-paste" class="f-input" style="margin-top:8px" placeholder="Jane Tan, Partner at Acme Ventures — jane@acmevc.com&#10;https://www.linkedin.com/in/…&#10;&#10;Or paste rows copied from a spreadsheet (with the header row)"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary btn-sm" onclick="INTEL.arrange()">Arrange pasted text</button><span class="geo-note" style="font-size:12px;color:var(--white-muted);align-self:center">Names, firms, emails, phones, LinkedIn and websites are picked out automatically; everything else is kept in notes.</span></div></div>`);
    $('imp-file').addEventListener('change', () => { imp.pasted = false; if ($('imp-review')) $('imp-review').checked = false; });

    document.body.insertAdjacentHTML('beforeend', `
    <div id="modal-intel-match" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('modal-intel-match')"><div class="modal">
      <div class="modal-header"><div><div class="modal-title">Match investors to a company</div><div class="modal-sub">Scores every investor in the directory — no AI, instant</div></div><button class="modal-close" onclick="closeModal('modal-intel-match')">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div class="f-group"><label class="f-label">Start from</label><select id="mi-from" class="f-input f-select" onchange="INTEL.fillFrom(this.value)"><option value="">Custom criteria</option></select></div>
        <div class="f-group"><label class="f-label">Label</label><input id="mi-label" class="f-input" placeholder="e.g. Acme Series A"/></div>
        <div class="f-group"><label class="f-label">Sectors / industries (comma separated)</label><input id="mi-sector" class="f-input" placeholder="Fintech, Payments, Financial Services"/></div>
        <div class="intel-grid"><div class="f-group"><label class="f-label">Stage</label><select id="mi-stage" class="f-input f-select"><option value="">Any</option>${['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth', 'Pre-IPO', 'Buyout', 'Debt'].map(s => `<option>${s}</option>`).join('')}</select></div>
          <div class="f-group"><label class="f-label">Instrument</label><select id="mi-inst" class="f-input f-select"><option value="">Equity</option><option value="debt">Debt / credit</option></select></div></div>
        <div class="f-group"><label class="f-label">Geography (company HQ + target markets)</label><input id="mi-geo" class="f-input" placeholder="Singapore, Indonesia, Southeast Asia"/></div>
        <div class="intel-grid"><div class="f-group"><label class="f-label">Raise size</label><input id="mi-raise" class="f-input" placeholder="5000000 or 5M"/></div><div class="f-group"><label class="f-label">Minimum ticket</label><input id="mi-min" class="f-input" placeholder="250k"/></div></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('modal-intel-match')">Cancel</button><button class="btn btn-primary" onclick="INTEL.applyMatch()">Score investors</button></div></div></div>
    <div id="modal-intel-docs" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal('modal-intel-docs')"><div class="modal modal-lg" style="max-width:820px">
      <div class="modal-header"><div><div class="modal-title" id="idoc-title">Documents</div><div class="modal-sub" id="idoc-sub"></div></div><button class="modal-close" onclick="closeModal('modal-intel-docs')">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div class="intel-grid"><div class="f-group"><label class="f-label">Type</label><select id="idoc-kind" class="f-input f-select">${KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="f-group"><label class="f-label">Note (optional)</label><input id="idoc-note" class="f-input" placeholder="e.g. Fund III deck, Q3 2026"/></div></div>
        <div class="f-group"><label class="f-label">Files — PDF, Word, Excel, CSV, PowerPoint, images (max 50 MB each)</label><input id="idoc-file" type="file" multiple class="f-input" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.key,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.heic" onchange="INTEL.upload(this.files)"/><div id="idoc-status" style="font-size:12px;color:var(--white-muted);margin-top:4px"></div></div>
        <div class="card" style="overflow:auto"><div id="idoc-list"></div></div>
        <div style="font-size:12px;color:var(--white-muted)">Private to admins. Files are stored in a private bucket and opened with short-lived links.</div>
      </div></div></div>`);
    refreshBar();
  }

  // doc counts + review badge whenever the directory loads
  const _load = window.loadInvestors;
  window.loadInvestors = async function () {
    inject();
    const r = await _load.apply(this, arguments);
    try {
      const docs = await q(sb().from('investor_documents').select('investor_id').limit(10000));
      const c = {}; (docs || []).forEach(d => { c[d.investor_id] = (c[d.investor_id] || 0) + 1; });
      inv.all.forEach(i => { i._docs = c[i.id] || 0; });
    } catch (e) { /* table not migrated yet */ }
    if (inv.fit) inv.all.forEach(i => { i._fit = scoreInvestor(i, inv.fit.r); });
    refreshBar(); renderInvestors();
    return r;
  };

  window.INTEL = {
    paste: () => { openImportModal('investor'); setTimeout(() => { $('imp-paste') && $('imp-paste').focus(); }, 50); },
    arrange: arrangePaste, parse: pasteToTable, approve: ids => setReview(ids, true), reject: ids => setReview(ids, false), reviewVisible, queue: showQueue,
    openMatch, fillFrom, applyMatch, clearMatch, exportFit, docs: openDocs, upload: uploadDocs, view, download, delDoc,
  };
  if (document.readyState !== 'loading') inject(); else document.addEventListener('DOMContentLoaded', inject);
})();
