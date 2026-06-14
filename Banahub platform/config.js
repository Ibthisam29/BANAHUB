// BANAHub — Supabase API Interceptor v2.2
// Intercepts ALL fetch('/api/*') calls and routes to Supabase.
// Fixes: error.detail format, all admin routes, role filters, KYC, content.

const CONFIG = {
  SUPABASE_URL: 'https://vapzyqcppimgignwbmda.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhcHp5cWNwcGltZ2lnbndibWRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNjkxODEsImV4cCI6MjA5NDc0NTE4MX0.UFmfs90fCuBea5J097iNInJdEjN4HX0wURYrhabr8xc',
  VERSION: '2.2.0',
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

// ── Fetch interceptor ─────────────────────────────────────────────────────────
const _nativeFetch = window.fetch.bind(window);
window.fetch = async function(input, opts) {
  opts = opts || {};
  const url = typeof input === 'string' ? input : (input && String(input.url || input)) || '';
  if (!url.startsWith('/api')) return _nativeFetch(input, opts);

  const route  = url.replace(/^\/api/, '') || '/';
  const method = ((opts.method) || 'GET').toUpperCase();
  const body   = _body(opts);

  const sb = await _getSB();
  if (!sb) return _resp({ detail: 'Backend unavailable', error: 'Backend unavailable' }, 503);

  try {

    // ── Health ──────────────────────────────────────────────────────────────
    if (route === '/' || route === '/health')
      return _resp({ status: 'ok', backend: 'Supabase' });

    // ── CSRF ────────────────────────────────────────────────────────────────
    if (route.includes('csrf'))
      return _resp({ csrf_token: 'supabase-managed' });

    // ── Auth: register ──────────────────────────────────────────────────────
    if (route.startsWith('/auth/register') && method === 'POST') {
      const { data, error } = await sb.auth.signUp({
        email: body.email, password: body.password,
        options: { data: { full_name: body.full_name, role: body.role || 'applicant',
                             company_name: body.company_name, country: body.country } },
      });
      if (error) return _resp({ success: false, detail: error.message, error: error.message }, 400);
      return _resp({ success: true, user_id: data.user && data.user.id }, 201);
    }

    // ── Auth: login ─────────────────────────────────────────────────────────
    if (route.startsWith('/auth/login') && method === 'POST') {
      const { data, error } = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
      if (error) return _resp({ success: false, detail: error.message, error: error.message }, 401);
      const { data: p } = await sb.from('users').select('*').eq('id', data.user.id).single();
      const user = Object.assign({}, { id: data.user.id, email: data.user.email }, p || {});
      return _resp({ success: true, user: user, csrf_token: 'supabase-managed',
                      access_token: data.session.access_token, refresh_token: data.session.refresh_token });
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
      const { data: p } = await sb.from('users').select('*').eq('id', user.id).single();
      return _resp({ success: true, user: Object.assign({}, { id: user.id, email: user.email }, p || {}) });
    }

    // ── Admin: stats ────────────────────────────────────────────────────────
    if (route.startsWith('/admin/stats')) {
      const [u, a, p, e, s, k] = await Promise.all([
        sb.from('users').select('id', { count: 'exact', head: true }),
        sb.from('applications').select('id', { count: 'exact', head: true }),
        sb.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('events').select('id', { count: 'exact', head: true }),
        sb.from('newsletter_subscribers').select('id', { count: 'exact', head: true }).eq('is_active', true),
        sb.from('kyc_uploads').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);
      return _resp({ total_users: u.count||0, total_applications: a.count||0,
                      pending_applications: p.count||0, total_events: e.count||0,
                      total_subscribers: s.count||0, pending_kyc: k.count||0 });
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
      const { data } = await sb.from('kyc_uploads').insert(Object.assign({}, body, { user_id: user.id })).select().single();
      return _resp({ success: true, kyc: data }, 201);
    }

    // ── Admin content: articles ─────────────────────────────────────────────
    if (route.startsWith('/admin/content/articles') || route.startsWith('/admin/content') && method === 'GET') {
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
