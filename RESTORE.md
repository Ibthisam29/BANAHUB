# BANAHub — Restore Missing Files

Your last GitHub upload replaced the entire `Banahub platform/` folder
with a single stray `admin.html` at the repo root. Everything else the
site depends on was lost from the repo. This package is the complete,
verified replacement.

## What's in this package
The full, current `Banahub platform/` folder — every file the site
needs, cumulative from every fix across this whole project:

- admin.html, config.js, api.js — core app + backend routes
- index.html, login.html, register.html, dashboard.html, platform.html
- events.html, programs.html, payment-success.html
- output.css, input.css, tailwind.config.js, brand-glass.css, glass-theme.css
- favicon.ico, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png,
  icon-192.png, icon-512.png, logo.png, logo-icon-512.png, assets/
- 404.html, package.json, _headers, _redirects, SETUP_GUIDE.md

All of it re-verified before packaging: zero syntax errors, zero
duplicate element IDs, zero broken function references across
admin.html, index.html, events.html, and programs.html.

## Exact steps

1. **On GitHub, delete these from the repo root** (not inside any folder):
   - `admin.html` (the stray one — the correct one is in this package)
   - `files (10).zip`
   - `files (13).zip`

2. **Delete your entire existing `Banahub platform/` folder** in the repo
   (whatever's left of it) and **replace it wholesale** with the
   `Banahub platform/` folder from this package. Don't merge file-by-file —
   just overwrite the whole folder so nothing stale is left behind.

3. **Do this with `git`, not the GitHub web upload button.** The web
   "Add file → Upload files" button is what caused this — it drops files
   wherever you are in the folder browser and is easy to get wrong.
   From your local clone:
   ```
   git pull
   rm -rf "Banahub platform"
   # copy this package's "Banahub platform" folder into the repo root
   rm -f admin.html "files (10).zip" "files (13).zip"
   git add -A
   git commit -m "Restore Banahub platform folder — fix broken deploy"
   git push
   ```

4. **Confirm `vercel.json` still has** `"outputDirectory": "Banahub platform"`
   — it should already, this package doesn't touch it. Once pushed,
   Vercel redeploys automatically; watch the deploy log to confirm it
   succeeds (a missing output directory was very likely failing builds
   silently while Vercel kept serving your last good deploy).

## Still separate — not in Git, run these yourself
- `security_hardening.sql` → Supabase SQL editor
- Edge Functions (`create-checkout-session`, `stripe-webhook`,
  `luma-sync-event`, `luma-sync-guests`, `notify-admin-login-attempt`)
  → `supabase functions deploy <name>`

If you don't still have those from earlier, say so and I'll repackage them too.
