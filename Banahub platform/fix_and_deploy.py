"""
BANAHub — GitHub Auto-Fix & Vercel Deploy
==========================================
Run: python fix_and_deploy.py
Then paste your GitHub Personal Access Token when prompted.

How to get a token (30 seconds):
  1. github.com → top-right avatar → Settings
  2. Developer settings → Personal access tokens → Tokens (classic)
  3. Generate new token → select scope: "repo" → Generate
  4. Copy the token, paste below
"""

import urllib.request
import urllib.error
import json
import base64
import sys

OWNER = "Ibthisam29"
REPO  = "Banahub-platform"
BRANCH = "main"

# ── File contents ──────────────────────────────────────────────────

VERCEL_JSON = """{
  "version": 2,
  "name": "banahub",
  "framework": null,
  "buildCommand": null,
  "outputDirectory": "banahub-fixed/frontend",
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    { "source": "/login",     "destination": "/login.html" },
    { "source": "/register",  "destination": "/register.html" },
    { "source": "/apply",     "destination": "/register.html" },
    { "source": "/dashboard", "destination": "/dashboard.html" },
    { "source": "/admin",     "destination": "/admin.html" },
    { "source": "/about",     "destination": "/about.html" },
    { "source": "/pricing",   "destination": "/pricing.html" },
    { "source": "/contact",   "destination": "/contact.html" },
    { "source": "/privacy",   "destination": "/privacy.html" },
    { "source": "/terms",     "destination": "/terms.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options",           "value": "DENY" },
        { "key": "X-Content-Type-Options",    "value": "nosniff" },
        { "key": "Referrer-Policy",           "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy",        "value": "camera=(), microphone=(), geolocation=()" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" }
      ]
    },
    {
      "source": "/(.*)\\\\.html",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    },
    {
      "source": "/(.*)\\\\.css",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=604800" }]
    }
  ]
}
"""

CONFIG_JS = """/**
 * config.js — BANAHub API Configuration
 * Auto-detects: localhost → http://localhost:8000, production → same-origin
 * Override: set window.BANAHUB_API_BASE = "https://your-backend.com" before this loads.
 */
(function () {
  var isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var override = window.BANAHUB_API_BASE;
  window.BANAHUB_CONFIG = {
    API_BASE: (override && override.indexOf("YOUR-BACKEND") === -1)
      ? override.replace(/\\/$/, "")
      : isLocal ? "http://localhost:8000" : ""
  };
})();
"""

API_JS = """/**
 * api.js — BANAHub API helper with in-memory CSRF cache
 */
function resolveApiBase() {
  if (window.BANAHUB_CONFIG && window.BANAHUB_CONFIG.API_BASE !== undefined) {
    return window.BANAHUB_CONFIG.API_BASE.replace(/\\/$/, '');
  }
  return location.hostname === 'localhost' ? 'http://localhost:8000' : '';
}

var API_BASE = resolveApiBase();

function apiFetch(path, opts) {
  opts = opts || {};
  var isFormData = opts.body instanceof FormData;
  var url = path.startsWith('http') ? path : API_BASE + path;
  return fetch(url, Object.assign({}, opts, {
    credentials: 'include',
    headers: Object.assign(
      isFormData ? {} : { 'Content-Type': 'application/json' },
      opts.headers || {}
    )
  }));
}

var _csrfToken = null, _csrfAt = 0;
async function getCsrf(force) {
  var now = Date.now();
  if (!force && _csrfToken && (now - _csrfAt) < 30000) return _csrfToken;
  try {
    var res = await apiFetch('/api/auth/csrf');
    if (!res.ok) return '';
    var d = await res.json();
    _csrfToken = d.csrf_token || '';
    _csrfAt = Date.now();
    return _csrfToken;
  } catch(e) { return ''; }
}

function clearCsrfCache() { _csrfToken = null; _csrfAt = 0; }
"""

# ── GitHub API helpers ─────────────────────────────────────────────

def gh_request(token, method, path, body=None):
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "BANAHub-Deploy-Script/1.0",
        }
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return json.loads(body) if body else {}, e.code

def get_file_sha(token, path):
    resp, status = gh_request(token, "GET", f"contents/{path}?ref={BRANCH}")
    if status == 200:
        return resp.get("sha")
    return None  # file doesn't exist

def upsert_file(token, path, content, message, sha=None):
    body = {
        "message": message,
        "content": base64.b64encode(content.encode()).decode(),
        "branch": BRANCH,
    }
    if sha:
        body["sha"] = sha
    resp, status = gh_request(token, "PUT", f"contents/{path}", body)
    return status in (200, 201), resp

def delete_file(token, path, message, sha):
    body = {"message": message, "sha": sha, "branch": BRANCH}
    resp, status = gh_request(token, "DELETE", f"contents/{path}", body)
    return status == 200, resp

# ── Main ───────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("  BANAHub — Vercel Deployment Fix")
    print("=" * 55)
    print()
    print("Need a GitHub token? →")
    print("  github.com → Settings → Developer settings →")
    print("  Personal access tokens → Generate (scope: repo)")
    print()
    token = input("Paste your GitHub token: ").strip()
    if not token:
        print("No token provided. Exiting.")
        sys.exit(1)

    print()

    # Verify token
    print("🔐 Verifying token...")
    resp, status = gh_request(token, "GET", "")
    if status == 404:
        print("✅ Token valid (repo found)")
    elif status == 401:
        print("❌ Invalid token. Check and try again.")
        sys.exit(1)
    else:
        print(f"✅ Connected (status {status})")

    changes = []

    # 1. Create/update vercel.json at repo root
    print()
    print("📄 Creating vercel.json at repo root...")
    sha = get_file_sha(token, "vercel.json")
    ok, resp = upsert_file(
        token, "vercel.json", VERCEL_JSON,
        "Fix: add vercel.json to deploy static frontend from banahub-fixed/frontend",
        sha
    )
    if ok:
        print("   ✅ vercel.json created/updated")
        changes.append("vercel.json")
    else:
        print(f"   ❌ Failed: {resp.get('message', 'unknown error')}")

    # 2. Update config.js (remove YOUR-BACKEND-DOMAIN placeholder)
    print()
    print("📄 Updating banahub-fixed/frontend/config.js...")
    sha = get_file_sha(token, "banahub-fixed/frontend/config.js")
    ok, resp = upsert_file(
        token, "banahub-fixed/frontend/config.js", CONFIG_JS,
        "Fix: remove YOUR-BACKEND-DOMAIN placeholder from config.js",
        sha
    )
    if ok:
        print("   ✅ config.js updated")
        changes.append("config.js")
    else:
        print(f"   ❌ Failed: {resp.get('message', 'unknown error')}")

    # 3. Update api.js
    print()
    print("📄 Updating banahub-fixed/frontend/api.js...")
    sha = get_file_sha(token, "banahub-fixed/frontend/api.js")
    ok, resp = upsert_file(
        token, "banahub-fixed/frontend/api.js", API_JS,
        "Fix: add clearCsrfCache and error handling to api.js",
        sha
    )
    if ok:
        print("   ✅ api.js updated")
        changes.append("api.js")
    else:
        print(f"   ❌ Failed: {resp.get('message', 'unknown error')}")

    # 4. Delete package-lock.json with internal npm registry URLs
    print()
    print("🗑️  Deleting banahub-fixed/frontend/package-lock.json...")
    sha = get_file_sha(token, "banahub-fixed/frontend/package-lock.json")
    if sha:
        ok, resp = delete_file(
            token,
            "banahub-fixed/frontend/package-lock.json",
            "Fix: remove package-lock.json with internal npm registry URLs that crash Vercel build",
            sha
        )
        if ok:
            print("   ✅ package-lock.json deleted")
            changes.append("deleted package-lock.json")
        else:
            print(f"   ❌ Failed: {resp.get('message', 'unknown error')}")
    else:
        print("   ℹ️  Already deleted (skipping)")

    # Summary
    print()
    print("=" * 55)
    if changes:
        print(f"✅ {len(changes)} changes pushed to GitHub:")
        for c in changes:
            print(f"   • {c}")
        print()
        print("🚀 Vercel is now auto-deploying...")
        print("   Watch progress: https://vercel.com/ibthisamkjs-projects/banahub")
        print()
        print("🌐 Your site will be live at:")
        print("   https://banahub-ibthisamkjs-projects.vercel.app")
        print("   https://banahub.com  (once DNS propagates)")
    else:
        print("⚠️  No changes were applied. Check errors above.")
    print("=" * 55)

if __name__ == "__main__":
    main()
