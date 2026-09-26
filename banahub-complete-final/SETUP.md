# BANAHub — Complete Final Package
## Upload Instructions

---

## HOW TO UPLOAD (GitHub Desktop — required, not the web upload button)

1. Install GitHub Desktop → desktop.github.com → sign in
2. File → Clone Repository → `Ibthisam29/BANAHUB`
3. Open the cloned folder in Finder / File Explorer
4. Copy `Banahub platform/` from this package into `banahub-complete-package/`
   (overwriting all existing files — it must land at
   `banahub-complete-package/Banahub platform/`)
5. Copy `vercel.json` from this package to the REPO ROOT
   (replaces the existing one — adds 6 new clean URL routes)
6. In GitHub Desktop: review the changed files list on the left
7. Write a commit message → Commit to main → Push origin
8. Vercel auto-deploys in ~60 seconds

---

## NEW PAGES IN THIS PACKAGE

| File | Clean URL | Purpose |
|------|-----------|---------|
| `membership.html` | `/membership` `/join` | $8/month or $88/year signup with Stripe |
| `program-register.html` | `/program-register` | Register interest in a specific program |
| `fundraise.html` | `/fundraise` `/raise` | 3-step capital raise campaign registration |
| `reset-password.html` | `/reset-password` | Request a password reset link |
| `reset-password-confirm.html` | — | Catches the emailed reset link, sets new password |

---

## WHAT WAS FIXED IN THIS PACKAGE

### register.html
- All select dropdowns now have IDs — previously institution type, AUM range,
  and region were silently dropped on submit
- Fake CSRF token (`csrfBeforeRegister`) removed — was causing a JS error
- KYC file now uploads to real Supabase Storage (not fake base64)
- Application details now actually save to the `applications` table

### index.html
- Enquiry modal (`handleModalSubmit`) now submits to the real `/enquiries`
  API endpoint — previously it just showed a fake success animation and
  discarded all data
- "Raise Capital" added to main nav → `fundraise.html`
- "Join $8/mo" added to nav → `membership.html`
- Cohort apply button → `program-register.html`

### admin.html
- `openInviteModal` — real modal, sends invite record to database
- `openAddAdminModal` — real modal, grants admin role to existing user email
- `openBusinessModal/openInvestorModal/openProviderModal` — no longer fake stubs
- Real `changePassword()` — calls `sb.auth.updateUser`, min 12 chars + complexity
- **Members panel** — new sidebar item showing all subscriptions with Stripe links
- **FundMatch, CRM, Network, Strategy, Sponsorship** — all built in previous round
- Zero "coming soon" stubs remain anywhere

### config.js
- `/api/applications/submit` — saves institution details
- `/api/kyc/upload` — records KYC file metadata
- `/api/programs/register` — program application to enquiries table
- `/api/newsletter/subscribe` — newsletter signup
- `/api/membership/checkout` — Stripe Checkout for $8/mo or $88/yr
- `/api/admin/invite` — invite user by email
- `/api/admin/grant-admin` — promote user to admin

---

## SUPABASE SQL — run in this order

```sql
-- 1. Core tables (users, companies, events, etc.)
supabase/sql/01_base_schema.sql

-- 2. Security, programs, payments, Luma, activity logs
supabase/sql/02_security_hardening.sql

-- 3. Sponsorship packages (virtual/in-person, speaking/booth)
supabase/sql/03_sponsorship_packages.sql

-- 4. Founder Pitch Readiness Audit ($82 program)
supabase/sql/04_pitch_readiness_service.sql

-- 5. Admin expansion: blocked column, LinkedIn fields, deal room fields, video_url
supabase/sql/05_admin_expansion.sql
```

---

## STRIPE SETUP

1. Stripe Dashboard → Developers → Webhooks → Add endpoint:
   `https://mfqdqisbryoepdpqebkb.supabase.co/functions/v1/stripe-webhook`
   Events: `checkout.session.completed`, `checkout.session.expired`

2. Deploy Edge Functions:
   ```bash
   supabase functions deploy create-checkout-session
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```

3. Set secrets:
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   supabase secrets set SITE_URL=https://www.banahub.com
   ```

---

## ADMIN ACCOUNT (one-time if not done)

1. Register at banahub.com/register
2. SQL Editor: `update users set role = 'admin' where email = 'ibthisam@banahub.com';`
3. Log in at banahub.com/login → redirected to admin panel

---

## FORM → ADMIN SYNC

| Form | Table | Admin panel |
|------|-------|-------------|
| Institutional registration | `applications` | Applications |
| Program registration request | `enquiries` (source: program_request) | Enquiries |
| Fundraise campaign registration | `enquiries` (source: fundraise_campaign) | Enquiries |
| General enquiry (homepage modal) | `enquiries` (source: contact_form) | Enquiries |
| Membership signup $8/mo or $88/yr | `subscriptions` + Stripe | Members |
| KYC document upload | `kyc_uploads` + Storage | KYC |
| Newsletter signup | `newsletter_subscribers` | Subscribers |
