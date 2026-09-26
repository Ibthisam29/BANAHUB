# BANAHub — Setup & Deployment Guide
**Three standalone HTML files. Zero dependencies. Deploy anywhere in minutes.**

---

## What You Have

| File | Purpose | URL (after deploy) |
|------|---------|-------------------|
| `banahub-website.html` | Public marketing site | `banahub.com` |
| `banahub-platform.html` | Member dashboard (all roles) | `app.banahub.com` or `banahub.com/platform` |
| `banahub-admin.html` | Admin operations panel | `admin.banahub.com` or password-protected |

All three files are **self-contained** — no build step, no npm, no backend needed for the frontend. Each runs by itself in any browser.

---

## Option A — Vercel (Recommended, Free)

### Step 1: Create your GitHub repository
```bash
# Create a folder and add your files
mkdir banahub && cd banahub
# Copy your 3 HTML files here
# Rename them:
mv banahub-website.html   index.html
mv banahub-platform.html  platform.html
mv banahub-admin.html     admin.html
```

### Step 2: Push to GitHub
```bash
git init
git add .
git commit -m "Initial BANAHub build"
git remote add origin https://github.com/YOUR_USERNAME/banahub.git
git push -u origin main
```

### Step 3: Deploy to Vercel
1. Go to **vercel.com** → Sign up / log in
2. Click **"Add New Project"**
3. Import your GitHub repo
4. Click **Deploy** — Vercel auto-detects the HTML files
5. Your site is live at `your-project.vercel.app`

### Step 4: Add your domain (banahub.com)
1. In Vercel dashboard → **Settings → Domains**
2. Add `banahub.com` and `www.banahub.com`
3. Update your DNS (wherever you registered the domain):
   - Add a **CNAME record**: `www` → `cname.vercel-dns.com`
   - Add an **A record**: `@` → `76.76.19.61`
4. SSL/HTTPS is automatic — takes ~5 minutes

### File routing on Vercel
Create a `vercel.json` file:
```json
{
  "routes": [
    { "src": "/", "dest": "/index.html" },
    { "src": "/platform", "dest": "/platform.html" },
    { "src": "/admin", "dest": "/admin.html" }
  ]
}
```

---

## Option B — Netlify (Also Free)

1. Go to **netlify.com**
2. Drag and drop your **folder** directly onto the Netlify dashboard
3. Your site is live instantly at `random-name.netlify.app`
4. Add custom domain in **Site Settings → Domain Management**

To rename files for clean URLs, create a `_redirects` file:
```
/platform    /platform.html    200
/admin       /admin.html       200
```

---

## Option C — GitHub Pages (Free)

1. Create a GitHub repo named `banahub` (or your username.github.io)
2. Go to **Settings → Pages → Source: main branch**
3. Site is live at `username.github.io/banahub`

---

## Option D — cPanel / Shared Hosting (e.g. Hostinger, SiteGround)

1. Log into your hosting control panel
2. Open **File Manager** → navigate to `public_html`
3. Upload your 3 HTML files
4. Rename `banahub-website.html` → `index.html`
5. Done. Files are live at your domain immediately.

---

## Protecting the Admin Panel

Since `admin.html` contains sensitive operations, **restrict access before going live**:

### Option 1 — Vercel Password Protection (Simplest)
In `vercel.json`:
```json
{
  "routes": [
    {
      "src": "/admin",
      "headers": { "x-robots-tag": "noindex" },
      "dest": "/admin.html"
    }
  ]
}
```
Then enable **Vercel Authentication** in project settings (requires Pro plan) or use a separate deployment for admin.

### Option 2 — Add a PIN gate to admin.html (Free)
Open `banahub-admin.html` and add this at the very top of `<script>`:
```javascript
// Simple PIN protection — change '2025bana' to your own password
const ADMIN_PIN = '2025bana';
if (sessionStorage.getItem('adminAuth') !== ADMIN_PIN) {
  const pin = prompt('BANAHub Admin — Enter access code:');
  if (pin !== ADMIN_PIN) {
    document.body.innerHTML = '<div style="text-align:center;padding:100px;color:#fff;background:#07080e;height:100vh;font-family:sans-serif"><h2>Access Denied</h2></div>';
    throw new Error('Unauthorized');
  }
  sessionStorage.setItem('adminAuth', ADMIN_PIN);
}
```

### Option 3 — Separate subdomain with HTTP auth (via Netlify/Vercel)
Host `admin.html` as a completely separate Vercel/Netlify project at `admin.banahub.com` with password protection enabled.

---

## Connecting to Real Data (Phase 2)

The files currently use mock/demo data. When you're ready to connect a real backend:

### Recommended stack
```
Supabase (free tier available)  ←→  These HTML files
  - Postgres database
  - Auth (email/password)
  - Storage (file uploads)
  - Row Level Security (RLS)
```

### Quick Supabase setup
1. Go to **supabase.com** → Create project → Region: Southeast Asia (Singapore)
2. Copy your **Project URL** and **Anon Key** from Settings → API
3. In each HTML file, replace the mock data with Supabase calls:

```javascript
// Add this script tag to your HTML files
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

// Initialize
const supabase = supabase.createClient(
  'https://YOUR_PROJECT.supabase.co',
  'YOUR_ANON_KEY'
);

// Example: Load users in admin panel
const { data: users } = await supabase
  .from('users')
  .select('*')
  .order('created_at', { ascending: false });
```

### Payments with Stripe
1. Create a Stripe account at **stripe.com**
2. For the modal forms (Get Started, Enroll), replace the `alert` with a real Stripe Checkout:

```javascript
// Replace openModal submit buttons with:
window.location.href = 'https://buy.stripe.com/YOUR_PAYMENT_LINK';
// OR use Stripe Checkout sessions via a serverless function
```

### Email with Resend
1. Sign up at **resend.com** (free for 3,000 emails/month)
2. Use their API to send confirmation emails on form submission

---

## Customising the Content

### Update your company info
Search and replace across all 3 files:
- `Bana Private Limited` → Your legal entity name
- `banahub.com` → Your actual domain
- `Singapore` → Your registration country (keep Singapore if that's correct)

### Update program prices
In `banahub-website.html`, find the `PROGRAMS` data array and update prices:
```javascript
{price:'S$2,800'} // Change to your actual price
```

### Update advisor profiles
In `banahub-website.html`, find the advisor cards section and update:
- Names, roles, bios, availability
- Session counts (can remove until you have real data)

### Change the colour scheme
All three files use CSS variables at the top of `<style>`. To change the primary teal colour to another:
```css
:root {
  --teal: #1dc9a8;     /* Change this to your brand colour */
  --teal2: rgba(29,201,168,.12); /* Update alpha version too */
}
```

### Add your logo
Replace the text logo with an image:
```html
<!-- Find the .sb-lm div and replace with: -->
<img src="/your-logo.png" style="width:28px;height:28px;border-radius:5px"/>
```

---

## SEO & Analytics

### Add to `banahub-website.html` `<head>`:
```html
<!-- SEO -->
<meta name="description" content="BANAHub — GTM Advisory, Market Expansion, Training for Southeast Asia"/>
<meta property="og:title" content="BANAHub — GTM & Growth Platform"/>
<meta property="og:description" content="Premium advisory and training for SEA founders and businesses"/>
<meta property="og:image" content="https://banahub.com/og-image.png"/>

<!-- Google Analytics (replace G-XXXXXXXX with your ID) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXX');
</script>
```

---

## Launch Checklist

- [ ] All 3 files uploaded / deployed
- [ ] `index.html` (website) loads at your domain root
- [ ] `/platform` loads the member dashboard
- [ ] `/admin` is password-protected
- [ ] Domain DNS pointing correctly (A + CNAME records)
- [ ] HTTPS/SSL active (auto on Vercel/Netlify)
- [ ] Email address in footer/contact form is correct
- [ ] MAS disclaimer visible on Capital Matching page
- [ ] Google Analytics or similar tracking added
- [ ] Test all modal forms (Get Started, Sign In, Contact)
- [ ] Test on mobile (iPhone + Android)

---

## Quick Help

**Q: The fonts aren't loading**
A: Fonts load from Google Fonts — requires internet connection. For offline/intranet, download fonts and serve locally.

**Q: I want a custom login that actually works**
A: Add Supabase Auth (see Phase 2 section above). It takes about 2 hours to implement basic email/password login.

**Q: Can I use this on WordPress?**
A: Yes — use an HTML embed plugin or upload the files to your server and link to them directly.

**Q: How do I add more pages?**
A: In `banahub-website.html`, the navigation and sections are clearly labelled. Copy a section block, update the content, and add a nav link.

---

## Support

For platform questions or customisation help:
**hello@banahub.com** (update this with your real email)

---

*BANAHub Platform v2.1 · Built by Bana Private Limited, Singapore*
*Not licensed by MAS · Capital matching is an introduction service only*
