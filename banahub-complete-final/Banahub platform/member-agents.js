/* BANAHUB member dashboard — Agents: Pitch Practice (founders → investors, fund managers → LPs).
 * Voice: browser speech recognition + speech synthesis (VOICE engine is swappable for a premium voice later).
 * All limits / personas / AI calls are enforced by the `pitch-coach` edge function.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sbc = () => window.getBanaSupabaseClient();
  const A = { st: null, mode: null, persona: null, sid: null, busy: false, listening: false, voiceOn: true, history: [], me: null, raises: [], inv: null, useDeck: true, transcript: [], score: null };
  const LEVEL = { easy: ['Easy', '#0a5c40', '#e3f1e8'], medium: ['Medium', '#7a5000', '#fff4d6'], hard: ['Hard', '#8c1d18', '#fdecea'] };
  const AV = { friends: '🤝', angels: '😇', hnw: '💼', seed_vc: '🌱', series_a_vc: '📈', cvc: '🏢', family_office: '🏛️', institutional: '🏦' };

  async function call(action, body) {
    const sb = await sbc();
    const { data, error } = await sb.functions.invoke('pitch-coach', { body: Object.assign({ action }, body || {}) });
    if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch (e) { } throw new Error(m); }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  /* ---------- voice engine (browser) — swap for premium TTS/STT later ---------- */
  const VOICE = {
    sttSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    ttsSupported: 'speechSynthesis' in window,
    rec: null, final: '',
    listen(onInterim, onDone) {
      const R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return false;
      const r = new R(); r.lang = 'en-US'; r.continuous = true; r.interimResults = true; this.final = ''; this.rec = r;
      r.onresult = e => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) this.final += t + ' '; else interim += t; } onInterim((this.final + interim).trim()); };
      r.onerror = e => { if (e.error === 'not-allowed') alert('Microphone permission was blocked — allow it in your browser, or type your answers.'); };
      r.onend = () => { const t = this.final.trim(); this.rec = null; onDone(t); };
      try { r.start(); } catch (e) { return false; } return true;
    },
    stop() { if (this.rec) try { this.rec.stop(); } catch (e) { } },
    voice() { const v = speechSynthesis.getVoices(); return v.find(x => /en-(GB|US)/.test(x.lang) && /Google|Natural|Samantha|Daniel|Serena|Aria|Guy/i.test(x.name)) || v.find(x => /^en/.test(x.lang)) || null; },
    speak(text, onEnd) {
      if (!this.ttsSupported || !A.voiceOn) { onEnd && onEnd(); return; }
      speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); const v = this.voice(); if (v) u.voice = v; u.rate = 1.02; u.pitch = 1;
      u.onend = () => onEnd && onEnd(); u.onerror = () => onEnd && onEnd(); speechSynthesis.speak(u);
    },
    hush() { if (this.ttsSupported) speechSynthesis.cancel(); },
  };
  if (VOICE.ttsSupported) speechSynthesis.onvoiceschanged = () => { };

  function inject() {
    const prof = document.querySelector('.nav-item[onclick*="switchTab(\'profile\'"]'), top = $('top-profile');
    if (!prof || !top || !$('panel-profile') || $('panel-agents')) return !!$('panel-agents');
    prof.insertAdjacentHTML('beforebegin', `<button class="nav-item" onclick="switchTab('agents',this)"><span class="mat-ic material-symbols-outlined">mic</span>Agents</button>`);
    top.insertAdjacentHTML('beforebegin', `<button class="tab-btn" id="top-agents" onclick="switchTab('agents',null,'top-agents')">Agents</button>`);
    $('panel-profile').insertAdjacentHTML('beforebegin', '<div class="panel" id="panel-agents"><div id="ag-root"></div></div>');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const orig = window.switchTab;
    window.switchTab = function (id) { const r = orig.apply(this, arguments); if (id === 'agents') load(); else if (A.sid) { VOICE.stop(); VOICE.hush(); } return r; };
    if (/[?&]tab=agents/.test(location.search)) setTimeout(() => window.switchTab('agents', null, 'top-agents'), 300);
    return true;
  }

  async function load() {
    if (A.sid) return; const root = $('ag-root'); root.innerHTML = '<div class="ag-load">Loading…</div>';
    try {
      const sb = await sbc(); const { data: { user } } = await sb.auth.getUser(); if (!user) { root.innerHTML = '<div class="glass-card sect">Please sign in.</div>'; return; }
      const [st, me, raises, inv, hist] = await Promise.all([
        call('status'),
        sb.from('users').select('id,full_name,role,member_category,status').eq('id', user.id).maybeSingle().then(r => r.data),
        sb.from('deal_rooms').select('id,company_name,stage,deck_path,deck_name').eq('submitted_by', user.id).order('created_at', { ascending: false }).then(r => r.data || [], () => []),
        sb.from('investors').select('id,organization,deck_path,deck_name').eq('user_id', user.id).maybeSingle().then(r => r.data, () => null),
        sb.from('pitch_sessions').select('id,mode,persona,difficulty,status,score,summary,turns,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30).then(r => r.data || [], () => []),
      ]);
      Object.assign(A, { st, me: me || {}, raises, inv, history: hist });
      if (!A.mode) A.mode = inv || /investor|fund|office|LP|PE|VC/i.test((me || {}).member_category || '') || (me || {}).role === 'investor' ? 'lp' : 'founder';
      home();
    } catch (e) { root.innerHTML = `<div class="glass-card sect" style="color:#ba1a1a">${esc(e.message)}</div>`; }
  }

  const personas = () => (A.st && A.st.personas && A.st.personas[A.mode]) || [];
  const plabel = (mode, key) => (((A.st && A.st.personas && A.st.personas[mode]) || []).find(p => p.key === key) || {}).label || key;
  function home() {
    const st = A.st || {}, P = personas();
    if (!A.persona || !P.some(p => p.key === A.persona && !p.locked)) A.persona = (P.find(p => p.level === 'medium' && !p.locked) || P.find(p => !p.locked) || {}).key;
    const left = Math.max(0, (st.cap || 0) - (st.used || 0));
    const last = A.history.find(h => h.mode === A.mode && h.score && h.score.overall != null);
    const deck = A.mode === 'lp' ? A.inv && A.inv.deck_path && A.inv : A.raises.find(r => r.deck_path);
    const blocked = !st.approved ? 'Pitch Practice opens once BANAHUB approves your membership.' : !st.enabled ? 'Pitch Practice is paused — check back soon.' : !st.ai ? 'Pitch Practice is being switched on by BANAHUB — check back shortly.' : left <= 0 ? (st.paid ? `You've used all ${st.cap} sessions this month.` : `Free plan includes ${st.cap} session${st.cap === 1 ? '' : 's'} a month — upgrade your membership for ${'more'}.`) : '';
    $('ag-root').innerHTML = `
      <div class="ag-hero"><div><div class="ag-eye">Agents</div><h2>Practise with an AI investor before the real meeting</h2><p>Pitch out loud, get grilled like a real ${A.mode === 'lp' ? 'LP' : 'investor'} meeting, then receive a score and coaching. Private to you.</p></div>
        <div class="ag-plan"><b>${st.paid ? 'Member' : 'Free plan'}</b><span>${st.used || 0} / ${st.cap || 0} sessions this month</span>${st.paid ? '' : '<a href="#" onclick="switchTab(\'memberships\',null,\'top-memberships\');return false">Upgrade →</a>'}</div></div>
      <div class="glass-card ag-feat">
        <div class="ag-feat-hd"><span class="material-symbols-outlined">mic</span><h3>${A.mode === 'lp' ? 'Practice your LP pitch' : 'Practice your investor pitch'}</h3><span class="ag-new">New</span>
          <div class="ag-seg" role="tablist"><button type="button" class="${A.mode === 'founder' ? 'on' : ''}" onclick="agMode('founder')">Company → investors</button><button type="button" class="${A.mode === 'lp' ? 'on' : ''}" onclick="agMode('lp')">Fund → LPs</button></div></div>
        <p class="ag-d">${A.mode === 'lp' ? 'Rehearse your fund pitch with a realistic prospective LP, then get a score and coaching.' : 'Rehearse your raise with a realistic investor, then get a score and coaching.'}</p>
        <div class="ag-lab">Who do you want to pitch?</div>
        <div class="ag-personas">${P.map(p => `<label class="ag-p ${p.locked ? 'locked' : ''} ${A.persona === p.key ? 'on' : ''}"><input type="radio" name="ag-p" value="${p.key}" ${A.persona === p.key ? 'checked' : ''} ${p.locked ? 'disabled' : ''} onchange="agPersona('${p.key}')"/><span class="ag-av">${AV[p.key] || '🧑‍💼'}</span><span><b>${esc(p.label)}</b><i style="color:${LEVEL[p.level][1]};background:${LEVEL[p.level][2]}">${LEVEL[p.level][0]}</i>${p.locked ? '<em>🔒 Member</em>' : ''}</span></label>`).join('')}</div>
        <div class="ag-opts">
          <label>Style <select id="ag-diff" class="f-in"><option value="">Match the investor</option><option value="friendly">Friendly</option><option value="realistic">Realistic</option><option value="tough">Tough</option></select></label>
          ${A.mode === 'founder' && A.raises.length > 1 ? `<label>Raise <select id="ag-raise" class="f-in">${A.raises.map(r => `<option value="${r.id}">${esc(r.company_name)} · ${esc(r.stage || '')}</option>`).join('')}</select></label>` : ''}
          <label class="ag-chk"><input type="checkbox" id="ag-deck" ${deck ? 'checked' : 'disabled'}/> ${deck ? `Use my deck (${esc(deck.deck_name || 'uploaded')})` : 'No deck uploaded — <a href="#" onclick="switchTab(\'submit\',null,\'top-submit\');return false">add one</a>'}</label>
          <label class="ag-chk"><input type="checkbox" id="ag-voice" ${A.voiceOn ? 'checked' : ''} ${VOICE.ttsSupported ? '' : 'disabled'}/> Investor speaks out loud</label></div>
        ${blocked ? `<div class="ag-block">${esc(blocked)}</div>` : ''}
        <div class="ag-cta"><button type="button" class="btn-p ag-call" onclick="agStart()" ${blocked || !A.persona ? 'disabled' : ''}><span class="material-symbols-outlined">call</span> Call ${esc(plabel(A.mode, A.persona) || '')}</button>
          <span class="ag-sub">${last ? `Last time: <b>${last.score.overall}/10</b> with ${esc(plabel(last.mode, last.persona))} · <a href="#" onclick="agHistory();return false">See progress</a>` : VOICE.sttSupported ? 'Uses your microphone · works best in Chrome, Edge or Safari' : 'Voice input isn\'t supported in this browser — you can type your answers'}</span></div>
      </div>
      <div class="ag-sec">More agents</div>
      <div class="ag-grid">
        ${card('Practice your investor pitch', 'Rehearse your raise with VCs, angels, family offices and corporates.', 'Fundraising', "agMode('founder')")}
        ${card('Practice your LP pitch', 'Rehearse your fund pitch with HNWs, family offices and institutional LPs.', 'Fundraising', "agMode('lp')")}
        ${card('Data Room', 'Organise diligence files, share with approved investors, see who viewed what.', 'Deals', "switchTab('dataroom',null,'top-dataroom')")}
        ${card('My Capital Raise', 'Enter your raise or investor mandate — free.', 'Fundraising', "switchTab('submit',null,'top-submit')")}
        ${card('Deal memo writer', 'Draft an investment memo from your data room.', 'Coming soon', '')}
        ${card('LP / investor objection advisor', 'Get advice on how to respond to tough objections.', 'Coming soon', '')}
      </div>
      ${A.history.length ? `<div class="ag-sec">Recent sessions</div><div class="glass-card ag-hist">${histRows(A.history.slice(0, 6))}</div>` : ''}`;
  }
  const card = (t, d, tag, js) => `<button type="button" class="ag-card" ${js ? `onclick="${js};window.scrollTo({top:0,behavior:'smooth'})"` : 'disabled'}><b>${esc(t)}</b><span>${esc(d)}</span><i class="${tag === 'Coming soon' ? 'soon' : ''}">${esc(tag)}</i></button>`;
  const histRows = rows => rows.map(h => `<button type="button" class="ag-hrow" onclick="agView('${h.id}')"><span class="ag-av">${AV[h.persona] || '🧑‍💼'}</span><span class="ag-hm"><b>${esc(plabel(h.mode, h.persona))}</b><em>${h.mode === 'lp' ? 'LP pitch' : 'Investor pitch'} · ${new Date(h.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} · ${h.turns || 0} exchanges</em></span><span class="ag-hs ${h.score && h.score.overall >= 7 ? 'good' : h.score && h.score.overall >= 5 ? 'mid' : ''}">${h.score && h.score.overall != null ? h.score.overall + '/10' : h.status === 'active' ? 'Unfinished' : '—'}</span></button>`).join('');

  /* ---------- deck text (owner reads own deck from private bucket) ---------- */
  async function deckText() {
    const rec = A.mode === 'lp' ? A.inv : (($('ag-raise') && A.raises.find(r => r.id === $('ag-raise').value)) || A.raises.find(r => r.deck_path));
    if (!rec || !rec.deck_path || !/\.pdf$/i.test(rec.deck_path)) return '';
    try {
      const sb = await sbc(); const s = await sb.storage.from('decks').createSignedUrl(rec.deck_path, 120); if (s.error) return '';
      if (!window.pdfjsLib) await new Promise((res, rej) => { const x = document.createElement('script'); x.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; x.onload = res; x.onerror = rej; document.head.appendChild(x); });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc = await window.pdfjsLib.getDocument(s.data.signedUrl).promise; let out = '';
      for (let i = 1; i <= Math.min(doc.numPages, 30) && out.length < 15000; i++) { const c = await (await doc.getPage(i)).getTextContent(); out += `\n[Slide ${i}] ` + c.items.map(t => t.str).join(' '); }
      return out.slice(0, 15000);
    } catch (e) { return ''; }
  }

  /* ---------- live session ---------- */
  async function start() {
    if (A.busy) return; A.busy = true;
    const btn = document.querySelector('.ag-call'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined">hourglass_top</span> Connecting…'; }
    A.voiceOn = !!($('ag-voice') && $('ag-voice').checked);
    try {
      const deck = $('ag-deck') && $('ag-deck').checked ? await deckText() : '';
      const r = await call('start', { mode: A.mode, persona: A.persona, difficulty: ($('ag-diff') || {}).value || undefined, deal_room_id: ($('ag-raise') || {}).value || (A.raises[0] || {}).id, deck_text: deck });
      A.sid = r.session_id; A.transcript = [{ role: 'investor', text: r.reply }]; A.score = null;
      if (A.st) A.st.used = r.used;
      callView(r.persona); say(r.reply);
    } catch (e) { alert(e.message); home(); }
    finally { A.busy = false; }
  }
  function callView(label) {
    $('ag-root').innerHTML = `
      <div class="ag-call-wrap glass-card">
        <div class="ag-call-hd"><span class="ag-av big">${AV[A.persona] || '🧑‍💼'}</span><div><b>${esc(label || plabel(A.mode, A.persona))}</b><div class="ag-sub">${A.mode === 'lp' ? 'LP pitch' : 'Investor pitch'} · practice session</div></div>
          <span class="ag-state" id="ag-state">Connecting</span><button type="button" class="btn-o" onclick="agToggleVoice()" id="ag-vbtn" title="Investor voice">${A.voiceOn ? '🔊' : '🔇'}</button></div>
        <div class="ag-log" id="ag-log" aria-live="polite"></div>
        <div class="ag-interim" id="ag-interim"></div>
        <div class="ag-ctl">
          ${VOICE.sttSupported ? `<button type="button" class="ag-mic" id="ag-mic" onclick="agMic()" aria-label="Tap to talk"><span class="material-symbols-outlined">mic</span></button>` : ''}
          <form class="ag-type" onsubmit="event.preventDefault();agSend()"><textarea id="ag-in" class="f-in" rows="1" placeholder="${VOICE.sttSupported ? 'Tap the mic and speak — or type here' : 'Type your answer'}"></textarea><button class="btn-p" type="submit">Send</button></form>
        </div>
        <div class="ag-foot"><span class="ag-sub" id="ag-turns"></span><button type="button" class="btn-o ag-end" onclick="agEnd()">End & get my score</button></div>
      </div>`;
    $('ag-in').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agSend(); } });
    A.transcript.forEach(m => bubble(m));
  }
  function bubble(m) { const L = $('ag-log'); if (!L) return; L.insertAdjacentHTML('beforeend', `<div class="ag-b ${m.role === 'me' ? 'me' : 'inv'}">${esc(m.text)}</div>`); L.scrollTop = L.scrollHeight; }
  function state(s) { const e = $('ag-state'); if (e) { e.textContent = s; e.className = 'ag-state ' + s.toLowerCase().replace(/\W+/g, ''); } const mic = $('ag-mic'); if (mic) mic.classList.toggle('live', s === 'Listening'); }
  function say(text) { state('Speaking'); VOICE.speak(text, () => { if (A.sid && !A.listening) state('Your turn'); }); }
  function mic() {
    if (A.busy) return;
    if (A.listening) { VOICE.stop(); return; }
    VOICE.hush(); A.listening = true; state('Listening');
    const ok = VOICE.listen(t => { const i = $('ag-interim'); if (i) i.textContent = t; }, t => { A.listening = false; const i = $('ag-interim'); if (i) i.textContent = ''; if (t) send(t); else state('Your turn'); });
    if (!ok) { A.listening = false; state('Your turn'); }
  }
  async function send(text) {
    text = String(text != null ? text : ($('ag-in') || {}).value || '').trim(); if (!text || A.busy || !A.sid) return;
    if ($('ag-in')) $('ag-in').value = ''; VOICE.hush();
    const m = { role: 'me', text }; A.transcript.push(m); bubble(m); A.busy = true; state('Thinking');
    try {
      const r = await call('turn', { session_id: A.sid, text });
      const x = { role: 'investor', text: r.reply }; A.transcript.push(x); bubble(x); say(r.reply);
      const t = $('ag-turns'); if (t) t.textContent = `${r.turns} / ${r.max_turns} exchanges`;
      if (r.done) { const f = document.querySelector('.ag-end'); if (f) f.classList.add('pulse'); }
    } catch (e) { bubble({ role: 'investor', text: '⚠️ ' + e.message }); state('Your turn'); }
    finally { A.busy = false; }
  }
  async function end() {
    if (!A.sid || A.busy) return; VOICE.stop(); VOICE.hush(); A.busy = true; state('Scoring');
    const b = document.querySelector('.ag-end'); if (b) { b.disabled = true; b.textContent = 'Scoring your pitch…'; }
    try { const r = await call('end', { session_id: A.sid }); const sid = A.sid; A.sid = null; await reloadHistory(); scoreView(sid, r.score, A.transcript); }
    catch (e) { alert(e.message); if (b) { b.disabled = false; b.textContent = 'End & get my score'; } }
    finally { A.busy = false; }
  }
  async function reloadHistory() { try { const sb = await sbc(); A.history = (await sb.from('pitch_sessions').select('id,mode,persona,difficulty,status,score,summary,turns,created_at').eq('user_id', A.me.id).order('created_at', { ascending: false }).limit(30)).data || A.history; } catch (e) { } }

  function scoreView(id, s, transcript) {
    const h = A.history.find(x => x.id === id) || {};
    if (!s) { $('ag-root').innerHTML = `<div class="glass-card sect"><b>No pitch recorded in that session.</b><div class="ag-cta"><button class="btn-p" onclick="agHome()">Back to Agents</button></div></div>`; return; }
    const cats = Object.entries(s.categories || {});
    const li = a => (a || []).map(x => `<li>${esc(x)}</li>`).join('');
    $('ag-root').innerHTML = `
      <div class="glass-card ag-score">
        <div class="ag-score-hd"><div class="ag-ring" style="--v:${(Number(s.overall) || 0) * 10}"><b>${s.overall != null ? s.overall : '–'}</b><span>/10</span></div>
          <div><div class="ag-eye">${esc(plabel(h.mode || A.mode, h.persona || A.persona))} · ${h.mode === 'lp' || A.mode === 'lp' ? 'LP pitch' : 'Investor pitch'}</div><h2>${esc(s.verdict || 'Your scorecard')}</h2></div></div>
        ${cats.length ? `<div class="ag-cats">${cats.map(([k, v]) => `<div class="ag-cat"><span>${esc(k)}</span><div class="ag-bar"><i style="width:${(Number(v) || 0) * 10}%"></i></div><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
        <div class="ag-cols"><div><div class="ag-sec">What worked</div><ul>${li(s.strengths)}</ul></div><div><div class="ag-sec">Improve next time</div><ul>${li(s.improvements)}</ul></div></div>
        ${(s.questions_to_prepare || []).length ? `<div class="ag-sec">Questions to prepare</div><ul>${li(s.questions_to_prepare)}</ul>` : ''}
        ${s.better_answer && s.better_answer.question ? `<div class="ag-better"><div class="ag-sec">A stronger answer</div><b>Q: ${esc(s.better_answer.question)}</b><p>${esc(s.better_answer.suggested_answer || '')}</p></div>` : ''}
        ${transcript && transcript.length ? `<details class="ag-tr"><summary>Transcript (${transcript.length} turns)</summary>${transcript.map(m => `<div class="ag-b ${m.role === 'me' ? 'me' : 'inv'}">${esc(m.text)}</div>`).join('')}</details>` : ''}
        <div class="ag-cta"><button class="btn-p" onclick="agHome()">Practise again</button><button class="btn-o" onclick="agHistory()">See progress</button></div>
        <p class="ag-sub" style="margin-top:10px">Practice feedback from an AI coach — not investment advice and not a view from any real investor.</p></div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function view(id) {
    try { const sb = await sbc(); const { data } = await sb.from('pitch_sessions').select('*').eq('id', id).maybeSingle(); if (!data) return;
      if (data.status === 'active' && !data.score) { A.sid = data.id; A.mode = data.mode; A.persona = data.persona; A.transcript = (data.transcript || []).map(x => ({ role: x.role, text: x.text })); callView(); state('Your turn'); return; }
      A.mode = data.mode; A.persona = data.persona; scoreView(data.id, data.score, data.transcript || []);
    } catch (e) { alert(e.message); }
  }
  function history() {
    const rows = A.history.filter(h => h.score && h.score.overall != null).slice(0, 12).reverse();
    $('ag-root').innerHTML = `<div class="glass-card sect"><div class="ag-eye">Progress</div><h2 style="margin:4px 0 12px">Your pitch scores</h2>
      ${rows.length ? `<div class="ag-spark">${rows.map(h => `<div title="${esc(plabel(h.mode, h.persona))}"><i style="height:${h.score.overall * 10}%"></i><span>${h.score.overall}</span><em>${new Date(h.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</em></div>`).join('')}</div>` : '<p class="ag-sub">Finish a session to see your progress.</p>'}
      <div class="ag-hist" style="margin-top:14px">${histRows(A.history)}</div><div class="ag-cta"><button class="btn-p" onclick="agHome()">Back to Agents</button></div></div>`;
  }

  Object.assign(window, {
    agMode: m => { A.mode = m; A.persona = null; home(); }, agPersona: p => { A.persona = p; home(); }, agStart: start, agMic: mic, agSend: () => send(), agEnd: end,
    agHome: () => { A.sid = null; load(); }, agHistory: history, agView: view, agToggleVoice: () => { A.voiceOn = !A.voiceOn; if (!A.voiceOn) VOICE.hush(); const b = $('ag-vbtn'); if (b) b.textContent = A.voiceOn ? '🔊' : '🔇'; }, __AG: A, __VOICE: VOICE,
  });

  const CSS = `#panel-agents{max-width:1040px}.ag-load{padding:40px;text-align:center;color:#3a433e}
  .ag-hero{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:16px}.ag-hero h2{margin:4px 0 6px;font-size:24px;color:#0d1b14}.ag-hero p{margin:0;color:#3a433e;max-width:620px}
  .ag-eye{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#735c00}
  .ag-plan{display:flex;flex-direction:column;gap:2px;border:1px solid rgba(0,53,39,.15);border-radius:12px;padding:10px 14px;background:#fff;min-width:170px}.ag-plan b{color:#003527}.ag-plan span{font-size:12.5px;color:#3a433e}.ag-plan a{font-size:12.5px;color:#0a5c40;font-weight:600}
  .ag-feat{padding:20px!important;border:1.5px solid rgba(115,92,0,.35)!important}
  .ag-feat-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ag-feat-hd h3{margin:0;font-size:19px;color:#0d1b14}.ag-feat-hd .material-symbols-outlined{color:#003527}
  .ag-new{font-size:11px;font-weight:700;color:#735c00;background:#fff4d6;border-radius:999px;padding:2px 8px}
  .ag-seg{margin-left:auto;display:flex;border:1px solid rgba(0,53,39,.2);border-radius:10px;overflow:hidden}.ag-seg button{border:0;background:#fff;padding:7px 12px;font:600 12.5px inherit;color:#1b1c1a;cursor:pointer}.ag-seg button.on{background:#003527;color:#fff}
  .ag-d{color:#3a433e;margin:6px 0 14px}.ag-lab{font-weight:600;color:#0d1b14;margin-bottom:8px}
  .ag-personas{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
  .ag-p{display:flex;gap:10px;align-items:center;border:1.5px solid rgba(0,53,39,.14);border-radius:12px;padding:10px;cursor:pointer;background:#fff}.ag-p input{position:absolute;opacity:0;pointer-events:none}
  .ag-p.on{border-color:#003527;background:#f1f6f2;box-shadow:0 0 0 3px rgba(0,53,39,.08)}.ag-p.locked{opacity:.6;cursor:not-allowed}
  .ag-p b{display:block;font-size:13.5px;color:#0d1b14}.ag-p i{font-style:normal;font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px;margin-right:6px}.ag-p em{font-style:normal;font-size:11px;color:#3a433e}
  .ag-av{width:36px;height:36px;border-radius:50%;background:#eef3ef;display:grid;place-items:center;font-size:19px;flex:none}.ag-av.big{width:52px;height:52px;font-size:28px}
  .ag-opts{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;margin-top:14px;font-size:13px;color:#1b1c1a}.ag-opts label{display:flex;align-items:center;gap:6px}.ag-opts select{min-width:160px}
  .ag-chk input{width:16px;height:16px}.ag-block{margin-top:14px;padding:10px 12px;border-radius:10px;background:#fff4d6;color:#5c3d00;font-size:13.5px}
  .ag-cta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px}.ag-call{display:inline-flex;align-items:center;gap:6px;font-size:15px;padding:11px 20px}
  .ag-sub{font-size:12.5px;color:#3a433e}.ag-sub a{color:#0a5c40;font-weight:600}
  .ag-sec{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#3a433e;margin:22px 0 8px}
  .ag-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
  .ag-card{text-align:left;border:1px solid rgba(0,53,39,.12);background:#fff;border-radius:12px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:5px;font:inherit;color:#1b1c1a}.ag-card:hover:not(:disabled){border-color:#003527}
  .ag-card b{font-size:14.5px;color:#0d1b14}.ag-card span{font-size:13px;color:#3a433e}.ag-card i{font-style:normal;align-self:flex-start;font-size:11px;font-weight:600;color:#1d3d6b;background:#e6eef9;border-radius:6px;padding:2px 7px;margin-top:4px}.ag-card i.soon{color:#5a5a5a;background:#eee}.ag-card:disabled{cursor:default;opacity:.75}
  .ag-hist{padding:6px!important;display:flex;flex-direction:column}.ag-hrow{display:flex;align-items:center;gap:10px;border:0;background:none;padding:8px;border-radius:10px;cursor:pointer;text-align:left;font:inherit;color:#1b1c1a}.ag-hrow:hover{background:#f3f6f3}
  .ag-hm{flex:1;min-width:0}.ag-hm b{display:block;font-size:13.5px}.ag-hm em{font-style:normal;font-size:12px;color:#3a433e}.ag-hs{font-weight:700;color:#8c1d18}.ag-hs.mid{color:#7a5000}.ag-hs.good{color:#0a5c40}
  .ag-call-wrap{padding:0!important;display:flex;flex-direction:column;height:min(78vh,760px);overflow:hidden}
  .ag-call-hd{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(0,53,39,.1)}.ag-call-hd b{color:#0d1b14}
  .ag-state{margin-left:auto;font-size:12px;font-weight:700;border-radius:999px;padding:4px 10px;background:#eef0ec;color:#3a433e}.ag-state.listening{background:#fdecea;color:#a3261d}.ag-state.speaking{background:#e6eef9;color:#1d3d6b}.ag-state.yourturn{background:#e3f1e8;color:#0a5c40}.ag-state.thinking,.ag-state.scoring{background:#fff4d6;color:#7a5000}
  .ag-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#f8faf7}
  .ag-b{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.5;color:#1b1c1a;background:#fff;border:1px solid rgba(0,53,39,.08);align-self:flex-start;white-space:pre-wrap}.ag-b.me{align-self:flex-end;background:#003527;color:#fff;border-color:#003527}
  .ag-interim{min-height:20px;padding:0 16px;font-size:13px;color:#3a433e;font-style:italic}
  .ag-ctl{display:flex;gap:10px;align-items:center;padding:10px 16px}.ag-type{flex:1;display:flex;gap:8px}.ag-type textarea{flex:1;resize:none;max-height:120px}
  .ag-mic{width:56px;height:56px;border-radius:50%;border:0;background:#003527;color:#fff;cursor:pointer;display:grid;place-items:center;flex:none;box-shadow:0 6px 18px rgba(0,53,39,.3)}.ag-mic .material-symbols-outlined{font-size:28px}
  .ag-mic.live{background:#a3261d;animation:agp 1.2s infinite}@keyframes agp{0%{box-shadow:0 0 0 0 rgba(163,38,29,.45)}70%{box-shadow:0 0 0 14px rgba(163,38,29,0)}100%{box-shadow:0 0 0 0 rgba(163,38,29,0)}}
  .ag-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 16px 14px;border-top:1px solid rgba(0,53,39,.08)}.ag-end.pulse{border-color:#735c00;color:#735c00;animation:agp 1.6s infinite}
  .ag-score{padding:22px!important}.ag-score-hd{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.ag-score-hd h2{margin:4px 0 0;font-size:20px;color:#0d1b14;max-width:640px}
  .ag-ring{--v:0;width:96px;height:96px;border-radius:50%;background:conic-gradient(#003527 calc(var(--v)*1%),#e6ebe7 0);display:grid;place-items:center;position:relative;flex:none}.ag-ring::before{content:'';position:absolute;inset:9px;border-radius:50%;background:#fff}
  .ag-ring b,.ag-ring span{position:relative}.ag-ring b{font-size:30px;color:#003527;line-height:1}.ag-ring span{font-size:12px;color:#3a433e;margin-top:-14px}
  .ag-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px 22px;margin-top:18px}.ag-cat{display:grid;grid-template-columns:150px 1fr 24px;align-items:center;gap:8px;font-size:13px;color:#1b1c1a}
  .ag-bar{height:8px;border-radius:99px;background:#e6ebe7;overflow:hidden}.ag-bar i{display:block;height:100%;background:linear-gradient(90deg,#0a5c40,#003527);border-radius:99px}
  .ag-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}.ag-score ul{margin:0;padding-left:18px;color:#1b1c1a;font-size:14px;line-height:1.55}
  .ag-better{margin-top:16px;padding:14px;border-radius:12px;background:#f3f6f3;color:#1b1c1a}.ag-better p{margin:6px 0 0;font-size:14px}
  .ag-tr{margin-top:16px}.ag-tr summary{cursor:pointer;font-weight:600;color:#003527}.ag-tr .ag-b{margin:6px 0}
  .ag-spark{display:flex;align-items:flex-end;gap:10px;height:150px;padding:10px 0;overflow-x:auto}.ag-spark div{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:34px;font-size:11px;color:#3a433e}
  .ag-spark i{display:block;width:22px;background:#003527;border-radius:6px 6px 0 0}.ag-spark span{font-weight:700;color:#003527}.ag-spark em{font-style:normal}
  @media (max-width:900px){.ag-seg{margin-left:0;width:100%}.ag-seg button{flex:1}.ag-cols{grid-template-columns:1fr}.ag-cat{grid-template-columns:120px 1fr 24px}.ag-call-wrap{height:calc(100dvh - 150px)}.ag-b{max-width:92%}.ag-hero h2{font-size:20px}}`;

  let tries = 0; (function wait() { if (inject()) return; if (++tries < 60) setTimeout(wait, 250); })();
})();
