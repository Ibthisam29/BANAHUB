// BANAHub — Supabase API Interceptor v2.2
// Intercepts ALL fetch('/api/*') calls and routes to Supabase.
// Fixes: error.detail format, all admin routes, role filters, KYC, content.

const CONFIG = {
  SUPABASE_URL: 'https://ositmmczozefrdzcgxrp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zaXRtbWN6b3plZnJkemNneHJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjA0NjcsImV4cCI6MjA4OTY5NjQ2N30.waj1tkuz5M5kGRNa3qmo_DKt_2tslXX2W5Z_5jwpxiY',
  VERSION: '2.3.0',
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
        options: { data: { full_name: body.full_name || '', role: body.role || 'applicant' } },
      });
      if (error) return _resp({ success: false, detail: error.message, error: error.message }, 400);
      if (data && data.user) {
        // Upsert into users table
        await sb.from('users').upsert({
          id: data.user.id,
          email: body.email,
          full_name: body.full_name || '',
          role: body.role || 'applicant',
          company_name: body.company_name || null,
          country: body.country || null,
          phone: body.phone || null,
          status: 'pending',
        }, { onConflict: 'email' });
        // Auto sign in
        const { data: loginData } = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
        const { data: userRow } = await sb.from('users').select('*').eq('email', body.email).single();
        const user = Object.assign({}, { id: data.user.id, email: body.email }, userRow || {});
        return _resp({ success: true, user, access_token: loginData?.session?.access_token, refresh_token: loginData?.session?.refresh_token }, 201);
      }
      return _resp({ success: true, user_id: data.user && data.user.id }, 201);
    }

    // ── Auth: login ─────────────────────────────────────────────────────────
    if (route.startsWith('/auth/login') && method === 'POST') {
      const { data, error } = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
      if (error) return _resp({ success: false, detail: error.message, error: error.message }, 401);
      // Get from users table (has role, status)
      const { data: p } = await sb.from('users').select('*').eq('email', body.email).single();
      // If user not in users table yet, create record
      if (!p) {
        await sb.from('users').upsert({
          id: data.user.id, email: body.email,
          full_name: data.user.user_metadata?.full_name || '',
          role: data.user.user_metadata?.role || 'applicant',
          status: 'pending',
        }, { onConflict: 'email' });
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
      const { data: p } = await sb.from('users').select('*').eq('email', user.email).single();
      const merged = Object.assign({}, { id: user.id, email: user.email }, p || {});
      return _resp({ success: true, user: merged });
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
      const { data } = await sb.from('investors').select('*, users(email)').order('created_at', { ascending: false });
      return _resp({ investors: data || [], total: (data||[]).length });
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
      const { data } = await sb.from('deal_rooms').select('*, companies(company_name)').order('created_at', { ascending: false });
      return _resp({ deal_rooms: data || [], total: (data||[]).length });
    }
    if (route.startsWith('/admin/introductions')) {
      const { data } = await sb.from('introductions').select('*').order('created_at', { ascending: false });
      return _resp({ introductions: data || [], total: (data||[]).length });
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
