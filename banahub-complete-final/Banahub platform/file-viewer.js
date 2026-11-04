/* BANAHUB file viewer — in-browser preview for data room files (member dashboard + Admin OS).
 * BanaViewer.open({ url, name, mime, watermark, canDownload, onDownload })
 * PDF (pdf.js) · images · video / audio · text / CSV / JSON · Word .docx (mammoth) · Excel .xlsx/.xls/.csv (SheetJS).
 * PowerPoint / Keynote: download (or upload a PDF export for in-browser viewing).
 * Libraries load lazily from cdnjs. The watermark is a visual deterrent only.
 */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIBS = {
    pdf: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', () => window.pdfjsLib],
    mammoth: ['https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js', () => window.mammoth],
    xlsx: ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', () => window.XLSX],
  };
  const loading = {};
  function lib(k) {
    const [src, get] = LIBS[k]; if (get()) return Promise.resolve(get());
    return loading[k] || (loading[k] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(get()); s.onerror = () => rej(new Error('Viewer library failed to load')); document.head.appendChild(s); }));
  }
  const ext = n => (String(n || '').split('.').pop() || '').toLowerCase();
  function kind(name, mime) {
    const e = ext(name), m = String(mime || '');
    if (e === 'pdf' || m === 'application/pdf') return 'pdf';
    if (/^image\//.test(m) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return 'image';
    if (/^video\//.test(m) || ['mp4', 'webm', 'mov'].includes(e)) return 'video';
    if (/^audio\//.test(m) || ['mp3', 'wav', 'm4a', 'ogg'].includes(e)) return 'audio';
    if (e === 'docx') return 'docx';
    if (['xlsx', 'xls', 'csv'].includes(e)) return 'sheet';
    if (['txt', 'md', 'json'].includes(e) || /^text\//.test(m)) return 'text';
    if (['ppt', 'pptx', 'key', 'doc'].includes(e)) return 'office';
    return 'other';
  }
  const CSS = `
  #bv{position:fixed;inset:0;z-index:9500;background:rgba(10,18,14,.72);display:none;align-items:stretch;justify-content:center;padding:16px}
  #bv.open{display:flex}#bv .bv-box{background:#fff;border-radius:14px;width:min(1100px,100%);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.35)}
  #bv .bv-hd{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #e3e7e2;font:600 14px 'Inter',system-ui,sans-serif;color:#1b1c1a}
  #bv .bv-hd .bv-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #bv .bv-btn{border:1px solid #003527;background:#fff;color:#003527;border-radius:8px;padding:6px 12px;font:600 12.5px 'Inter',sans-serif;cursor:pointer;white-space:nowrap}
  #bv .bv-btn.p{background:#003527;color:#fff}#bv .bv-x{border:0;background:none;font-size:24px;line-height:1;cursor:pointer;color:#4a524d;padding:0 4px}
  #bv .bv-body{position:relative;flex:1;overflow:auto;background:#eef1ed;-webkit-overflow-scrolling:touch}
  #bv .bv-inner{padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;min-height:100%}
  #bv canvas,#bv img.bv-img{max-width:100%;height:auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12)}
  #bv video,#bv audio{max-width:100%;margin:auto}
  #bv .bv-doc{background:#fff;max-width:820px;width:100%;padding:36px 44px;box-shadow:0 2px 10px rgba(0,0,0,.1);font:15px/1.6 Georgia,serif;color:#1b1c1a;word-wrap:break-word}
  #bv .bv-doc img{max-width:100%}#bv pre.bv-doc{font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap}
  #bv .bv-tabs{display:flex;gap:6px;flex-wrap:wrap;align-self:stretch}#bv .bv-tabs button{border:1px solid #c9d1cb;background:#fff;border-radius:6px;padding:4px 10px;font:12px 'Inter',sans-serif;cursor:pointer}#bv .bv-tabs button.on{background:#003527;color:#fff;border-color:#003527}
  #bv table.bv-sheet{border-collapse:collapse;background:#fff;font:12.5px 'Inter',sans-serif;color:#1b1c1a;align-self:flex-start}
  #bv table.bv-sheet td,#bv table.bv-sheet th{border:1px solid #dfe4e0;padding:4px 8px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}#bv table.bv-sheet tr:first-child td{background:#f3f6f3;font-weight:600}
  #bv .bv-msg{margin:auto;text-align:center;font:14px 'Inter',sans-serif;color:#1b1c1a;max-width:420px;padding:30px}
  #bv .bv-wm{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
  #bv .bv-wm span{position:absolute;white-space:nowrap;transform:rotate(-28deg);font:600 15px 'Inter',sans-serif;color:rgba(0,53,39,.13);user-select:none}
  #bv .bv-pg{font:12px 'Inter',sans-serif;color:#4a524d}
  @media (max-width:700px){#bv{padding:0}#bv .bv-box{border-radius:0}#bv .bv-doc{padding:20px}#bv .bv-hd{flex-wrap:wrap}}
  @media print{#bv{display:none!important}}`;
  let el, cur;
  function mount() {
    if (el) return; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend', '<div id="bv" role="dialog" aria-modal="true" aria-label="File viewer"><div class="bv-box"><div class="bv-hd"><span class="material-symbols-outlined" aria-hidden="true">description</span><span class="bv-name" id="bv-name"></span><span class="bv-pg" id="bv-pg"></span><button class="bv-btn" id="bv-dl" type="button">Download</button><button class="bv-x" id="bv-x" type="button" aria-label="Close viewer">×</button></div><div class="bv-body" id="bv-body"><div class="bv-inner" id="bv-inner"></div></div></div></div>');
    el = document.getElementById('bv');
    document.getElementById('bv-x').onclick = close;
    el.addEventListener('click', e => { if (e.target === el) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('open')) close(); });
    el.addEventListener('contextmenu', e => { if (cur && cur.watermark) e.preventDefault(); });
  }
  function close() { if (!el) return; el.classList.remove('open'); document.getElementById('bv-inner').innerHTML = ''; const w = el.querySelector('.bv-wm'); if (w) w.remove(); cur = null; document.body.style.overflow = ''; }
  function watermark(text) {
    const body = document.getElementById('bv-body'), w = document.createElement('div'); w.className = 'bv-wm';
    let h = ''; for (let y = 0; y < 30; y++) for (let x = 0; x < 4; x++) h += `<span style="top:${y * 180 + 40}px;left:${x * 340 - 80 + (y % 2) * 170}px">${esc(text)}</span>`;
    w.innerHTML = h; body.appendChild(w);
    body.addEventListener('scroll', () => { w.style.top = body.scrollTop + 'px'; w.style.height = body.clientHeight + 'px'; }, { passive: true });
  }
  async function render(o) {
    const box = document.getElementById('bv-inner'), k = kind(o.name, o.mime), pg = document.getElementById('bv-pg'); pg.textContent = '';
    box.innerHTML = '<div class="bv-msg">Loading preview…</div>';
    if (k === 'image') { box.innerHTML = `<img class="bv-img" src="${esc(o.url)}" alt="${esc(o.name)}" draggable="false">`; return; }
    if (k === 'video') { box.innerHTML = `<video src="${esc(o.url)}" controls playsinline ${o.canDownload ? '' : 'controlsList="nodownload"'} style="max-height:75vh"></video>`; return; }
    if (k === 'audio') { box.innerHTML = `<audio src="${esc(o.url)}" controls ${o.canDownload ? '' : 'controlsList="nodownload"'}></audio>`; return; }
    if (k === 'office' || k === 'other') { box.innerHTML = `<div class="bv-msg"><b>No in-browser preview for .${esc(ext(o.name))} files.</b><br><br>${o.canDownload ? 'Use Download to open it.' : 'Ask the owner to upload a PDF version.'}<br><br><span style="color:#4a524d;font-size:12.5px">Tip: export slides to PDF for the best viewing experience.</span></div>`; return; }
    const res = await fetch(o.url); if (!res.ok) throw new Error('Could not load file (' + res.status + ')');
    if (k === 'text') { const t = await res.text(); box.innerHTML = `<pre class="bv-doc">${esc(t.slice(0, 500000))}</pre>`; return; }
    const buf = await res.arrayBuffer();
    if (k === 'pdf') {
      const pdfjs = await lib('pdf'); pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc = await pdfjs.getDocument({ data: buf }).promise; box.innerHTML = ''; pg.textContent = doc.numPages + ' page' + (doc.numPages > 1 ? 's' : '');
      const width = Math.min(1000, box.clientWidth - 32 || 800), dpr = Math.min(2, window.devicePixelRatio || 1);
      for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
        if (!cur || cur !== o) return;
        const page = await doc.getPage(i), v0 = page.getViewport({ scale: 1 }), scale = width / v0.width, v = page.getViewport({ scale: scale * dpr });
        const c = document.createElement('canvas'); c.width = v.width; c.height = v.height; c.style.width = (v.width / dpr) + 'px'; c.setAttribute('aria-label', 'Page ' + i); box.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      }
      return;
    }
    if (k === 'docx') { const m = await lib('mammoth'); const r = await m.convertToHtml({ arrayBuffer: buf }); const d = document.createElement('div'); d.className = 'bv-doc'; d.innerHTML = sanitize(r.value); box.innerHTML = ''; box.appendChild(d); return; }
    if (k === 'sheet') {
      const X = await lib('xlsx'); const wb = X.read(buf, { type: 'array' }); box.innerHTML = '';
      const tabs = document.createElement('div'); tabs.className = 'bv-tabs'; const holder = document.createElement('div'); holder.style.cssText = 'align-self:stretch;overflow:auto';
      const show = n => { tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.n === n)); const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false }).slice(0, 2000); holder.innerHTML = `<table class="bv-sheet">${rows.map(r => `<tr>${(r || []).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`; };
      wb.SheetNames.forEach(n => { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.dataset.n = n; b.onclick = () => show(n); tabs.appendChild(b); });
      if (wb.SheetNames.length > 1) box.appendChild(tabs); box.appendChild(holder); show(wb.SheetNames[0]); return;
    }
  }
  // docx HTML from mammoth: strip scripts / handlers / js: urls
  function sanitize(html) {
    const t = document.createElement('template'); t.innerHTML = html;
    t.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove());
    t.content.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name); }));
    return t.innerHTML;
  }
  async function open(o) {
    mount(); cur = o; el.classList.add('open'); document.body.style.overflow = 'hidden';
    document.getElementById('bv-name').textContent = o.name || 'File';
    const dl = document.getElementById('bv-dl'); dl.style.display = o.canDownload ? '' : 'none'; dl.onclick = () => o.onDownload ? o.onDownload() : window.open(o.url, '_blank', 'noopener');
    const old = el.querySelector('.bv-wm'); if (old) old.remove(); if (o.watermark) watermark(o.watermark);
    try { await render(o); } catch (e) { if (cur === o) document.getElementById('bv-inner').innerHTML = `<div class="bv-msg">Could not preview this file.<br><span style="color:#4a524d;font-size:12.5px">${esc(e.message)}</span></div>`; }
  }
  window.BanaViewer = { open, close, kind };
})();
