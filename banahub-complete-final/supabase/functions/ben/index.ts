// BANAHUB "Ben" — Admin OS chief-of-staff assistant (AI brain).
// Admins only (public.users.role = 'admin', checked server-side). POST { message, history?, snapshot?, panels?, today? }
// Returns { ai: true, reply, actions: [{type:'nav',panel} | {type:'task',title,due?,priority?,notes?} | {type:'search',q}] }
// or { ai: false } when ANTHROPIC_API_KEY is not set (the Admin OS then uses Ben's built-in command engine).
// Ben never executes writes server-side: proposed actions run in the browser under the admin's own RLS.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE_URL = (Deno.env.get("SITE_URL") || "https://banahub.com").replace(/\/$/, "");
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("BEN_MODEL") || "claude-sonnet-5-5";
const ORIGINS = [SITE_URL, "https://banahub.com", "https://www.banahub.com"];
const cors = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const allow = ORIGINS.includes(o) || /^https:\/\/banahub-[a-z0-9-]+\.vercel\.app$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SITE_URL;
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
};
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

const SYSTEM = (panels: string, snapshot: string, today: string) => `You are Ben, chief of staff to the founder & CEO of BANAHUB (Singapore GTM advisory, investment readiness and market expansion platform; not MAS-licensed, never gives financial advice, never promises investor introductions or fundraising outcomes).
You live inside the BANAHUB Admin OS. Be terse: short bullets, no filler. Recommend the next best actions, prioritised.
Today is ${today} (Asia/Singapore).

Admin OS panels you can open (id — label):
${panels}

Live snapshot of the platform (counts and top items, computed just now):
${snapshot}

Always answer with ONE JSON object and nothing else:
{"reply":"markdown text for the CEO","actions":[...]}
Allowed actions (0–5):
- {"type":"nav","panel":"<panel id from the list>"} — open a panel
- {"type":"task","title":"...","due":"YYYY-MM-DD","priority":"high|normal|low","notes":"..."} — create a reminder / to-do / scheduled item in the CEO's task list
- {"type":"search","q":"..."} — search members, investors, raises, enquiries
Only propose a task when the CEO asks to create, schedule, remind or plan something, or when you recommend one and it is clearly useful. Never invent data that is not in the snapshot.`;

Deno.serve(async (req) => {
  const h = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: h });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) return out({ error: "Please sign in" }, 401);
    const { data: u } = await db.from("users").select("id, role, blocked, full_name").eq("id", auth.user.id).maybeSingle();
    if (!u || u.role !== "admin" || u.blocked) return out({ error: "Admins only" }, 403);
    const b = await req.json().catch(() => ({}));
    if (!KEY || b.probe) return out({ ai: !!KEY, model: KEY ? MODEL : null });

    const message = clip(b.message, 4000).trim();
    if (!message) return out({ error: "Empty message" }, 400);
    const panels = (Array.isArray(b.panels) ? b.panels : []).slice(0, 120).map((p: any) => `${clip(p.id, 40)} — ${clip(p.label, 60)}`).join("\n");
    const snapshot = clip(JSON.stringify(b.snapshot ?? {}), 12000);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(b.today)) ? b.today : new Date().toISOString().slice(0, 10);
    const history = (Array.isArray(b.history) ? b.history : []).slice(-12)
      .filter((m: any) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m: any) => ({ role: m.role, content: clip(m.content, 3000) }));
    while (history.length && history[0].role !== "user") history.shift();

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: SYSTEM(panels, snapshot, today), messages: [...history, { role: "user", content: message }] }),
    });
    const j = await r.json();
    if (!r.ok) { console.error("anthropic", r.status, JSON.stringify(j).slice(0, 500)); return out({ error: "Ben's AI is unavailable right now" }, 502); }
    const text = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    let parsed: any = null;
    try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* plain text */ }
    const reply = clip(parsed?.reply ?? text, 8000);
    const actions = (Array.isArray(parsed?.actions) ? parsed.actions : []).slice(0, 5).map((a: any) => {
      if (a?.type === "nav") return { type: "nav", panel: clip(a.panel, 40) };
      if (a?.type === "search") return { type: "search", q: clip(a.q, 120) };
      if (a?.type === "task") return { type: "task", title: clip(a.title, 200), due: /^\d{4}-\d{2}-\d{2}$/.test(String(a.due)) ? a.due : null, priority: ["high", "normal", "low"].includes(a.priority) ? a.priority : "normal", notes: clip(a.notes, 1000) || null };
      return null;
    }).filter(Boolean);
    return out({ ai: true, reply, actions });
  } catch (e) {
    console.error(e);
    return out({ error: "Ben error — see function logs" }, 500);
  }
});
