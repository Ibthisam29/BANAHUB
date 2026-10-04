// BANAHub — Supabase API Interceptor v2.2
// Intercepts ALL fetch('/api/*') calls and routes to Supabase.
// Fixes: error.detail format, all admin routes, role filters, KYC, content.

const CONFIG = {
  SUPABASE_URL: 'https://mfqdqisbryoepdpqebkb.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_GfOFDZkHqJKEuKTIS_iU_A_9ttmG7HS',
  VERSION: '3.2.0',
};
window.CONFIG = CONFIG;
const API_BASE = '';
window.API_BASE = '';

// ── Supabase SDK (lazy-loaded) ────────────────────────────────────────────────
let _sdkReady = null, _sb = null;
function _getSB() {
  if (_sb) return Promise.resolve(_sb);
  if (_sdkReady) return _sdkReady;
  _sdkReady = new Promise((res) => {
    const init = () => {
      _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, storageKey: 'bana_auth', autoRefreshToken: true },
      });
      res(_sb);
    };
    if (window.supabase && window.supabase.createClient) return init();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload = init;
    s.onerror = () => { console.error('[BANAHub] Supabase SDK failed to load'); res(null); };
    document.head.appendChild(s);
  });
  return _sdkReady;
}

// Direct client accessor — for auth flows the /api/* interceptor doesn't
// cover (password reset send + confirm). Same singleton as everything
// else uses; safe to expose since it's the anon-key client, not service_role.
window.getBanaSupabaseClient = _getSB;

// Safe accessor for the current session token — used when calling Edge
// Functions directly (bypassing the /api/* interceptor below), e.g.
// Luma sync and Stripe checkout. Never stored in localStorage ourselves;
// this just reads Supabase's own persisted session.
window.getBanaAccessToken = async function() {
  const sb = await _getSB();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token || null;
};

// ── Response shim ─────────────────────────────────────────────────────────────
function _resp(data, status) {
  status = status || 200;
  // Normalise: always include both 'error' and 'detail' so admin.html works
  if (data && data.error && !data.detail) data = Object.assign({}, data, { detail: data.error });
  return {
    ok: status >= 200 && status < 300,
    status: status,
    headers: { get: function() { return 'application/json'; } },
    json:    function() { return Promise.resolve(data); },
    text:    function() { return Promise.resolve(JSON.stringify(data)); },
    clone:   function() { return this; },
  };
}

function _body(opts) {
  if (!opts || !opts.body) return {};
  try { return typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body; } catch(e) { return {}; }
}

// ── Login attempt logging (best-effort client-reported IP; see
//    security_hardening.sql notes for a server-verified upgrade path) ───────
let _cachedIP = null;
async function _getClientIP() {
  if (_cachedIP) return _cachedIP;
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const j = await r.json();
    _cachedIP = j.ip;
  } catch(e) { _cachedIP = 'unknown'; }
  return _cachedIP;
}
async function _logLoginAttempt(sb, email, success) {
  try {
    const ip = await _getClientIP();
    await sb.from('login_attempts').insert({
      email: email, success: success, ip_address: ip, user_agent: navigator.userAgent,
    });
  } catch(e) { console.warn('[BANAHub] login attempt logging failed', e); }
}


// ── Payload helpers ───────────────────────────────────────────────────────────
// Strip transport-only / joined fields before writing to a table.
function _clean(o) {
  const out = {};
  Object.keys(o || {}).forEach(k => {
    if (k === 'csrf_token' || k === 'id' || k.startsWith('_')) return;
    const v = o[k];
    if (v === undefined) return;
    if (v && typeof v === 'object' && !Array.isArray(v) && ['companies', 'users'].includes(k)) return;
    out[k] = v;
  });
  return out;
}
function _slugify(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }
// Admin UI article shape <-> articles table
function _articleIn(a) {
  const row = {
    title: a.title || 'Untitled',
    body: a.content != null ? a.content : (a.body || ''),
    author_name: a.author || a.author_name || null,
    category: a.category || null,
    meta_description: a.meta || a.meta_description || null,
    tags: a.tags || null,
    status: a.status || 'draft',
    published: (a.status || '') === 'published',
    publish_date: a.date || a.publish_date || null,
  };
  if (a.id) row.id = a.id; else row.slug = _slugify(row.title) + '-' + Date.now().toString(36);
  return row;
}
function _articleOut(r) {
  return Object.assign({}, r, {
    content: r.body || '', author: r.author_name || '', meta: r.meta_description || '',
    date: r.publish_date || '', status: r.status || (r.published ? 'published' : 'draft'),
    created: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  });
}


// Map any public form payload onto the enquiries table: known columns go to
// columns, everything else is preserved in data (jsonb). Never trusts
// client-supplied status / notes / priority.
const _ENQ_COLS = ['name', 'email', 'company', 'message', 'source', 'type', 'phone', 'title', 'service', 'page_url'];
function _enquiryRow(b) {
  const row = { status: 'new', data: {} };
  Object.keys(b || {}).forEach(k => {
    if (['csrf_token', 'status', 'notes', 'priority', 'assigned_to', 'responded_at', 'id', 'created_at'].includes(k)) return;
    const v = b[k];
    if (v === undefined || v === null || v === '') return;
    if (_ENQ_COLS.includes(k)) row[k] = String(v).slice(0, k === 'message' ? 8000 : 300);
    else row.data[k] = typeof v === 'string' ? v.slice(0, 2000) : v;
  });
  if (!row.company && (b.organisation || b.organization)) row.company = String(b.organisation || b.organization).slice(0, 300);
  if (!row.type && row.source) row.type = String(row.source).replace(/_(enquiry|form|request|interest|campaign)$/, '');
  if (!row.page_url && typeof location !== 'undefined') row.page_url = location.pathname;
  return row;
}
async function _insertEnquiry(sb, b) {
  // No .select(): visitors may INSERT but not read enquiries (RLS)
  const { error } = await sb.from('enquiries').insert(_enquiryRow(b));
  if (error) return _resp({ success: false, error: error.message }, 400);
  return _resp({ success: true }, 201);
}


// Member-editable profile fields only (role/status/email are DB-protected anyway)
const _PROFILE_FIELDS = ['full_name', 'company_name', 'title', 'phone', 'country', 'linkedin_url', 'website', 'bio', 'avatar_url', 'preferences', 'role'];
const _MEMBER_ROLES = ['member', 'founder', 'business', 'investor', 'advisor', 'partner', 'provider'];
function _profilePatch(b) {
  const out = {};
  _PROFILE_FIELDS.forEach(k => {
    if (!(k in (b || {}))) return;
    let v = b[k];
    if (k === 'role') { if (_MEMBER_ROLES.includes(v)) out.role = v; return; }
    if (k === 'preferences') { if (v && typeof v === 'object') out.preferences = v; return; }
    if (typeof v === 'string') v = v.trim().slice(0, k === 'bio' ? 2000 : 300);
    if (['linkedin_url', 'website', 'avatar_url'].includes(k) && v && !/^https:\/\//i.test(v)) v = 'https://' + String(v).replace(/^[a-z]+:\/\//i, '');
    out[k] = v === '' ? null : v;
  });
  if (b && b.company && !out.company_name) out.company_name = String(b.company).slice(0, 300);
  return out;
}

// Google / LinkedIn sign-in (configure both providers in Supabase → Auth → Providers)
window.banaOAuth = async function (provider, next) {
  const sb = await _getSB();
  if (!sb) throw new Error('Auth unavailable');
  const p = provider === 'linkedin' ? 'linkedin_oidc' : provider;
  const dest = location.origin + (next && /^\/[a-z0-9\-\/]*$/i.test(next) ? next : '/dashboard');
  const { error } = await sb.auth.signInWithOAuth({ provider: p, options: { redirectTo: dest } });
  if (error) throw error;
};

// ── Fetch interceptor ─────────────────────────────────────────────────────────
const _nativeFetch = window.fetch.bind(window);
window.fetch = async function(input, opts) {
  opts = opts || {};
  const url = typeof input === 'string' ? input : (input && String(input.url || input)) || '';
  if (!url.startsWith('/api')) return _nativeFetch(input, opts);

  const route  = url.replace(/^\/api/, '') || '/';
  const method = ((opts.method) || 'GET').toUpperCase();
  const body   = _body(opts);
  // Transport-only fields must never reach a table (PostgREST rejects unknown columns)
  delete body.csrf_token;

  const sb = await _getSB();
  if (!sb) return _resp({ detail: 'Backend unavailable', error: 'Backend unavailable' }, 503);

  try {

    // ── Health ──────────────────────────────────────────────────────────────
    if (route === '/' || route === '/health')
      return _resp({ status: 'ok', backend: 'Supabase' });

    // ── CSRF ────────────────────────────────────────────────────────────────
    if (route.includes('csrf'))
      return _resp({ csrf_token: 'supabase-managed' });

    // ═══════════════════════════════════════════════════════════════════════
    // v3 ROUTES — placed first so they take precedence over legacy handlers.
    // All admin writes are still enforced by RLS (users.role = 'admin').
    // ═══════════════════════════════════════════════════════════════════════
    const _q = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
    const _path = route.split('?')[0];

    // ── CRM (admin) ───────────────────────────────────────────────────────────
    if (_path === '/admin/crm' && method === 'GET') {
      const { data, error } = await sb.from('crm_contacts').select('*').order('updated_at', { ascending: false, nullsFirst: false }).limit(5000);
      if (error) return _resp({ error: error.message, contacts: [] }, 400);
      return _resp({ contacts: data || [], total: (data || []).length });
    }
    if (_path === '/admin/crm' && method === 'POST') {
      const row = _clean(body);
      if (row.email) {
        row.email = String(row.email).toLowerCase();
        const { data: ex } = await sb.from('crm_contacts').select('*').eq('email', row.email).limit(1);
        if (ex && ex[0]) return _resp({ success: true, contact: ex[0], existing: true });
      }
      const { data, error } = await sb.from('crm_contacts').insert(row).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, contact: data }, 201);
    }
    const crmAct = _path.match(/^\/admin\/crm\/([^/]+)\/activities$/);
    if (crmAct && method === 'GET') {
      const { data } = await sb.from('crm_activities').select('*').eq('contact_id', crmAct[1]).order('created_at', { ascending: false });
      return _resp({ activities: data || [] });
    }
    if (crmAct && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      const { data, error } = await sb.from('crm_activities').insert({ contact_id: crmAct[1], kind: body.kind || 'note', body: String(body.body || '').slice(0, 5000), created_by: user && user.email }).select().single();
      if (error) return _resp({ error: error.message }, 400);
      await sb.from('crm_contacts').update({ last_contacted_at: ['call', 'email', 'meeting'].includes(body.kind) ? new Date().toISOString() : undefined, updated_at: new Date().toISOString() }).eq('id', crmAct[1]);
      return _resp({ success: true, activity: data }, 201);
    }
    const crmOne = _path.match(/^\/admin\/crm\/([^/]+)$/);
    if (crmOne && (method === 'PATCH' || method === 'PUT')) {
      const { data, error } = await sb.from('crm_contacts').update(Object.assign(_clean(body), { updated_at: new Date().toISOString() })).eq('id', crmOne[1]).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, contact: data });
    }
    if (crmOne && method === 'DELETE') {
      const { error } = await sb.from('crm_contacts').delete().eq('id', crmOne[1]);
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true });
    }

    // ── Members (admin): full profile + application + KYC for review ────────
    const memOne = _path.match(/^\/admin\/members\/([^/]+)$/);
    if (memOne && method === 'GET') {
      const id = memOne[1];
      const [u, a, k, sub] = await Promise.all([
        sb.from('users').select('*').eq('id', id).maybeSingle(),
        sb.from('applications').select('*').eq('user_id', id).order('created_at', { ascending: false }),
        sb.from('kyc_uploads').select('*').eq('user_id', id).order('created_at', { ascending: false }),
        sb.from('subscriptions').select('*').eq('user_id', id).maybeSingle(),
      ]);
      return _resp({ user: u.data, applications: a.data || [], kyc: k.data || [], subscription: sub.data });
    }
    if (memOne && (method === 'PATCH' || method === 'PUT')) {
      const patch = {};
      ['role', 'status', 'blocked', 'blocked_reason', 'full_name', 'company_name', 'title', 'phone', 'country', 'linkedin_url', 'website', 'bio'].forEach(k => { if (k in body) patch[k] = body[k]; });
      if ('blocked' in patch) patch.blocked_at = patch.blocked ? new Date().toISOString() : null;
      const { data, error } = await sb.from('users').update(patch).eq('id', memOne[1]).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, user: data });
    }

    // ── KYC review (admin): list with member + signed links to private files ─
    if (_path === '/kyc/admin/all' && method === 'GET') {
      const { data, error } = await sb.from('kyc_uploads').select('*, users(full_name, email, company_name)').order('created_at', { ascending: false });
      if (error) return _resp({ error: error.message, uploads: [] }, 400);
      return _resp({ uploads: data || [] });
    }
    const kycStatus = _path.match(/^\/kyc\/admin\/([^/]+)\/status$/);
    if (kycStatus && (method === 'PATCH' || method === 'PUT')) {
      const st = ['approved', 'verified', 'rejected', 'pending'].includes(body.status) ? body.status : null;
      if (!st) return _resp({ error: 'invalid status' }, 400);
      const { data, error } = await sb.from('kyc_uploads').update({ status: st, review_notes: body.review_notes || null, reviewed_at: new Date().toISOString() }).eq('id', kycStatus[1]).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, kyc: data });
    }
    const kycUrl = _path.match(/^\/kyc\/admin\/([^/]+)\/url$/);
    if (kycUrl && method === 'GET') {
      const { data: row } = await sb.from('kyc_uploads').select('storage_path, file_url').eq('id', kycUrl[1]).maybeSingle();
      if (!row) return _resp({ error: 'not found' }, 404);
      if (!row.storage_path) return _resp({ url: row.file_url || null });
      const { data, error } = await sb.storage.from('kyc').createSignedUrl(row.storage_path, 300);
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ url: data.signedUrl });
    }

    // ── Pricing catalog + Stripe Payment Links ──────────────────────────────
    if (_path.startsWith('/admin/pricing')) {
      const genMatch = _path.match(/^\/admin\/pricing\/([^/]+)\/generate-link$/);
      if (genMatch && method === 'POST') {
        const token = (await sb.auth.getSession()).data?.session?.access_token;
        if (!token) return _resp({ error: 'Not authenticated' }, 401);
        const r = await _nativeFetch(CONFIG.SUPABASE_URL + '/functions/v1/create-payment-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ pricing_catalog_id: genMatch[1] }),
        });
        const d = await r.json().catch(() => ({ error: 'Edge Function error' }));
        return _resp(d, r.status);
      }
      const pMatch = _path.match(/^\/admin\/pricing\/([^/]+)$/);
      if (!pMatch && method === 'GET') {
        const { data, error } = await sb.from('pricing_catalog').select('*').order('category').order('sort_order');
        if (error) return _resp({ error: error.message, items: [] }, 400);
        return _resp({ items: data || [], total: (data || []).length });
      }
      if (!pMatch && method === 'POST') {
        const { data, error } = await sb.from('pricing_catalog').insert(body).select().single();
        if (error) return _resp({ error: error.message }, 400);
        return _resp({ success: true, item: data }, 201);
      }
      if (pMatch && (method === 'PATCH' || method === 'PUT')) {
        const { data, error } = await sb.from('pricing_catalog').update(_clean(body)).eq('id', pMatch[1]).select().single();
        if (error) return _resp({ error: error.message }, 400);
        return _resp({ success: true, item: data });
      }
      if (pMatch && method === 'DELETE') {
        await sb.from('pricing_catalog').update({ active: false }).eq('id', pMatch[1]);
        return _resp({ success: true });
      }
    }

    // ── Articles (blog) — real table CRUD ───────────────────────────────────
    if (_path === '/admin/content/articles') {
      if (method === 'GET') {
        const { data } = await sb.from('articles').select('*').order('created_at', { ascending: false });
        return _resp({ articles: (data || []).map(_articleOut), total: (data || []).length });
      }
      if (method === 'PUT') {
        // Legacy admin sends the whole array — sync it to rows.
        let list = []; try { list = JSON.parse(body.data || '[]'); } catch (e) {}
        const keep = [];
        for (const a of list) {
          const row = _articleIn(a);
          const { data } = row.id
            ? await sb.from('articles').update(row).eq('id', row.id).select('id').single()
            : await sb.from('articles').insert(row).select('id').single();
          if (data) { keep.push(data.id); a.id = data.id; }
        }
        const { data: all } = await sb.from('articles').select('id');
        const drop = (all || []).map(r => r.id).filter(id => !keep.includes(id));
        if (drop.length) await sb.from('articles').delete().in('id', drop);
        return _resp({ success: true, ids: keep });
      }
      if (method === 'POST') {
        const { data: { user } } = await sb.auth.getUser();
        const { data, error } = await sb.from('articles').insert(Object.assign(_articleIn(body), { author_id: user && user.id })).select().single();
        if (error) return _resp({ error: error.message }, 400);
        return _resp({ success: true, article: _articleOut(data) }, 201);
      }
    }
    if (_path === '/articles' && method === 'GET') {
      const { data } = await sb.from('articles').select('*').eq('published', true).order('created_at', { ascending: false });
      return _resp({ articles: (data || []).map(_articleOut) });
    }

    // ── Single event (public detail page; admins also see drafts via RLS) ──
    const evOne = _path.match(/^\/events\/([^/]+)$/);
    if (evOne && method === 'GET') {
      const key = decodeURIComponent(evOne[1]);
      const isUuid = /^[0-9a-f-]{36}$/i.test(key);
      const { data } = await sb.from('events').select('*').eq(isUuid ? 'id' : 'slug', key).maybeSingle();
      if (!data) return _resp({ error: 'Event not found' }, 404);
      return _resp({ event: data });
    }

    // ── Investor directory (admin) ──────────────────────────────────────────
    if (_path === '/admin/investors' && method === 'GET') {
      let q = sb.from('investors').select('*').order('created_at', { ascending: false }).limit(2000);
      const s = (_q.get('search') || '').replace(/[,()]/g, ' ').trim();
      if (s) q = q.or(`full_name.ilike.%${s}%,organization.ilike.%${s}%,email.ilike.%${s}%,investor_type.ilike.%${s}%,geography.ilike.%${s}%,notes.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) return _resp({ error: error.message, investors: [] }, 400);
      return _resp({ investors: data || [], total: (data || []).length });
    }
    if (_path === '/admin/investors' && method === 'POST') {
      const { data, error } = await sb.from('investors').insert(Object.assign({ status: 'directory' }, _clean(body))).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, investor: data }, 201);
    }
    const invOne = _path.match(/^\/admin\/investors\/([^/]+)$/);
    if (invOne && (method === 'PATCH' || method === 'PUT')) {
      const { data, error } = await sb.from('investors').update(_clean(body)).eq('id', invOne[1]).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, investor: data });
    }
    if (invOne && method === 'DELETE') {
      const { error } = await sb.from('investors').delete().eq('id', invOne[1]);
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true });
    }

    // ── Company directory (admin) ───────────────────────────────────────────
    if (_path === '/admin/companies' && method === 'GET') {
      let q = sb.from('companies').select('*').order('created_at', { ascending: false }).limit(2000);
      const s = (_q.get('search') || '').replace(/[,()]/g, ' ').trim();
      if (s) q = q.or(`company_name.ilike.%${s}%,contact_name.ilike.%${s}%,email.ilike.%${s}%,stage.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) return _resp({ error: error.message, companies: [] }, 400);
      return _resp({ companies: data || [], total: (data || []).length });
    }
    if (_path === '/admin/companies' && method === 'POST') {
      const { data, error } = await sb.from('companies').insert(Object.assign({ status: 'approved' }, _clean(body))).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, company: data }, 201);
    }
    const coOne = _path.match(/^\/admin\/companies\/([^/]+)$/);
    if (coOne && (method === 'PATCH' || method === 'PUT')) {
      const { data, error } = await sb.from('companies').update(_clean(body)).eq('id', coOne[1]).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, company: data });
    }
    if (coOne && method === 'DELETE') {
      const { error } = await sb.from('companies').delete().eq('id', coOne[1]);
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true });
    }

    // ── Bulk import (CSV / Excel rows already normalised client-side) ───────
    // Dedupes by email: existing email → update, new → insert.
    if (_path === '/admin/network/import' && method === 'POST') {
      const table = body.type === 'company' ? 'companies' : 'investors';
      const defStatus = table === 'investors' ? 'directory' : 'approved';
      const rows = (body.rows || []).map(r => Object.assign({ status: defStatus }, _clean(r)));
      const emails = rows.map(r => (r.email || '').toLowerCase()).filter(Boolean);
      const existing = {};
      for (let i = 0; i < emails.length; i += 200) {
        const { data } = await sb.from(table).select('id,email').in('email', emails.slice(i, i + 200));
        (data || []).forEach(r => { if (r.email) existing[r.email.toLowerCase()] = r.id; });
      }
      const inserts = [], updates = [];
      rows.forEach(r => { const id = r.email && existing[r.email.toLowerCase()]; if (id) updates.push([id, r]); else inserts.push(r); });
      let inserted = 0, updated = 0; const errors = [];
      for (let i = 0; i < inserts.length; i += 200) {
        const { data, error } = await sb.from(table).insert(inserts.slice(i, i + 200)).select('id');
        if (error) errors.push(error.message); else inserted += (data || []).length;
      }
      for (const [id, r] of updates) {
        const { status, ...rest } = r;
        const { error } = await sb.from(table).update(rest).eq('id', id);
        if (error) errors.push(error.message); else updated++;
      }
      return _resp({ success: errors.length === 0, imported: inserted, updated, errors: errors.slice(0, 5) }, errors.length && !inserted && !updated ? 400 : 200);
    }

    // ── Capital raises (deal_rooms) — admin CRUD ────────────────────────────
    if (_path === '/admin/capital' && method === 'GET') {
      const { data, error } = await sb.from('deal_rooms').select('*, companies(company_name, website, email, contact_name)').order('created_at', { ascending: false });
      if (error) return _resp({ error: error.message, raises: [] }, 400);
      return _resp({ raises: data || [], total: (data || []).length });
    }
    if (_path === '/admin/capital' && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      const { data, error } = await sb.from('deal_rooms').insert(Object.assign({}, _clean(body), { created_by: user && user.id })).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, raise: data }, 201);
    }
    const capOne = _path.match(/^\/admin\/capital\/([^/]+)$/);
    if (capOne && (method === 'PATCH' || method === 'PUT')) {
      const { data, error } = await sb.from('deal_rooms').update(Object.assign(_clean(body), { updated_at: new Date().toISOString() })).eq('id', capOne[1]).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, raise: data });
    }
    if (capOne && method === 'DELETE') {
      const { error } = await sb.from('deal_rooms').delete().eq('id', capOne[1]);
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true });
    }

    // ── Member dashboard: Capital Flows (published open raises) ─────────────
    if (_path.startsWith('/dashboard/capital') && method === 'GET') {
      const now = new Date().toISOString();
      const [{ data: deals }, { data: events }] = await Promise.all([
        // member_capital_raises = safe-column view of published, open deal_rooms (see 08 migration)
        sb.from('member_capital_raises').select('*').order('created_at', { ascending: false }).limit(20),
        sb.from('events').select('id,title,type,event_date,location,luma_url,registration_url,page_url,price_amount,currency')
          .eq('published', true).gte('event_date', now).order('event_date', { ascending: true }).limit(5),
      ]);
      return _resp({ deals: deals || [], events: events || [] });
    }

    // ── Memberships (admin) — signups, subscriptions, membership payments ───
    if (_path === '/admin/memberships' && method === 'GET') {
      const [u, s, a, t] = await Promise.all([
        sb.from('users').select('id,email,full_name,company_name,role,status,created_at').neq('role', 'admin').order('created_at', { ascending: false }).limit(1000),
        sb.from('subscriptions').select('*').order('created_at', { ascending: false }),
        sb.from('applications').select('id,user_id,type,status,created_at,data').order('created_at', { ascending: false }).limit(1000),
        sb.from('transactions').select('id,user_id,email,amount,currency,status,created_at,stripe_session_id,type').eq('type', 'membership_payment').order('created_at', { ascending: false }).limit(1000),
      ]);
      return _resp({ users: u.data || [], subscriptions: s.data || [], applications: a.data || [], payments: t.data || [] });
    }
    const subOne = _path.match(/^\/admin\/subscriptions\/([^/]+)$/);
    if (subOne && (method === 'PATCH' || method === 'PUT')) {
      const { data, error } = await sb.from('subscriptions').update(_clean(body)).eq('id', subOne[1]).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, subscription: data });
    }

    // ── Page CMS: draft / publish whole-page overrides ──────────────────────
    // pages.sections = { cms_draft: {key:{h,src,href,hide}}, cms_published: {...},
    //                    cms_meta: {title, description}, cms_meta_draft, ... }
    if (_path === '/admin/pages' && method === 'GET') {
      let q = sb.from('pages').select('*');
      if (_q.get('page')) q = q.eq('slug', _q.get('page'));
      const { data } = await q;
      return _resp({ pages: data || [], total: (data || []).length, sections: (data && data[0] && data[0].sections) || {} });
    }
    if (_path === '/admin/pages' && (method === 'PATCH' || method === 'PUT')) {
      const slug = body.page;
      if (!slug) return _resp({ error: 'page required' }, 400);
      const { data: existing } = await sb.from('pages').select('sections').eq('slug', slug).maybeSingle();
      const sections = Object.assign({}, (existing && existing.sections) || {});
      if (body.section) sections[body.section] = body.content;              // legacy hero editor
      if (body.overrides) {
        sections.cms_draft = body.overrides;
        sections.cms_meta_draft = body.meta || {};
        if (body.mode === 'publish') {
          sections.cms_published = body.overrides;
          sections.cms_meta = body.meta || {};
          sections.cms_published_at = new Date().toISOString();
        }
        sections.cms_updated_at = new Date().toISOString();
      }
      if (body.mode === 'revert') { sections.cms_draft = sections.cms_published || {}; sections.cms_meta_draft = sections.cms_meta || {}; }
      if (body.mode === 'reset')  { delete sections.cms_draft; delete sections.cms_published; delete sections.cms_meta; delete sections.cms_meta_draft; }
      const { data, error } = await sb.from('pages').upsert({ slug, sections }, { onConflict: 'slug' }).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, page: data });
    }
    // ═══════════════════════════ end v3 routes ══════════════════════════════

    // ── Auth: register ──────────────────────────────────────────────────────
    if (route.startsWith('/auth/register') && method === 'POST') {
      const { data, error } = await sb.auth.signUp({
        email: body.email, password: body.password,
        options: { data: { full_name: body.full_name || '' }, emailRedirectTo: location.origin + '/dashboard' },
      });
      if (error) return _resp({ success: false, detail: error.message, error: error.message }, 400);
      // The pending users row is created by the on_auth_user_created DB trigger.
      // Here we only fill in profile fields the member is allowed to edit.
      if (data && data.session && data.user) {
        await sb.from('users').update(_profilePatch(body)).eq('id', data.user.id);
        return _resp({ success: true, user: { id: data.user.id, email: data.user.email, role: 'applicant', status: 'pending' },
                       access_token: data.session.access_token, refresh_token: data.session.refresh_token }, 201);
      }
      // Email confirmation required: no session yet
      return _resp({ success: true, confirm_email: true, user_id: data.user && data.user.id }, 201);
    }

    // ── Member: own profile ─────────────────────────────────────────────────
    if (route === '/me' && method === 'GET') {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ error: 'Not authenticated' }, 401);
      const { data: p } = await sb.from('users').select('*').eq('id', user.id).maybeSingle();
      const ids = (user.identities || []).map(i => i.provider);
      return _resp({ user: Object.assign({ id: user.id, email: user.email }, p || {}), identities: ids, provider: user.app_metadata && user.app_metadata.provider });
    }
    if (route === '/me' && (method === 'PATCH' || method === 'PUT')) {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ error: 'Not authenticated' }, 401);
      const { data, error } = await sb.from('users').update(_profilePatch(body)).eq('id', user.id).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, user: data });
    }

    // ── Applications: submit (called after register, saves institution details) ─
    if (route.startsWith('/applications/submit') && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ error: 'Unauthorized' }, 401);
      const { data } = await sb.from('applications').insert({
        user_id: user.id,
        type: body.type || 'membership',
        status: 'pending',
        data: body,
      }).select().single();
      return _resp({ success: true, application: data }, 201);
    }

    // ── KYC: upload file metadata (actual file goes via Supabase Storage SDK) ──
    if (route.startsWith('/kyc/upload') && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ error: 'Unauthorized' }, 401);
      const { data } = await sb.from('kyc_uploads').insert({
        user_id: user.id,
        document_type: body.document_type || 'identity',
        file_url: body.file_url,
        status: 'pending',
      }).select().single();
      return _resp({ success: true, kyc: data }, 201);
    }

    // ── Program registration request ─────────────────────────────────────────
    if (route.startsWith('/programs/register') && method === 'POST') {
      return _insertEnquiry(sb, Object.assign({}, body, {
        message: `Program Registration Request — ${body.program_title || 'Unspecified'}\n\n${body.message || ''}`.trim(),
        source: 'program_request', type: 'program',
      }));
    }

    // ── Newsletter subscribe ──────────────────────────────────────────────────
    if (route.startsWith('/newsletter/subscribe') && method === 'POST') {
      const { data, error } = await sb.from('newsletter_subscribers').upsert({
        email: body.email, name: body.name || null, is_active: true,
      }, { onConflict: 'email' }).select().single();
      if (error && error.code !== '23505') return _resp({ success: false, error: error.message }, 400);
      return _resp({ success: true, subscriber: data }, 201);
    }

    // ── Auth: login ─────────────────────────────────────────────────────────
    if (route.startsWith('/auth/login') && method === 'POST') {
      // Rate limit: block after 5 failed attempts / 15 min for this email
      const { data: allowed } = await sb.rpc('check_login_rate_limit', { p_email: body.email });
      if (allowed === false) {
        await _logLoginAttempt(sb, body.email, false);
        return _resp({ success: false, detail: 'Too many failed attempts. Try again in 15 minutes.', error: 'rate_limited' }, 429);
      }

      const { data, error } = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
      await _logLoginAttempt(sb, body.email, !error);
      if (error) return _resp({ success: false, detail: error.message, error: error.message }, 401);
      // users row is created server-side by the on_auth_user_created trigger
      const { data: p } = await sb.from('users').select('*').eq('id', data.user.id).maybeSingle();

      // Blocked accounts: valid password still gets rejected. Sign the
      // session back out immediately so no token lingers client-side.
      if (p && (p.blocked || p.status === 'blocked')) {
        await sb.auth.signOut();
        return _resp({ success: false, detail: 'This account has been suspended. Contact support.', error: 'blocked' }, 403);
      }
      const user = Object.assign({}, { id: data.user.id, email: data.user.email }, p || { role: 'applicant', status: 'pending' });
      return _resp({ success: true, user, access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    }

    // ── Auth: logout ────────────────────────────────────────────────────────
    if (route.startsWith('/auth/logout')) {
      await sb.auth.signOut();
      return _resp({ success: true });
    }

    // ── Auth: refresh ───────────────────────────────────────────────────────
    if (route.startsWith('/auth/refresh') && method === 'POST') {
      const { data, error } = await sb.auth.refreshSession({ refresh_token: body.refresh_token });
      if (error) return _resp({ success: false, detail: error.message }, 401);
      return _resp({ success: true, access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    }

    // ── Auth: me ────────────────────────────────────────────────────────────
    if (route.startsWith('/auth/me') && method === 'GET') {
      const { data: { user }, error } = await sb.auth.getUser();
      if (error || !user) return _resp({ success: false, detail: 'Not authenticated', error: 'Not authenticated' }, 401);
      const { data: p } = await sb.from('users').select('*').eq('id', user.id).maybeSingle();
      const merged = Object.assign({}, { id: user.id, email: user.email, auth_provider: user.app_metadata && user.app_metadata.provider }, p || { role: 'applicant', status: 'pending' });
      return _resp({ success: true, user: merged });
    }

    // ── Admin: stats ────────────────────────────────────────────────────────
    if (route.startsWith('/admin/stats')) {
      const c = q => q.then(r => r.count || 0);
      const head = { count: 'exact', head: true };
      const [members, pendingUsers, apps, pendingApps, events, subs, kyc, access, enqOpen, enqNew, companies, investors, openRaises, txns] = await Promise.all([
        c(sb.from('users').select('id', head).neq('role', 'admin')),
        c(sb.from('users').select('id', head).eq('status', 'pending')),
        c(sb.from('applications').select('id', head)),
        c(sb.from('applications').select('id', head).eq('status', 'pending')),
        c(sb.from('events').select('id', head)),
        c(sb.from('newsletter_subscribers').select('id', head).eq('is_active', true)),
        c(sb.from('kyc_uploads').select('id', head).eq('status', 'pending')),
        c(sb.from('access_requests').select('id', head).eq('status', 'pending')),
        c(sb.from('enquiries').select('id', head).in('status', ['new', 'pending', 'in_progress'])),
        c(sb.from('enquiries').select('id', head).in('status', ['new', 'pending'])),
        c(sb.from('companies').select('id', head)),
        c(sb.from('investors').select('id', head)),
        c(sb.from('deal_rooms').select('id', head).eq('status', 'open')),
        sb.from('transactions').select('amount,currency').eq('status', 'completed').limit(5000).then(r => r.data || []),
      ]);
      const revenue = {}; txns.forEach(t => { revenue[t.currency || 'SGD'] = (revenue[t.currency || 'SGD'] || 0) + Number(t.amount || 0); });
      return _resp({
        total_members: members, total_users: members, pending_approvals: pendingUsers,
        total_applications: apps, pending_applications: pendingApps, total_events: events,
        total_subscribers: subs, kyc_uploads: kyc, pending_kyc: kyc, pending_access: access,
        open_enquiries: enqOpen, new_enquiries: enqNew, total_companies: companies,
        total_investors: investors, open_deal_rooms: openRaises, revenue,
      });
    }

    // ── Admin: users (with optional role filter) ────────────────────────────
    if (route.startsWith('/admin/users') && method === 'GET' && !route.match(/\/admin\/users\/.+/)) {
      const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
      const role = urlQ.get('role');
      let q = sb.from('users').select('*').order('created_at', { ascending: false });
      if (role) q = q.eq('role', role);
      const { data } = await q;
      return _resp({ users: data || [], total: (data || []).length });
    }

    // ── Admin: update user ──────────────────────────────────────────────────
    const auMatch = route.match(/^\/admin\/users\/([^/?]+)/);
    if (auMatch && method === 'PATCH') {
      const { data } = await sb.from('users').update(body).eq('id', auMatch[1]).select().single();
      return _resp({ success: true, user: data });
    }

    // ── Admin: applications (supports /applications/admin/ and /admin/applications) ─
    if ((route.startsWith('/admin/applications') || route.startsWith('/applications/admin')) && method === 'GET') {
      const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
      const status = urlQ.get('status');
      let q = sb.from('applications').select('*, users(email, full_name, company_name)').order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      const { data } = await q;
      return _resp({ applications: data || [], total: (data || []).length });
    }

    // ── Applications: submit ────────────────────────────────────────────────
    if (route === '/applications' && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ detail: 'Not authenticated' }, 401);
      const { data } = await sb.from('applications').insert({
        user_id: user.id, type: body.type || 'business', data: body, status: 'pending'
      }).select().single();
      return _resp({ success: true, application: data }, 201);
    }

    // ── Applications: list (own or all for admin) ───────────────────────────
    if (route === '/applications' && method === 'GET') {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ detail: 'Not authenticated' }, 401);
      const { data: prof } = await sb.from('users').select('role').eq('id', user.id).single();
      let q = sb.from('applications').select('*').order('created_at', { ascending: false });
      if (!prof || prof.role !== 'admin') q = q.eq('user_id', user.id);
      const { data } = await q;
      return _resp({ applications: data || [], total: (data || []).length });
    }

    // ── Applications: update status ─────────────────────────────────────────
    const appMatch = route.match(/^\/applications\/([^/?]+)/);
    if (appMatch && method === 'PATCH') {
      const { data } = await sb.from('applications').update(body).eq('id', appMatch[1]).select().single();
      return _resp({ success: true, application: data });
    }

    // ── KYC (supports /kyc/admin/ and /kyc/admin/all) ──────────────────────
    if (route.startsWith('/kyc/admin') && method === 'GET') {
      const { data } = await sb.from('kyc_uploads').select('*, users(email, full_name)').order('created_at', { ascending: false });
      return _resp({ kyc_uploads: data || [], total: (data || []).length });
    }
    if (route.startsWith('/kyc') && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ detail: 'Not authenticated' }, 401);
      const { data, error } = await sb.from('kyc_uploads').insert({
        user_id: user.id, document_type: body.document_type || 'identity',
        storage_path: body.storage_path || null, file_name: body.file_name || null, file_url: null, status: 'pending',
      }).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, kyc: data }, 201);
    }

    // ── Admin content: articles ─────────────────────────────────────────────
    if (route.startsWith('/admin/content/articles') && method === 'GET') {
      const { data } = await sb.from('articles').select('*').order('created_at', { ascending: false });
      return _resp({ articles: data || [], total: (data || []).length });
    }
    if (route.startsWith('/admin/content/articles') && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      const { data } = await sb.from('articles').insert(Object.assign({}, body, { author_id: user && user.id })).select().single();
      return _resp({ success: true, article: data }, 201);
    }

    // ── Admin content: events ───────────────────────────────────────────────
    if (route.startsWith('/admin/content/events') && method === 'GET') {
      const { data } = await sb.from('events').select('*').order('event_date', { ascending: false });
      return _resp({ events: data || [], total: (data || []).length });
    }
    if (route.startsWith('/admin/content/events') && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      const { data } = await sb.from('events').insert(Object.assign({}, body, { created_by: user && user.id })).select().single();
      return _resp({ success: true, event: data }, 201);
    }
    if (route.startsWith('/admin/content/events/') && (method === 'PATCH' || method === 'PUT')) {
      const id = route.split('/admin/content/events/')[1];
      const { data } = await sb.from('events').update(body).eq('id', id).select().single();
      return _resp({ success: true, event: data });
    }
    if (route.startsWith('/admin/content/events/') && method === 'DELETE') {
      const id = route.split('/admin/content/events/')[1];
      await sb.from('events').delete().eq('id', id);
      return _resp({ success: true });
    }

    // ── Admin content: programs ──────────────────────────────────────────────
    if (route.startsWith('/admin/content/programs') && method === 'GET') {
      const { data } = await sb.from('programs').select('*').order('start_date', { ascending: false });
      return _resp({ programs: data || [], total: (data || []).length });
    }
    if (route.startsWith('/admin/content/programs') && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      const { data } = await sb.from('programs').insert(Object.assign({}, body, { created_by: user && user.id })).select().single();
      return _resp({ success: true, program: data }, 201);
    }
    if (route.startsWith('/admin/content/programs/') && (method === 'PATCH' || method === 'PUT')) {
      const id = route.split('/admin/content/programs/')[1];
      const { data } = await sb.from('programs').update(body).eq('id', id).select().single();
      return _resp({ success: true, program: data });
    }
    if (route.startsWith('/admin/content/programs/') && method === 'DELETE') {
      const id = route.split('/admin/content/programs/')[1];
      await sb.from('programs').delete().eq('id', id);
      return _resp({ success: true });
    }

    // ── Programs: public ──────────────────────────────────────────────────────
    if (route.startsWith('/programs') && method === 'GET') {
      const { data } = await sb.from('programs').select('*').eq('published', true).order('start_date', { ascending: true });
      return _resp({ programs: data || [] });
    }

    // ── Public: payment status lookup (by Stripe session_id only —
    //    the status itself is only ever set 'completed' by the
    //    stripe-webhook Edge Function, never by this client route) ──────────
    if (route.startsWith('/transactions/status') && method === 'GET') {
      const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
      const sessionId = urlQ.get('session_id');
      if (!sessionId) return _resp({ status: 'error' }, 400);
      const { data: status } = await sb.rpc('get_transaction_status', { p_session_id: sessionId });
      return _resp({ status: status || 'error' });
    }

    // ── Public: settings + pages (read-only, for the live site to consume) ──
    if (route.startsWith('/settings') && method === 'GET') {
      const { data } = await sb.from('site_settings').select('*');
      const merged = {}; (data || []).forEach(r => merged[r.key] = r.value);
      return _resp({ settings: merged });
    }
    if (route.startsWith('/pages/') && method === 'GET') {
      const slug = route.split('/pages/')[1];
      const { data } = await sb.from('pages').select('*').eq('slug', slug).single();
      return _resp({ page: data || null });
    }

    // ── Admin: partners ──────────────────────────────────────────────────────
    if (route.startsWith('/admin/partners') && method === 'GET') {
      const { data } = await sb.from('partners').select('*').order('created_at', { ascending: false });
      return _resp({ partners: data || [] });
    }
    if (route.startsWith('/admin/partners') && method === 'POST') {
      const { data } = await sb.from('partners').insert(body).select().single();
      return _resp({ success: true, partner: data }, 201);
    }
    if (route.startsWith('/admin/partners/') && method === 'DELETE') {
      const id = route.split('/admin/partners/')[1];
      await sb.from('partners').delete().eq('id', id);
      return _resp({ success: true });
    }

    // ── Admin: access requests ──────────────────────────────────────────────
    if (route.startsWith('/admin/access-requests') && method === 'GET') {
      const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
      const status = urlQ.get('status');
      let q = sb.from('access_requests').select('*').order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      const { data } = await q;
      return _resp({ requests: data || [] });
    }
    if (route.startsWith('/admin/access-requests/') && (method === 'PATCH' || method === 'PUT')) {
      const id = route.split('/admin/access-requests/')[1];
      const { data: { user } } = await sb.auth.getUser();
      const payload = Object.assign({}, body, { reviewed_by: user && user.id, reviewed_at: new Date().toISOString() });
      const { data } = await sb.from('access_requests').update(payload).eq('id', id).select().single();
      return _resp({ success: true, request: data });
    }

    // ── Admin: enquiries ─────────────────────────────────────────────────────
    if (route.startsWith('/admin/enquiries') && method === 'GET') {
      const { data } = await sb.from('enquiries').select('*').order('created_at', { ascending: false });
      return _resp({ enquiries: data || [] });
    }
    if (route.startsWith('/admin/enquiries/') && (method === 'PATCH' || method === 'PUT')) {
      const id = route.split('/admin/enquiries/')[1];
      const patch = {};
      ['status', 'priority', 'notes', 'assigned_to'].forEach(k => { if (k in body) patch[k] = body[k]; });
      if (patch.status === 'responded') patch.responded_at = new Date().toISOString();
      const { data, error } = await sb.from('enquiries').update(patch).eq('id', id).select().single();
      if (error) return _resp({ error: error.message }, 400);
      return _resp({ success: true, enquiry: data });
    }
    // Public: contact form submission
    if (route.startsWith('/enquiries') && method === 'POST') {
      return _insertEnquiry(sb, body);
    }

    // ── Admin: activity logs ────────────────────────────────────────────────
    if (route.startsWith('/admin/logs') && method === 'GET') {
      const { data } = await sb.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(300);
      return _resp({ logs: data || [] });
    }
    if (route.startsWith('/logs') && method === 'POST') {
      const { data: { user } } = await sb.auth.getUser();
      await sb.from('activity_logs').insert(Object.assign({}, body, { actor_email: user && user.email }));
      return _resp({ success: true });
    }

    // ── Member dashboard sections ────────────────────────────────────────────
    if (route.startsWith('/dashboard/memberships') && method === 'GET') {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ error: 'Unauthorized' }, 401);
      const [{ data: sub }, { data: prog }] = await Promise.all([
        sb.from('subscriptions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1),
        sb.from('programs').select('id,title,type,status,start_date,end_date,description').eq('published', true).order('start_date', { ascending: true }).limit(6),
      ]);
      return _resp({ subscription: sub?.[0] || null, programs: prog || [] });
    }
    if (route.startsWith('/dashboard/compliance') && method === 'GET') {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ error: 'Unauthorized' }, 401);
      const [{ data: kyc }, { data: acc }] = await Promise.all([
        sb.from('kyc_uploads').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        sb.from('access_requests').select('*').eq('requester_id', user.id).order('created_at', { ascending: false }),
      ]);
      return _resp({ kyc: kyc || [], access_requests: acc || [] });
    }
    if (route.startsWith('/dashboard/capital') && method === 'GET') {
      const { data: deals } = await sb.from('deal_rooms').select('id,name,industry,investment_type,stage,target_raise,currency,status,created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(10);
      const { data: events } = await sb.from('events').select('id,title,type,event_date,location,luma_url,registration_url,price_amount,currency').eq('published', true).gte('event_date', new Date().toISOString()).order('event_date', { ascending: true }).limit(5);
      return _resp({ deals: deals || [], events: events || [] });
    }
    if (route.startsWith('/dashboard/me') && method === 'GET') {
      const { data: { user }, error } = await sb.auth.getUser();
      if (error || !user) return _resp({ error: 'Unauthorized' }, 401);
      const { data: p } = await sb.from('users').select('*').eq('id', user.id).single();
      return _resp({ user: Object.assign({ id: user.id, email: user.email }, p || {}) });
    }

    // ── Admin: sponsorship packages ─────────────────────────────────────────
    if (route.startsWith('/admin/sponsorship-packages') && method === 'GET') {
      const { data } = await sb.from('sponsorship_packages').select('*').order('format').order('category');
      return _resp({ packages: data || [] });
    }
    if (route.startsWith('/admin/sponsorship-packages') && method === 'POST') {
      const { data } = await sb.from('sponsorship_packages').insert(body).select().single();
      return _resp({ success: true, package: data }, 201);
    }
    if (route.startsWith('/admin/sponsorship-packages/') && (method === 'PATCH' || method === 'PUT')) {
      const id = route.split('/admin/sponsorship-packages/')[1];
      const { data } = await sb.from('sponsorship_packages').update(body).eq('id', id).select().single();
      return _resp({ success: true, package: data });
    }
    if (route.startsWith('/admin/sponsorship-packages/') && method === 'DELETE') {
      const id = route.split('/admin/sponsorship-packages/')[1];
      await sb.from('sponsorship_packages').delete().eq('id', id);
      return _resp({ success: true });
    }

    // ── Public: sponsorship packages ────────────────────────────────────────
    // ── Membership: checkout (monthly $8 or annual $88) ─────────────────────
    if (route.startsWith('/membership/checkout') && method === 'POST') {
      const { billing } = body; // 'monthly' | 'annual'
      const { data: { user } } = await sb.auth.getUser();
      const email = user?.email || body.email || null;
      const planLabel = billing === 'annual' ? 'BANAHub Annual Membership' : 'BANAHub Monthly Membership';
      const amount    = billing === 'annual' ? 88 : 8;
      // Pre-log as pending
      if (user) {
        await sb.from('subscriptions').upsert({
          user_id: user.id, plan: planLabel, status: 'pending',
        }, { onConflict: 'user_id' });
      }
      // Route to Edge Function for actual Stripe session creation
      const fnUrl = CONFIG.SUPABASE_URL + '/functions/v1/create-checkout-session';
      const token = (await sb.auth.getSession()).data?.session?.access_token;
      const stripeRes = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer '+token } : {}) },
        body: JSON.stringify({ item_type: 'membership', billing, email }),
      });
      const stripeData = await stripeRes.json();
      if (!stripeRes.ok || !stripeData.url) return _resp({ error: stripeData.error || 'Checkout failed' }, 400);
      return _resp({ url: stripeData.url });
    }

    if (route.startsWith('/sponsorship-packages') && method === 'GET') {
      const { data } = await sb.from('sponsorship_packages').select('*').eq('published', true).order('format').order('category');
      return _resp({ packages: data || [] });
    }

    // ── Admin: transactions (read-only — writes happen only via the
    //    stripe-webhook Edge Function using the service_role key) ────────────
    if (route.startsWith('/admin/transactions') && method === 'GET') {
      const { data } = await sb.from('transactions').select('*').order('created_at', { ascending: false }).limit(200);
      return _resp({ transactions: data || [], total: (data || []).length });
    }

    // ── Admin: settings (general/branding/email) + SEO ──────────────────────
    if (route.startsWith('/admin/content/settings') && method === 'GET') {
      const { data } = await sb.from('site_settings').select('*');
      const merged = {}; (data || []).forEach(r => merged[r.key] = r.value);
      return _resp({ settings: merged });
    }
    if (route.startsWith('/admin/content/settings') && method === 'PATCH') {
      const { data: { user } } = await sb.auth.getUser();
      const results = {};
      for (const key of Object.keys(body)) {
        const { data } = await sb.from('site_settings').upsert({ key, value: body[key], updated_by: user && user.id, updated_at: new Date().toISOString() }, { onConflict: 'key' }).select().single();
        results[key] = data;
      }
      return _resp({ success: true, settings: results });
    }

    // ── Admin: notifications ────────────────────────────────────────────────
    if (route.startsWith('/admin/notifications') && method === 'GET') {
      const { data } = await sb.from('admin_notifications').select('*').order('created_at', { ascending: false }).limit(50);
      return _resp({ notifications: data || [] });
    }
    if (route.startsWith('/admin/notifications/mark-all-read') && method === 'PATCH') {
      await sb.from('admin_notifications').update({ read: true }).eq('read', false);
      return _resp({ success: true });
    }

    // ── Admin content: media ────────────────────────────────────────────────
    if (route.startsWith('/admin/content/media')) {
      if (method === 'GET') {
        const { data } = await sb.from('media').select('*').order('created_at', { ascending: false });
        return _resp({ media: data || [], total: (data || []).length });
      }
      if (method === 'POST') {
        const { data: { user } } = await sb.auth.getUser();
        const { data } = await sb.from('media').insert(Object.assign({}, body, { uploaded_by: user && user.id })).select().single();
        return _resp({ success: true, media: data }, 201);
      }
    }
    if (route.startsWith('/admin/content/media/') && method === 'DELETE') {
      const id = route.split('/admin/content/media/')[1];
      const { data: row } = await sb.from('media').select('storage_path').eq('id', id).single();
      if (row && row.storage_path) await sb.storage.from('media').remove([row.storage_path]);
      await sb.from('media').delete().eq('id', id);
      return _resp({ success: true });
    }

    // ── Admin: pages ────────────────────────────────────────────────────────
    if (route.startsWith('/admin/pages')) {
      const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
      const page = urlQ.get('page');
      if (method === 'GET') {
        let q = sb.from('pages').select('*');
        if (page) q = q.eq('slug', page);
        const { data } = await q;
        return _resp({ pages: data || [], total: (data || []).length });
      }
      if (method === 'PATCH') {
        // body: { page: slug, section: 'hero', content: {...} }
        const { data: existing } = await sb.from('pages').select('sections').eq('slug', body.page).single();
        const sections = Object.assign({}, existing?.sections || {}, { [body.section]: body.content });
        const { data } = await sb.from('pages').upsert({ slug: body.page, sections }, { onConflict: 'slug' }).select().single();
        return _resp({ success: true, page: data });
      }
    }

    // ── Events: public ──────────────────────────────────────────────────────
    if (route.startsWith('/events') && method === 'GET') {
      const { data } = await sb.from('events').select('*').order('event_date', { ascending: true });
      return _resp({ events: data || [] });
    }

    // ── Newsletter ──────────────────────────────────────────────────────────
    if (route.includes('newsletter') || route.includes('subscribe')) {
      await sb.from('newsletter_subscribers').upsert({ email: body.email, name: body.name || '', is_active: true }, { onConflict: 'email' });
      return _resp({ success: true });
    }


    // ── COMPANIES ──────────────────────────────────────────────────────────
    if (route.startsWith('/companies')) {
      if (method === 'GET') {
        const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
        let q = sb.from('companies').select('*').eq('status', 'approved').order('featured', { ascending: false }).order('created_at', { ascending: false });
        if (urlQ.get('industry')) q = q.contains('industry', [urlQ.get('industry')]);
        if (urlQ.get('stage')) q = q.eq('stage', urlQ.get('stage'));
        const { data } = await q;
        return _resp({ companies: data || [], total: (data||[]).length });
      }
      if (method === 'POST') {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return _resp({ detail: 'Not authenticated' }, 401);
        const { data } = await sb.from('companies').insert(Object.assign({}, body, { user_id: user.id, status: 'pending' })).select().single();
        return _resp({ success: true, company: data }, 201);
      }
    }

    // ── INVESTORS ──────────────────────────────────────────────────────────
    if (route.startsWith('/investors')) {
      if (method === 'GET') {
        const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
        let q = sb.from('investors').select('*').eq('status', 'approved').order('featured', { ascending: false }).order('created_at', { ascending: false });
        if (urlQ.get('type')) q = q.eq('investor_type', urlQ.get('type'));
        if (urlQ.get('sector')) q = q.contains('focus_sectors', [urlQ.get('sector')]);
        const { data } = await q;
        return _resp({ investors: data || [], total: (data||[]).length });
      }
      if (method === 'POST') {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return _resp({ detail: 'Not authenticated' }, 401);
        const { data } = await sb.from('investors').insert(Object.assign({}, body, { user_id: user.id, status: 'pending' })).select().single();
        return _resp({ success: true, investor: data }, 201);
      }
    }

    // ── ADVISORS ──────────────────────────────────────────────────────────
    if (route.startsWith('/advisors')) {
      if (method === 'GET') {
        const { data } = await sb.from('advisors').select('*').eq('status', 'approved').order('featured', { ascending: false });
        return _resp({ advisors: data || [], total: (data||[]).length });
      }
      if (method === 'POST') {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return _resp({ detail: 'Not authenticated' }, 401);
        const { data } = await sb.from('advisors').insert(Object.assign({}, body, { user_id: user.id, status: 'pending' })).select().single();
        return _resp({ success: true, advisor: data }, 201);
      }
    }

    // ── PARTNERS ──────────────────────────────────────────────────────────
    if (route.startsWith('/partners')) {
      if (method === 'GET') {
        const { data } = await sb.from('partners').select('*').eq('status', 'approved').order('featured', { ascending: false });
        return _resp({ partners: data || [], total: (data||[]).length });
      }
    }

    // ── DEAL ROOMS ────────────────────────────────────────────────────────
    if (route.startsWith('/deal-rooms') || route.startsWith('/deal_rooms')) {
      if (method === 'GET') {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return _resp({ detail: 'Not authenticated' }, 401);
        const { data: memberRooms } = await sb.from('deal_room_members').select('deal_room_id').eq('user_id', user.id).eq('status', 'accepted');
        const ids = (memberRooms||[]).map(r => r.deal_room_id);
        const { data } = await sb.from('deal_rooms').select('*, companies(company_name, logo_url)').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).order('created_at', { ascending: false });
        return _resp({ deal_rooms: data || [], total: (data||[]).length });
      }
      if (method === 'POST') {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return _resp({ detail: 'Not authenticated' }, 401);
        const { data } = await sb.from('deal_rooms').insert(Object.assign({}, body, { created_by: user.id, status: 'draft' })).select().single();
        if (data) await sb.from('deal_room_members').insert({ deal_room_id: data.id, user_id: user.id, role: 'owner', status: 'accepted' });
        return _resp({ success: true, deal_room: data }, 201);
      }
    }

    // ── MESSAGES ──────────────────────────────────────────────────────────
    if (route.startsWith('/messages')) {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ detail: 'Not authenticated' }, 401);
      if (method === 'GET') {
        const { data } = await sb.from('messages').select('*, sender:sender_id(email, full_name)').eq('recipient_id', user.id).order('created_at', { ascending: false });
        return _resp({ messages: data || [], unread: (data||[]).filter(m => !m.read).length });
      }
      if (method === 'POST') {
        const { data } = await sb.from('messages').insert(Object.assign({}, body, { sender_id: user.id })).select().single();
        return _resp({ success: true, message: data }, 201);
      }
    }

    // ── INTRODUCTIONS ─────────────────────────────────────────────────────
    if (route.startsWith('/introductions')) {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return _resp({ detail: 'Not authenticated' }, 401);
      if (method === 'POST') {
        const { data } = await sb.from('introductions').insert(Object.assign({}, body, { requester_id: user.id, status: 'pending' })).select().single();
        return _resp({ success: true, introduction: data }, 201);
      }
      if (method === 'GET') {
        const { data } = await sb.from('introductions').select('*').or(`requester_id.eq.${user.id},target_id.eq.${user.id}`).order('created_at', { ascending: false });
        return _resp({ introductions: data || [], total: (data||[]).length });
      }
    }

    // ── CRM (admin only) ─────────────────────────────────────────────────
    if (route.startsWith('/admin/crm') || route.startsWith('/crm')) {
      if (method === 'GET') {
        const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
        let q = sb.from('crm_contacts').select('*').order('created_at', { ascending: false });
        if (urlQ.get('stage')) q = q.eq('pipeline_stage', urlQ.get('stage'));
        if (urlQ.get('type')) q = q.eq('contact_type', urlQ.get('type'));
        const { data } = await q;
        return _resp({ contacts: data || [], total: (data||[]).length });
      }
      if (method === 'POST') {
        const { data } = await sb.from('crm_contacts').insert(body).select().single();
        return _resp({ success: true, contact: data }, 201);
      }
      const crmMatch = route.match(/\/crm\/([^/?]+)/);
      if (crmMatch && method === 'PATCH') {
        const { data } = await sb.from('crm_contacts').update(body).eq('id', crmMatch[1]).select().single();
        return _resp({ success: true, contact: data });
      }
      if (crmMatch && method === 'DELETE') {
        await sb.from('crm_contacts').delete().eq('id', crmMatch[1]);
        return _resp({ success: true });
      }
    }

    // ── ADMIN: companies/investors/advisors/partners management ─────────────
    if (route.startsWith('/admin/companies')) {
      const { data } = await sb.from('companies').select('*, users(email)').order('created_at', { ascending: false });
      return _resp({ companies: data || [], total: (data||[]).length });
    }
    if (route.startsWith('/admin/investors')) {
      const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
      const search = urlQ.get('search');
      let q = sb.from('investors').select('*, users(email)').order('created_at', { ascending: false });
      if (search) q = q.or(`full_name.ilike.%${search}%,organization.ilike.%${search}%,email.ilike.%${search}%,investor_type.ilike.%${search}%`);
      const { data } = await q;
      return _resp({ investors: data || [], total: (data||[]).length });
    }
    if (route.startsWith('/admin/companies')) {
      const urlQ = new URLSearchParams(route.includes('?') ? route.split('?')[1] : '');
      const search = urlQ.get('search');
      let q = sb.from('companies').select('*, users(email)').order('created_at', { ascending: false });
      if (search) q = q.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,stage.ilike.%${search}%`);
      const { data } = await q;
      return _resp({ companies: data || [], total: (data||[]).length });
    }
    if (route.startsWith('/admin/network/import') && method === 'POST') {
      // body: { type: 'investor'|'company', rows: [{...}, ...] }
      const table = body.type === 'company' ? 'companies' : 'investors';
      const rows = (body.rows || []).map(r => Object.assign({}, r, { status: r.status || 'approved' }));
      const { data, error } = await sb.from(table).insert(rows).select();
      if (error) return _resp({ success: false, error: error.message }, 400);
      return _resp({ success: true, imported: (data || []).length });
    }
    if (route.startsWith('/admin/advisors')) {
      const { data } = await sb.from('advisors').select('*, users(email)').order('created_at', { ascending: false });
      return _resp({ advisors: data || [], total: (data||[]).length });
    }
    if (route.startsWith('/admin/partners')) {
      const { data } = await sb.from('partners').select('*').order('created_at', { ascending: false });
      return _resp({ partners: data || [], total: (data||[]).length });
    }
    if (route.startsWith('/admin/deal-rooms') || route.startsWith('/admin/deal_rooms')) {
      const drMatch = route.match(/\/admin\/deal[-_]rooms\/([^/?]+)/);
      if (method === 'GET') {
        const { data } = await sb.from('deal_rooms').select('*, companies(company_name)').order('created_at', { ascending: false });
        return _resp({ deal_rooms: data || [], total: (data||[]).length });
      }
      if (method === 'POST') {
        const { data: { user } } = await sb.auth.getUser();
        const { data } = await sb.from('deal_rooms').insert(Object.assign({}, body, { created_by: user && user.id })).select().single();
        return _resp({ success: true, deal_room: data }, 201);
      }
      if (drMatch && (method === 'PATCH' || method === 'PUT')) {
        const { data } = await sb.from('deal_rooms').update(body).eq('id', drMatch[1]).select().single();
        return _resp({ success: true, deal_room: data });
      }
      if (drMatch && method === 'DELETE') {
        await sb.from('deal_rooms').delete().eq('id', drMatch[1]);
        return _resp({ success: true });
      }
    }
    if (route.startsWith('/admin/introductions')) {
      const { data } = await sb.from('introductions').select('*').order('created_at', { ascending: false });
      return _resp({ introductions: data || [], total: (data||[]).length });
    }
    // ── Admin: invite user ───────────────────────────────────────────────────
    if (route.startsWith('/admin/invite') && method === 'POST') {
      const { email, role: inviteRole } = body;
      if (!email) return _resp({ error: 'Email required' }, 400);
      await sb.from('users').upsert({ email, role: inviteRole || 'applicant', status: 'invited' }, { onConflict: 'email' });
      logActivity('admin.invite', 'admin', `Invited ${email}`);
      return _resp({ success: true, message: `Invitation noted for ${email}. Direct them to banahub.com/register.` });
    }
    if (route.startsWith('/admin/grant-admin') && method === 'POST') {
      const { email } = body;
      if (!email) return _resp({ error: 'Email required' }, 400);
      const { data, error } = await sb.from('users').update({ role: 'admin' }).eq('email', email).select().single();
      if (error || !data) return _resp({ error: 'User not found with that email' }, 404);
      logActivity('admin.grant_admin', 'admin', `Granted admin to ${email}`);
      return _resp({ success: true, user: data });
    }

    if (route.startsWith('/admin/subscriptions')) {
      const { data } = await sb.from('subscriptions').select('*, users(email, full_name)').order('created_at', { ascending: false });
      return _resp({ subscriptions: data || [], total: (data||[]).length });
    }

    // ── ADMIN: generic entity status update ─────────────────────────────────
    const entityMatch = route.match(/^\/admin\/(companies|investors|advisors|partners|deal.rooms|introductions)\/([^/?]+)/);
    if (entityMatch && (method === 'PATCH' || method === 'PUT')) {
      const tbl = entityMatch[1].replace('-','_');
      const { data } = await sb.from(tbl).update(Object.assign({}, body, { updated_at: new Date().toISOString() })).eq('id', entityMatch[2]).select().single();
      return _resp({ success: true, data });
    }

    // ── ADMIN: enhanced stats ───────────────────────────────────────────────
    if (route.startsWith('/admin/stats')) {
      const [u, a, p, e, s, k, co, inv, adv, dr] = await Promise.all([
        sb.from('users').select('id', { count: 'exact', head: true }),
        sb.from('applications').select('id', { count: 'exact', head: true }),
        sb.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('events').select('id', { count: 'exact', head: true }),
        sb.from('newsletter_subscribers').select('id', { count: 'exact', head: true }).eq('is_active', true),
        sb.from('kyc_uploads').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('companies').select('id', { count: 'exact', head: true }),
        sb.from('investors').select('id', { count: 'exact', head: true }),
        sb.from('advisors').select('id', { count: 'exact', head: true }),
        sb.from('deal_rooms').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      ]);
      return _resp({
        total_users: u.count||0, total_applications: a.count||0,
        pending_applications: p.count||0, total_events: e.count||0,
        total_subscribers: s.count||0, pending_kyc: k.count||0,
        total_companies: co.count||0, total_investors: inv.count||0,
        total_advisors: adv.count||0, open_deal_rooms: dr.count||0,
      });
    }

    // ── 404 (return empty success so panels don't crash) ────────────────────
    console.warn('[BANAHub API] Unhandled route:', method, route);
    return _resp({ success: true, data: [], total: 0, _unhandled: route }, 200);

  } catch(err) {
    console.error('[BANAHub API Error]', err.message, route);
    return _resp({ success: false, detail: err.message, error: err.message }, 500);
  }
};

// ── apiFetch helper (used by login.html, register.html etc.) ──────────────────
window.apiFetch = async function(path, opts) {
  const p = path.startsWith('/api') ? path : '/api' + (path.startsWith('/') ? path : '/' + path);
  return window.fetch(p, opts || {});
};

// ── getCsrf (CSRF is handled by Supabase JWT — this is a stub for compatibility) ──
var _csrfToken = 'supabase-managed';
window.getCsrf = async function getCsrf(force) {
  return _csrfToken;
};
window.clearCsrfCache = function() {};

// ── Page CMS runtime: applies admin-published page edits on every public page ─
(function loadCms() {
  try {
    var p = location.pathname;
    if (/admin|dashboard|login|register|reset-password/.test(p)) return;
    if (document.querySelector('script[data-bana-cms]')) return;
    var sc = document.createElement('script');
    sc.src = '/cms.js?v=' + CONFIG.VERSION; sc.async = true; sc.setAttribute('data-bana-cms', '1');
    (document.head || document.documentElement).appendChild(sc);
  } catch (e) {}
})();
