// BANAHub api.js — convenience wrapper (config.js handles the real work)
// apiFetch is already defined in config.js — this adds window.api.* helpers.

window.api = {
  login:              (e, p)    => apiFetch('/api/auth/login',  { method: 'POST', body: JSON.stringify({ email: e, password: p }) }).then(r => r.json()),
  logout:             ()        => apiFetch('/api/auth/logout', { method: 'POST' }).then(r => r.json()),
  me:                 ()        => apiFetch('/api/auth/me').then(r => r.json()),
  register:           (data)    => apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }).then(r => r.json()),
  getAdminStats:      ()        => apiFetch('/api/admin/stats').then(r => r.json()),
  getAllUsers:         ()        => apiFetch('/api/admin/users').then(r => r.json()),
  getAllApplications:  (status)  => apiFetch('/api/admin/applications' + (status ? '?status=' + status : '')).then(r => r.json()),
  getMyApplications:  ()        => apiFetch('/api/applications').then(r => r.json()),
  submitApplication:  (data)    => apiFetch('/api/applications', { method: 'POST', body: JSON.stringify(data) }).then(r => r.json()),
  updateApplication:  (id, d)   => apiFetch('/api/applications/' + id, { method: 'PATCH', body: JSON.stringify(d) }).then(r => r.json()),
  updateUser:         (id, d)   => apiFetch('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify(d) }).then(r => r.json()),
  getEvents:          ()        => apiFetch('/api/events').then(r => r.json()),
  subscribe:          (e, n)    => apiFetch('/api/newsletter/subscribe', { method: 'POST', body: JSON.stringify({ email: e, name: n }) }).then(r => r.json()),
};
