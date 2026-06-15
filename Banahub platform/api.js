// BANAHub api.js — convenience wrapper
// config.js handles the Supabase fetch interceptor.
// This adds the Authorization header injection + window.api.* helpers.

// ── Inject stored access token into every apiFetch call ────────────────────
const _originalApiFetch = window.apiFetch;
window.apiFetch = async function(path, opts) {
  opts = opts || {};
  const token = localStorage.getItem('bana_access_token');
  if (token) {
    opts.headers = Object.assign({}, opts.headers || {}, {
      'Authorization': 'Bearer ' + token,
    });
  }
  return _originalApiFetch(path, opts);
};

// ── window.api.* helpers ────────────────────────────────────────────────────
window.api = {
  login:             (e, p)    => apiFetch('/api/auth/login',  { method:'POST', body:JSON.stringify({email:e,password:p}) }).then(r=>r.json()),
  logout:            ()        => apiFetch('/api/auth/logout', { method:'POST' }).then(r=>r.json()),
  me:                ()        => apiFetch('/api/auth/me').then(r=>r.json()),
  register:          (data)    => apiFetch('/api/auth/register', { method:'POST', body:JSON.stringify(data) }).then(r=>r.json()),

  // Admin
  getAdminStats:     ()        => apiFetch('/api/admin/stats').then(r=>r.json()),
  getAllUsers:        (role)    => apiFetch('/api/admin/users'+(role?'?role='+role:'')).then(r=>r.json()),
  getAllApplications: (status)  => apiFetch('/api/admin/applications'+(status?'?status='+status:'')).then(r=>r.json()),
  updateUser:        (id,d)    => apiFetch('/api/admin/users/'+id, {method:'PATCH',body:JSON.stringify(d)}).then(r=>r.json()),
  updateApplication: (id,d)    => apiFetch('/api/applications/'+id, {method:'PATCH',body:JSON.stringify(d)}).then(r=>r.json()),
  getAdminCompanies: ()        => apiFetch('/api/admin/companies').then(r=>r.json()),
  getAdminInvestors: ()        => apiFetch('/api/admin/investors').then(r=>r.json()),
  getAdminAdvisors:  ()        => apiFetch('/api/admin/advisors').then(r=>r.json()),
  getAdminPartners:  ()        => apiFetch('/api/admin/partners').then(r=>r.json()),
  getAdminDealRooms: ()        => apiFetch('/api/admin/deal-rooms').then(r=>r.json()),
  getAdminCRM:       (stage)   => apiFetch('/api/admin/crm'+(stage?'?stage='+stage:'')).then(r=>r.json()),
  updateEntity:      (type,id,d) => apiFetch('/api/admin/'+type+'/'+id, {method:'PATCH',body:JSON.stringify(d)}).then(r=>r.json()),

  // Member
  getMyApplications: ()        => apiFetch('/api/applications').then(r=>r.json()),
  submitApplication: (data)    => apiFetch('/api/applications', {method:'POST',body:JSON.stringify(data)}).then(r=>r.json()),
  getCompanies:      (f)       => apiFetch('/api/companies'+(f?'?'+new URLSearchParams(f):'')).then(r=>r.json()),
  getInvestors:      (f)       => apiFetch('/api/investors'+(f?'?'+new URLSearchParams(f):'')).then(r=>r.json()),
  getAdvisors:       ()        => apiFetch('/api/advisors').then(r=>r.json()),
  getPartners:       ()        => apiFetch('/api/partners').then(r=>r.json()),
  getDealRooms:      ()        => apiFetch('/api/deal-rooms').then(r=>r.json()),
  getMessages:       ()        => apiFetch('/api/messages').then(r=>r.json()),
  sendMessage:       (data)    => apiFetch('/api/messages', {method:'POST',body:JSON.stringify(data)}).then(r=>r.json()),
  requestIntro:      (data)    => apiFetch('/api/introductions', {method:'POST',body:JSON.stringify(data)}).then(r=>r.json()),

  // Public
  getEvents:         ()        => apiFetch('/api/events').then(r=>r.json()),
  subscribe:         (e,n)     => apiFetch('/api/newsletter/subscribe', {method:'POST',body:JSON.stringify({email:e,name:n||''})}).then(r=>r.json()),

  // Helpers
  signOut: function() {
    apiFetch('/api/auth/logout', {method:'POST'}).catch(()=>{});
    localStorage.removeItem('bana_user');
    localStorage.removeItem('bana_access_token');
    localStorage.removeItem('bana_refresh_token');
    window.location.href = 'login.html';
  },
  currentUser: function() {
    const u = localStorage.getItem('bana_user');
    return u ? JSON.parse(u) : null;
  },
};
