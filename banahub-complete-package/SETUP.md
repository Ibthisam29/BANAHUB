# BANAHub — Complete Package

Everything the site needs, current and verified. One setup path, start
to finish. Use **GitHub Desktop** for the file placement, not GitHub's
web "Upload files" button — manual copy-paste through the browser has
gone wrong repeatedly on files this size.

---

## 1. Site files → `Banahub platform/`

Copy everything from this package's `Banahub platform/` folder into
your repo's `Banahub platform/` folder, **overwriting all existing
files**. This is the entire site: admin, public pages, login/register,
events, programs, payments, password reset — 30+ files, all verified
together (zero syntax errors, zero duplicate IDs, zero broken function
references — checked immediately before packaging).

Delete any stray `config.js`, `admin.html`, `.sql` files, or `.zip`
files sitting at your **repo root** (outside `Banahub platform/`) from
earlier attempts — they do nothing there and only cause confusion
about which copy is real.

## 2. Database → Supabase SQL Editor, in this exact numbered order

| File | What it does |
|---|---|
| `supabase/sql/01_base_schema.sql` | Core tables that predate this project: users, applications, companies, investors, advisors, KYC, deal rooms, messages, CRM, subscriptions, newsletter, articles, media, pages, base events. **Also creates the `media` Storage bucket** — required for file upload to work. |
| `supabase/sql/02_security_hardening.sql` | Everything built on top: programs, payments/transactions, Luma integration, login rate-limiting + attempt logging, activity logs, partners, access requests, enquiries, site settings/SEO/pages CMS. |
| `supabase/sql/03_sponsorship_packages.sql` | Virtual/in-person sponsorship tiers (speaking, booth, general) with Stripe checkout support. Seeded with 5 starter packages, **unpublished at $0** — set real prices in Admin → Sponsorship before publishing. |
| `supabase/sql/04_pitch_readiness_service.sql` | Founder Pitch Readiness Audit, $82 flat fee, listed as a Program. |

## 3. Edge Functions → Supabase CLI (not part of Git)

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy luma-sync-event
supabase functions deploy luma-sync-guests
supabase functions deploy notify-admin-login-attempt
```

Then set secrets (`supabase secrets set KEY=value`):
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `LUMA_API_KEY` (requires Luma Plus, $59/mo)
- `RESEND_API_KEY`, `ADMIN_ALERT_EMAIL`

**Stripe Dashboard → Webhooks** → add endpoint:
`https://mfqdqisbryoepdpqebkb.supabase.co/functions/v1/stripe-webhook`
→ send `checkout.session.completed` and `checkout.session.expired`.

## 4. Supabase Auth settings (dashboard, not code)

**Authentication → URL Configuration → Redirect URLs**, add:
`https://www.banahub.com/reset-password-confirm.html`

## 5. Create your admin account

1. Register normally through `banahub.com/register.html`
2. In Supabase SQL Editor:
   ```sql
   update users set role = 'admin' where email = 'you@banahub.com';
   ```
3. Log in at `banahub.com/login.html` with that email + the password
   you set at registration — that's your admin login.

## 6. Keep the free-tier project alive

`.github/workflows/keep-supabase-alive.yml` — pings Supabase 3x/week
so the free tier doesn't auto-pause after 7 days idle. Needs two repo
secrets (Settings → Secrets and variables → Actions):
- `SUPABASE_URL` = `https://mfqdqisbryoepdpqebkb.supabase.co`
- `SUPABASE_ANON_KEY` = your anon/publishable key

Test it manually once: repo → **Actions** tab → the workflow →
**Run workflow**.

---

## What's actually in this build

**Public site:** home, programs, events (with sponsorship packages),
password reset flow, semi-glassmorphism theme throughout, favicon from
your logo.

**Admin (16 panels, all real — none are stubs):** Dashboard, Users,
Investors, Businesses, Applications, Events, Programs, Sponsorship,
Partners, KYC, Payments, Access Requests, Enquiries, Activity Logs,
Media Library (real file upload to Storage), Settings/SEO/Pages CMS.

**Payments:** Stripe Checkout for programs, events, and sponsorship
packages — price always looked up server-side, never trusted from the
browser; a payment can only be marked complete by a signature-verified
Stripe webhook, never by any client request.

**Security:** RLS on every table, admin role checked server-side
against `users.role` (not a client-trusted flag), login rate-limiting
(5 fails / 15 min), every login attempt logged, admin account login
attempts email-alert you, session cookies HttpOnly, CSRF tokens on
state-changing requests.

## Verify before testing in a browser

Once pushed, tell me and I'll re-clone the repo directly and confirm
the live content actually matches this package before you spend time
testing anything live.
