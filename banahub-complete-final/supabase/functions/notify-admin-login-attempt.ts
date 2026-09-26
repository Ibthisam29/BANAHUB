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

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ADMIN_ALERT_EMAIL = Deno.env.get("ADMIN_ALERT_EMAIL")!;

serve(async (req) => {
  try {
    const { email, success, ip_address, user_agent, created_at } = await req.json();

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
        ${!success ? `<p style="margin-top:16px;color:#ba1a1a;font-size:13px">If this wasn't you, no action is needed — the account is not compromised from a login attempt alone. 5 failed attempts in 15 minutes auto-blocks that email.</p>` : ''}
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
