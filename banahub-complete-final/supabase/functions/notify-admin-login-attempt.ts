// supabase/functions/notify-admin-login-attempt/index.ts
// Deploy: supabase functions deploy notify-admin-login-attempt
// Secrets needed (supabase secrets set ...):
//   RESEND_API_KEY   — from resend.com (or swap for any transactional email API)
//   ADMIN_ALERT_EMAIL — ibthisam@banahub.com
//
// Triggered by the pg_net webhook in security_hardening.sql on every row
// inserted into login_attempts where attempted_admin_route = true.
// Fires on BOTH successful and failed admin login attempts, so you see
// every access — not just intrusions.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ADMIN_ALERT_EMAIL = Deno.env.get("ADMIN_ALERT_EMAIL")!;
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const { email, success, ip_address, user_agent, created_at } = await req.json();

    // This endpoint is public (called by the DB via pg_net without a JWT), so
    // only send when a matching attempt for an ADMIN email was really recorded
    // in the last 2 minutes — prevents anyone using it to spam the inbox.
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const [{ data: attempt }, { data: admin }] = await Promise.all([
      sb.from("login_attempts").select("id").eq("email", String(email || "")).gte("created_at", since).limit(1),
      sb.from("users").select("id").eq("email", String(email || "").toLowerCase()).eq("role", "admin").limit(1),
    ]);
    if (!attempt?.length || !admin?.length) return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });

    const subject = success
      ? `✅ Admin login — ${email}`
      : `🚨 Failed admin login attempt — ${email}`;

    const html = `
      <div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:${success ? '#003527' : '#ba1a1a'}">${success ? 'Admin login succeeded' : 'Failed admin login attempt'}</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:12px">
          <tr><td style="padding:6px 0;color:#666">Email used</td><td style="padding:6px 0;font-weight:600">${escapeHtml(email)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">IP address</td><td style="padding:6px 0;font-weight:600">${escapeHtml(ip_address || 'unknown')}</td></tr>
          <tr><td style="padding:6px 0;color:#666">User agent</td><td style="padding:6px 0;font-size:12px">${escapeHtml(user_agent || 'unknown')}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Time</td><td style="padding:6px 0">${new Date(created_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</td></tr>
        </table>
        ${!success ? `<p style="margin-top:16px;color:#ba1a1a;font-size:13px">If this wasn't you, no action is needed — the account is not compromised from a login attempt alone. Supabase Auth rate-limits repeated sign-in attempts.</p>` : ''}
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "BANAHub Security <security@banahub.com>",
        to: ADMIN_ALERT_EMAIL,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      console.error("Resend API error", await res.text());
      return new Response(JSON.stringify({ ok: false }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});

function escapeHtml(s: string) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
