// BANAHUB email campaigns — admins only. Sends through Resend (free tier: 100/day, 3,000/month — caps enforced here).
// POST { action:'status' }                         → provider readiness + usage vs caps
// POST { action:'audience', audience }             → recipient count by source (+ sample), after suppressions
// POST { action:'test', campaign_id, to? }         → one test email to the admin
// POST { action:'send', campaign_id }              → build the recipient list, queue it, start sending (within caps)
// POST { action:'process' }                        → continue queued / due scheduled campaigns (called when Admin OS opens)
// Compliance: unsubscribe link + List-Unsubscribe header on every email; suppression list honoured; "<ADV>" subject label
// and sender identification for unsolicited recipients (imported investors / CRM / directory / manual addresses).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE_URL = (Deno.env.get("SITE_URL") || "https://banahub.com").replace(/\/$/, "");
const RESEND = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
const ORIGINS = [SITE_URL, "https://banahub.com", "https://www.banahub.com"];
const cors = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const allow = ORIGINS.includes(o) || /^https:\/\/banahub-[a-z0-9-]+\.vercel\.app$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SITE_URL;
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
};
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[a-z]{2,}$/i;
const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();

type Recipient = { email: string; name: string; company: string; source: string; unsolicited: boolean };

async function settings() {
  const { data } = await db.from("site_settings").select("value").eq("key", "email").maybeSingle();
  return { daily_cap: 100, monthly_cap: 3000, from_email: "hello@banahub.com", from_name: "BANAHUB", reply_to: "", address: "Bana Private Limited (UEN 201933473Z), Singapore", ...(data?.value || {}) };
}
async function usage() {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const [d, m] = await Promise.all([
    db.from("email_sends").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", day.toISOString()),
    db.from("email_sends").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", month.toISOString()),
  ]);
  return { today: d.count || 0, month: m.count || 0 };
}

async function buildAudience(a: any): Promise<{ list: Recipient[]; bySource: Record<string, number>; suppressed: number }> {
  const sources: string[] = Array.isArray(a?.sources) ? a.sources : [];
  const map = new Map<string, Recipient>();
  const add = (r: Recipient) => {
    const e = norm(r.email); if (!EMAIL_RE.test(e)) return;
    const cur = map.get(e);
    if (!cur || (cur.unsolicited && !r.unsolicited)) map.set(e, { ...r, email: e, name: clip(r.name, 120), company: clip(r.company, 160) });
  };
  const inList = (v: unknown, list: unknown) => !Array.isArray(list) || !list.length || list.includes(v ?? "Uncategorised");
  if (sources.includes("members")) {
    const st = Array.isArray(a.member_status) && a.member_status.length ? a.member_status : ["approved"];
    const { data } = await db.from("users").select("email,full_name,company_name,member_category,role,status").in("status", st).neq("role", "admin").limit(20000);
    (data || []).filter((u: any) => inList(u.member_category, a.member_categories)).forEach((u: any) => add({ email: u.email, name: u.full_name || "", company: u.company_name || "", source: "members", unsolicited: false }));
  }
  if (sources.includes("subscribers")) {
    const { data } = await db.from("newsletter_subscribers").select("email,name").eq("is_active", true).limit(20000);
    (data || []).forEach((s: any) => add({ email: s.email, name: s.name || "", company: "", source: "subscribers", unsolicited: false }));
  }
  if (sources.includes("investors")) {
    const { data } = await db.from("investors").select("email,full_name,organization,investor_type,user_id").not("email", "is", null).not("active", "is", false).limit(20000);
    (data || []).filter((i: any) => inList(i.investor_type, a.investor_types)).forEach((i: any) => add({ email: i.email, name: i.full_name || "", company: i.organization || "", source: "investors", unsolicited: !i.user_id }));
  }
  if (sources.includes("crm")) {
    const { data } = await db.from("crm_contacts").select("email,name,company,contact_type").not("email", "is", null).limit(20000);
    (data || []).filter((c: any) => inList(c.contact_type, a.crm_types)).forEach((c: any) => add({ email: c.email, name: c.name || "", company: c.company || "", source: "crm", unsolicited: true }));
  }
  if (sources.includes("companies")) {
    const { data } = await db.from("companies").select("email,contact_name,company_name,user_id").not("email", "is", null).limit(20000);
    (data || []).forEach((c: any) => add({ email: c.email, name: c.contact_name || "", company: c.company_name || "", source: "companies", unsolicited: !c.user_id }));
  }
  if (sources.includes("manual") && a.manual) {
    String(a.manual).split(/[\s,;]+/).slice(0, 2000).forEach((e) => add({ email: e, name: "", company: "", source: "manual", unsolicited: true }));
  }
  const { data: sup } = await db.from("email_suppressions").select("email").limit(100000);
  const blocked = new Set((sup || []).map((s: any) => norm(s.email)));
  let suppressed = 0; const list: Recipient[] = []; const bySource: Record<string, number> = {};
  for (const r of map.values()) { if (blocked.has(r.email)) { suppressed++; continue; } list.push(r); bySource[r.source] = (bySource[r.source] || 0) + 1; }
  return { list, bySource, suppressed };
}

let secret = "";
async function token(email: string) {
  if (!secret) { const { data } = await db.from("email_secret").select("secret").eq("id", 1).maybeSingle(); secret = data?.secret || ""; }
  if (!secret) throw new HttpError(500, "Unsubscribe secret missing — apply migration 31");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(norm(email)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function merge(s: string, r: Partial<Recipient>) {
  const first = (r.name || "").trim().split(/\s+/)[0] || "there";
  return s.replace(/\{\{\s*first_name\s*\}\}/gi, esc(first)).replace(/\{\{\s*name\s*\}\}/gi, esc(r.name || "there")).replace(/\{\{\s*company\s*\}\}/gi, esc(r.company || "your company")).replace(/\{\{\s*email\s*\}\}/gi, esc(r.email || ""));
}
const sanitize = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "").replace(/javascript:/gi, "");
const textOf = (h: string) => h.replace(/<(br|\/p|\/h[1-6]|\/li)>/gi, "\n").replace(/<li>/gi, "• ").replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

async function render(c: any, r: Recipient, cfg: any, test = false) {
  const unsub = `${SITE_URL}/unsubscribe?e=${encodeURIComponent(r.email)}&t=${await token(r.email)}`;
  const reason = r.unsolicited
    ? "You are receiving this because your business contact details are listed in BANAHUB's investor and partner network database."
    : "You are receiving this because you are a BANAHUB member or subscribed to BANAHUB updates.";
  const subject = `${test ? "[TEST] " : ""}${r.unsolicited ? "<ADV> " : ""}${merge(c.subject, r).replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')}`;
  const body = merge(sanitize(c.body_html || ""), r);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f2;font-family:Arial,Helvetica,sans-serif;color:#1b1c1a">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(c.preheader || "")}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#003527;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.06em">BANAHUB<span style="color:#e9c349;font-size:11px;font-weight:normal;letter-spacing:.12em;margin-left:10px">BUSINESS HIVE</span></td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6;color:#1b1c1a">${body}</td></tr>
<tr><td style="padding:18px 28px;background:#f7f8f5;font-size:11.5px;line-height:1.55;color:#4a524d">
${esc(cfg.address)} · <a href="${SITE_URL}" style="color:#0a5c40">banahub.com</a><br>${esc(reason)}<br>
BANAHUB is not licensed by the Monetary Authority of Singapore; nothing in this email is financial advice or an offer of securities, and no investment outcome or introduction is guaranteed.<br>
<a href="${unsub}" style="color:#0a5c40">Unsubscribe</a> — we'll stop emailing ${esc(r.email)}.</td></tr></table></td></tr></table></body></html>`;
  return { subject: clip(subject, 250), html, text: textOf(body) + `\n\n--\n${cfg.address}\n${reason}\nUnsubscribe: ${unsub}`, unsub };
}

async function resendBatch(items: any[]) {
  const r = await fetch("https://api.resend.com/emails/batch", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify(items) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("resend", r.status, JSON.stringify(j).slice(0, 400)); throw new Error(j?.message || j?.error || `Resend error ${r.status}`); }
  return (j.data || []) as { id: string }[];
}

async function processCampaign(c: any, cfg: any, budget: number) {
  if (budget <= 0) return 0;
  const { data: queue } = await db.from("email_sends").select("*").eq("campaign_id", c.id).eq("status", "queued").order("created_at").limit(Math.min(budget, 300));
  let sent = 0;
  const from = `${clip(c.from_name || cfg.from_name, 60).replace(/[<>"]/g, "")} <${cfg.from_email}>`;
  for (let i = 0; i < (queue || []).length; i += 50) {
    const chunk = queue!.slice(i, i + 50);
    const items = await Promise.all(chunk.map(async (s: any) => {
      const m = await render(c, { email: s.email, name: s.name || "", company: s.company || "", source: s.source, unsolicited: s.unsolicited }, cfg);
      return { from, to: [s.email], subject: m.subject, html: m.html, text: m.text, reply_to: c.reply_to || cfg.reply_to || undefined, headers: { "List-Unsubscribe": `<${m.unsub}>, <mailto:${cfg.reply_to || cfg.from_email}?subject=unsubscribe>` }, tags: [{ name: "campaign", value: String(c.id).replace(/-/g, "_") }] };
    }));
    try {
      const ids = await resendBatch(items);
      const now = new Date().toISOString();
      await Promise.all(chunk.map((s: any, k: number) => db.from("email_sends").update({ status: "sent", sent_at: now, provider_id: ids[k]?.id || null }).eq("id", s.id)));
      sent += chunk.length;
    } catch (e) {
      await Promise.all(chunk.map((s: any) => db.from("email_sends").update({ status: "failed", error: clip((e as Error).message, 300) }).eq("id", s.id)));
      break;
    }
  }
  const counts = async (st: string) => (await db.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", st)).count || 0;
  const [s, f, q] = await Promise.all([counts("sent"), counts("failed"), counts("queued")]);
  await db.from("email_campaigns").update({ sent_count: s, failed_count: f, status: q ? "sending" : (s ? "sent" : "failed"), sent_at: q ? null : new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", c.id);
  return sent;
}

async function queueCampaign(c: any) {
  const { list, suppressed } = await buildAudience(c.audience || {});
  if (!list.length) throw new HttpError(400, "No recipients match this audience");
  for (let i = 0; i < list.length; i += 500) {
    const rows = list.slice(i, i + 500).map((r) => ({ campaign_id: c.id, email: r.email, name: r.name, company: r.company, source: r.source, unsolicited: r.unsolicited }));
    const { error } = await db.from("email_sends").upsert(rows, { onConflict: "campaign_id,email", ignoreDuplicates: true });
    if (error) throw new HttpError(400, error.message);
  }
  await db.from("email_campaigns").update({ status: "sending", started_at: new Date().toISOString(), recipients_count: list.length, skipped_count: suppressed, updated_at: new Date().toISOString() }).eq("id", c.id);
  return list.length;
}

Deno.serve(async (req) => {
  const h = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: h });
  try {
    const { data: auth } = await db.auth.getUser((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
    if (!auth?.user) throw new HttpError(401, "Please sign in");
    const { data: u } = await db.from("users").select("id, role, blocked, email, full_name").eq("id", auth.user.id).maybeSingle();
    if (!u || u.role !== "admin" || u.blocked) throw new HttpError(403, "Admins only");
    const b = await req.json().catch(() => ({}));
    const cfg = await settings();
    const use = await usage();
    const left = Math.max(0, Math.min(cfg.daily_cap - use.today, cfg.monthly_cap - use.month));

    if (b.action === "status") return out({ provider_ready: !!RESEND, from: `${cfg.from_name} <${cfg.from_email}>`, sent_today: use.today, daily_cap: cfg.daily_cap, sent_month: use.month, monthly_cap: cfg.monthly_cap, left_today: left });
    if (b.action === "audience") {
      const { list, bySource, suppressed } = await buildAudience(b.audience || {});
      return out({ count: list.length, by_source: bySource, unsolicited: list.filter((r) => r.unsolicited).length, suppressed, sample: list.slice(0, 12).map((r) => ({ email: r.email, name: r.name, company: r.company, source: r.source })), days_needed: Math.ceil(list.length / Math.max(1, cfg.daily_cap)) });
    }

    const loadC = async (id: unknown) => {
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "campaign_id required");
      const { data } = await db.from("email_campaigns").select("*").eq("id", id).maybeSingle(); if (!data) throw new HttpError(404, "Campaign not found"); return data;
    };
    if (b.action === "test") {
      if (!RESEND) throw new HttpError(412, "Email isn't connected yet — add RESEND_API_KEY in Supabase → Edge Functions → Secrets");
      const c = await loadC(b.campaign_id);
      if (!c.subject || !c.body_html) throw new HttpError(400, "Add a subject and content first");
      const to = norm(b.to || u.email); if (!EMAIL_RE.test(to)) throw new HttpError(400, "Invalid test address");
      const m = await render(c, { email: to, name: u.full_name || "", company: "BANAHUB", source: "test", unsolicited: !!b.as_unsolicited }, cfg, true);
      await resendBatch([{ from: `${cfg.from_name} <${cfg.from_email}>`, to: [to], subject: m.subject, html: m.html, text: m.text, reply_to: c.reply_to || cfg.reply_to || undefined }]);
      return out({ ok: true, to });
    }
    if (b.action === "send") {
      if (!RESEND) throw new HttpError(412, "Email isn't connected yet — add RESEND_API_KEY in Supabase → Edge Functions → Secrets");
      const c = await loadC(b.campaign_id);
      if (!["draft", "scheduled", "failed"].includes(c.status)) throw new HttpError(409, `Campaign is already ${c.status}`);
      if (!c.subject?.trim() || !c.body_html?.trim()) throw new HttpError(400, "Add a subject and content first");
      const n = await queueCampaign(c);
      const sent = await processCampaign({ ...c, status: "sending" }, cfg, left);
      return out({ queued: n, sent_now: sent, remaining: n - sent, note: n - sent > 0 ? `Free plan limit: ${cfg.daily_cap}/day — the rest go out automatically over the next ${Math.ceil((n - sent) / cfg.daily_cap)} day(s) whenever Admin OS is open.` : null });
    }
    if (b.action === "process") {
      if (!RESEND) return out({ processed: 0, provider_ready: false });
      const now = new Date().toISOString();
      const { data: due } = await db.from("email_campaigns").select("*").eq("status", "scheduled").lte("scheduled_at", now).limit(5);
      for (const c of due || []) { try { await queueCampaign(c); } catch (e) { await db.from("email_campaigns").update({ status: "failed" }).eq("id", c.id); console.error(e); } }
      const { data: active } = await db.from("email_campaigns").select("*").eq("status", "sending").order("started_at").limit(5);
      let budget = left, total = 0;
      for (const c of active || []) { const s = await processCampaign(c, cfg, budget); total += s; budget -= s; if (budget <= 0) break; }
      return out({ processed: total, left_today: Math.max(0, budget) });
    }
    throw new HttpError(400, "Unknown action");
  } catch (e: any) {
    if (!(e instanceof HttpError)) console.error(e);
    return out({ error: e instanceof HttpError ? e.message : "Email error — " + clip(e?.message, 200) }, e instanceof HttpError ? e.status : 500);
  }
});
