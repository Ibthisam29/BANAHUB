# BANAHub — Vercel Deployment Guide

## ✅ What's Ready

Your BANAHub repository is now fully configured for deployment on **Vercel**.

### Files Configured
- ✅ `vercel.json` — Static deployment with clean URL routing
- ✅ `_redirects` — Netlify redirect rules (compatible with Vercel)
- ✅ `_headers` — Security headers and cache policies
- ✅ All HTML files (index.html, platform.html, admin.html, login.html, register.html, dashboard.html)
- ✅ CSS and JavaScript files
- ✅ Supabase integration via `config.js`

---

## 🚀 Quick Deploy to Vercel (5 minutes)

### Step 1: Push to GitHub (Already Done ✓)

Your code is already in GitHub at:
```
https://github.com/Ibthisam29/BANAHUB
```

### Step 2: Connect Vercel

1. Go to **[vercel.com](https://vercel.com)**
2. Click **"Add New"** → **"Project"**
3. **Import GitHub Repository**
   - Select **Ibthisam29/BANAHUB**
   - Root Directory: Leave blank (defaults to root)
   - Framework: **Other** (static HTML)
   - Build Command: Leave blank
   - Output Directory: Leave blank
4. Click **Deploy**

✅ **Your site is now live** at `https://banahub-[random].vercel.app`

### Step 3: Add Custom Domain

1. In Vercel dashboard → **Settings → Domains**
2. Add your domain: `banahub.com`
3. Follow the DNS instructions (A record + CNAME)
4. SSL/HTTPS is **automatic** (takes ~5 min)

---

## 🔧 Routing

All URLs are automatically cleaned:

| Request | Serves |
|---------|--------|
| `/` | `index.html` (landing) |
| `/platform` | `platform.html` (member dashboard) |
| `/admin` | `admin.html` (admin panel) |
| `/login` | `login.html` |
| `/register` or `/apply` | `register.html` |
| `/dashboard` | `dashboard.html` |

---

## 🔒 Security

All files include security headers:

- ✅ **X-Frame-Options: DENY** — Prevents clickjacking
- ✅ **X-Content-Type-Options: nosniff** — Prevents MIME-type sniffing
- ✅ **Strict-Transport-Security** — Enforces HTTPS
- ✅ **Permissions-Policy** — Disables camera, microphone, geolocation

---

## 💾 Caching Strategy

- **HTML files**: Cache busted (max-age=0) — Always fresh
- **CSS files**: 24-hour cache + 7-day stale-while-revalidate
- **JS files**: 1-hour cache + 24-hour stale-while-revalidate

---

## 🗄️ Backend (Supabase)

Your frontend is already connected to **Supabase** via `config.js`:

- 📧 Email/Password Auth
- 💾 Database: users, applications, events, newsletters, KYC uploads
- 🔐 Row-Level Security (RLS) for data privacy
- 📁 File storage for KYC documents

The `config.js` file intercepts all `/api/*` calls and routes them to Supabase automatically.

---

## 🛡️ Admin Panel Protection

The admin.html file has built-in PIN protection. **First login PIN: `2025bana`**

Change it in `admin.html` by searching for `ADMIN_PIN` and updating the value.

---

## 📋 Launch Checklist

- [ ] Deploy to Vercel (Step 2 above)
- [ ] Test homepage: `https://banahub-[random].vercel.app/`
- [ ] Test platform: `https://banahub-[random].vercel.app/platform`
- [ ] Test login: `https://banahub-[random].vercel.app/login`
- [ ] Test admin (PIN: `2025bana`): `https://banahub-[random].vercel.app/admin`
- [ ] Update DNS records for custom domain
- [ ] Verify HTTPS works
- [ ] Test on mobile (iPhone + Android)
- [ ] Share live link!

---

## 🐛 Troubleshooting

### "Fonts not loading"
→ Fonts load from Google Fonts CDN. Check internet connection. For offline use, download fonts locally.

### "Auth not working"
→ Supabase connection may be loading. Check browser console (F12) for errors. Reload page.

### "Admin PIN not working"
→ Clear browser cache and cookies, then reload. Or use incognito window.

### "Custom domain not resolving"
→ DNS changes take 5-30 minutes. Check your domain registrar's NS records point to Vercel.

---

## 📞 Support

For questions:
- 📧 Email: contact@banahub.com
- 🔗 GitHub Issues: [github.com/Ibthisam29/BANAHUB/issues](https://github.com/Ibthisam29/BANAHUB/issues)

---

**Built with:** HTML + CSS + JavaScript + Supabase + Vercel
**Status:** ✅ Ready for production
**Last Updated:** 2026-06-14
