// BANAHUB Pitch Practice — AI investor (founders) and AI LP (fund managers) role-play with scorecard.
// Members only (approved). POST { action, ... }:
//   status                                                → plan, cap, used, personas, ai availability
//   start { mode:'founder'|'lp', persona, difficulty?, deal_room_id?, deck_text? } → { session_id, reply }
//   turn  { session_id, text }                            → { reply, done }
//   end   { session_id }                                  → { score }
// Limits (site_settings.pitch_practice) and personas are enforced here, never trusted from the browser.
// Practice only: the agent never represents a real investor and never promises funding or introductions.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE_URL = (Deno.env.get("SITE_URL") || "https://banahub.com").replace(/\/$/, "");
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("PITCH_MODEL") || Deno.env.get("BEN_MODEL") || "claude-sonnet-5-5";
const ORIGINS = [SITE_URL, "https://banahub.com", "https://www.banahub.com"];
const cors = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const allow = ORIGINS.includes(o) || /^https:\/\/banahub-[a-z0-9-]+\.vercel\.app$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SITE_URL;
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
};
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

type Persona = { label: string; level: "easy" | "medium" | "hard"; brief: string };
const PERSONAS: Record<"founder" | "lp", Record<string, Persona>> = {
  founder: {
    friends: { label: "Friends & family", level: "easy", brief: "a supportive friend-of-the-family angel writing a small cheque; curious, asks basic questions about the idea, the founder's commitment and how the money will be used" },
    angels: { label: "Angel investor", level: "medium", brief: "an experienced angel and ex-founder; probes problem/solution fit, early traction, founder-market fit, valuation reasonableness and what milestones this round buys" },
    seed_vc: { label: "Seed VC partner", level: "medium", brief: "a seed-stage VC partner; probes market size and why-now, wedge and go-to-market, early metrics, competition, team gaps and round structure" },
    series_a_vc: { label: "Series A VC partner", level: "hard", brief: "a Series A partner at a top fund; demands evidence of product–market fit, revenue quality, growth rate, retention/cohorts, CAC/LTV and payback, burn multiple and a credible path to Series B" },
    cvc: { label: "Corporate VC (strategic)", level: "hard", brief: "a corporate venture investor; cares about strategic fit with the corporate parent, partnership potential, IP, defensibility, regulatory risk and conflicts with existing vendors" },
    family_office: { label: "Family office", level: "hard", brief: "an investment director at a Southeast Asian / Gulf family office; values capital preservation, governance, downside protection, founder integrity, alignment, exit horizon and co-investor quality" },
  },
  lp: {
    friends: { label: "Friends & family LP", level: "easy", brief: "a friendly prospective LP from the GP's network; asks simple questions about what the fund does, minimum commitment and how returns work" },
    angels: { label: "Angel / operator LP", level: "medium", brief: "an operator-angel considering a fund commitment; probes thesis, deal flow access, how you win deals and why back a fund instead of investing directly" },
    hnw: { label: "High-net-worth investor", level: "medium", brief: "a high-net-worth individual; probes risk, liquidity and lock-up, fees and carry, track record, capital calls and reporting" },
    family_office: { label: "Family office CIO", level: "hard", brief: "a family office CIO; demands attributable track record (DPI/TVPI/IRR), portfolio construction, reserves, GP commitment, key-person risk, governance, fee terms and co-investment rights" },
    institutional: { label: "Institutional LP", level: "hard", brief: "an institutional LP (fund-of-funds / pension / endowment); runs operational and investment due diligence: team stability, attribution, strategy drift, fund size discipline, valuation policy, LPA terms, ESG, fund admin and audit" },
  },
};
const DIFF: Record<string, string> = {
  friendly: "Be warm and encouraging; ask fewer follow-ups.",
  realistic: "Behave like a real investor in a first meeting: polite but sceptical; follow up when answers are vague.",
  tough: "Be demanding and time-pressed; interrupt vague answers, challenge numbers and assumptions, raise objections.",
};

async function ai(system: string, messages: { role: "user" | "assistant"; content: string }[], max = 400) {
  if (!KEY) throw new HttpError(503, "Pitch Practice AI is not configured yet — BANAHUB is setting it up");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages }),
  });
  const j = await r.json();
  if (!r.ok) { console.error("anthropic", r.status, JSON.stringify(j).slice(0, 400)); throw new HttpError(502, "The practice agent is unavailable — try again shortly"); }
  return (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
}

function systemFor(s: any) {
  const p = PERSONAS[s.mode as "founder" | "lp"][s.persona];
  const who = s.mode === "lp" ? "a fund manager (GP) pitching their fund" : "a founder pitching their company";
  return `You are role-playing ${p.brief}. You are in a live, spoken practice meeting with ${who}, on BANAHUB's Pitch Practice.
${DIFF[s.difficulty] || DIFF.realistic}
Rules:
- Speak naturally as the investor. Plain spoken sentences only: no markdown, no lists, no stage directions, no emojis.
- Keep each turn short (1–3 sentences) and ask ONE question at a time.
- Open by greeting briefly and asking them to start their pitch (or, if they already gave context, ask an opening question).
- Base your questions on the material below. Probe gaps, inconsistencies and missing numbers. Do not invent facts about them.
- Stay in character. You are a fictional practice investor: never claim to be a real person or firm, never promise to invest, never promise introductions.
- When roughly ${Math.max(8, Math.min(30, s.max_turns || 20))} exchanges have happened or they say they are done, wrap up politely as an investor would (next steps / what you'd need to see).
Material about the ${s.mode === "lp" ? "fund and GP" : "company and raise"} (may be incomplete):
<<<
${s.context || "(nothing provided — ask them to introduce themselves)"}
>>>`;
}

const asMsgs = (t: any[]) => {
  const m = t.map((x) => ({ role: (x.role === "me" ? "user" : "assistant") as "user" | "assistant", content: clip(x.text, 4000) }));
  if (!m.length || m[0].role !== "user") m.unshift({ role: "user", content: "(The meeting starts.)" });
  return m;
};

async function contextFor(uid: string, mode: string, dealId: unknown, deck: unknown) {
  const parts: string[] = [];
  if (mode === "founder") {
    let q = db.from("deal_rooms").select("company_name,company_type,description,hq_country,sectors,industries,stage,target_raise,currency,raised_amount,pre_money_valuation,traction_stage,annual_revenue,revenue_growth_pct,prior_rounds,preferred_instruments,use_of_funds,next_stage,next_stage_amount,team_size,founded_year,website").eq("submitted_by", uid);
    if (typeof dealId === "string" && /^[0-9a-f-]{36}$/.test(dealId)) q = q.eq("id", dealId);
    const { data } = await q.order("created_at", { ascending: false }).limit(1);
    if (data?.[0]) parts.push("Raise profile: " + JSON.stringify(data[0]));
  } else {
    const { data: i } = await db.from("investors").select("organization,investor_type,investor_subtype,hq_country,aum,aum_currency,check_min,check_max,check_currency,preferred_stages,instruments,invest_geographies,focus_sectors,current_mandate,funds,portfolio_companies,team").eq("user_id", uid).maybeSingle();
    if (i) parts.push("Fund / GP profile: " + JSON.stringify({ ...i, team: (i.team || []).map((t: any) => ({ name: t.name, role: t.role })) }));
  }
  const d = clip(deck, 15000).replace(/\s+/g, " ").trim();
  if (d) parts.push("Deck text: " + d);
  return clip(parts.join("\n\n"), 22000);
}

Deno.serve(async (req) => {
  const h = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: h });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) throw new HttpError(401, "Please sign in");
    const uid = auth.user.id;
    const { data: u } = await db.from("users").select("id, role, status, blocked").eq("id", uid).maybeSingle();
    if (!u || u.blocked) throw new HttpError(403, "Account not available");
    const isAdmin = u.role === "admin";
    const b = await req.json().catch(() => ({}));
    const { data: st } = await db.from("site_settings").select("value").eq("key", "pitch_practice").maybeSingle();
    const cfg = { enabled: true, free_cap: 1, paid_cap: 10, max_turns: 30, paid_only_personas: [] as string[], ...(st?.value || {}) };
    const { data: plan } = await db.from("memberships").select("plan_code, access_until, payment_method").eq("user_id", uid).maybeSingle();
    const grace = plan?.payment_method === "paynow" ? 7 : 3;
    const paid = isAdmin || (!!plan && plan.plan_code !== "free" && (plan.plan_code === "investor_circle" || (plan.access_until && new Date(plan.access_until).getTime() + grace * 864e5 > Date.now())));
    const cap = isAdmin ? 999 : paid ? Number(cfg.paid_cap) : Number(cfg.free_cap);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const used = async () => (await db.from("pitch_sessions").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", monthStart.toISOString())).count || 0;
    const action = String(b.action || "");

    if (action === "status") {
      const personas = (m: "founder" | "lp") => Object.entries(PERSONAS[m]).map(([k, p]) => ({ key: k, label: p.label, level: p.level, locked: !paid && cfg.paid_only_personas.includes(k) }));
      return out({ ai: !!KEY, enabled: cfg.enabled !== false, approved: isAdmin || u.status === "approved", paid, cap, used: await used(), personas: { founder: personas("founder"), lp: personas("lp") } });
    }
    if (cfg.enabled === false && !isAdmin) throw new HttpError(403, "Pitch Practice is paused — check back soon");
    if (!isAdmin && u.status !== "approved") throw new HttpError(403, "Pitch Practice opens once your membership is approved");

    if (action === "start") {
      const mode = b.mode === "lp" ? "lp" : "founder";
      const persona = String(b.persona || "");
      if (!PERSONAS[mode][persona]) throw new HttpError(400, "Choose who you want to pitch to");
      if (!paid && cfg.paid_only_personas.includes(persona)) throw new HttpError(402, `${PERSONAS[mode][persona].label} practice is part of the paid membership`);
      const n = await used();
      if (n >= cap) throw new HttpError(402, paid ? `You've used all ${cap} practice sessions this month` : `Free plan includes ${cap} practice session${cap === 1 ? "" : "s"} a month — upgrade for more`);
      const difficulty = ["friendly", "realistic", "tough"].includes(b.difficulty) ? b.difficulty : (PERSONAS[mode][persona].level === "easy" ? "friendly" : PERSONAS[mode][persona].level === "hard" ? "tough" : "realistic");
      const context = await contextFor(uid, mode, b.deal_room_id, b.deck_text);
      const s: any = { user_id: uid, mode, persona, difficulty, context, deal_room_id: /^[0-9a-f-]{36}$/.test(String(b.deal_room_id)) && mode === "founder" ? b.deal_room_id : null, max_turns: cfg.max_turns };
      const reply = await ai(systemFor(s), [{ role: "user", content: "(The meeting starts. Greet me and ask me to begin.)" }], 200);
      const transcript = [{ role: "investor", text: reply, at: new Date().toISOString() }];
      const { data: row, error } = await db.from("pitch_sessions").insert({ user_id: uid, mode, persona, difficulty, context, deal_room_id: s.deal_room_id, transcript }).select("id").single();
      if (error) throw error;
      return out({ session_id: row.id, reply, persona: PERSONAS[mode][persona].label, used: n + 1, cap });
    }

    const id = String(b.session_id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "Invalid session");
    const { data: s } = await db.from("pitch_sessions").select("*").eq("id", id).eq("user_id", uid).maybeSingle();
    if (!s) throw new HttpError(404, "Session not found");
    s.max_turns = cfg.max_turns;

    if (action === "turn") {
      if (s.status !== "active") throw new HttpError(409, "This session has ended");
      const text = clip(b.text, 4000).trim();
      if (!text) throw new HttpError(400, "Say something first");
      if (s.turns >= cfg.max_turns) throw new HttpError(409, "Session length reached — end it to get your score");
      const t = [...(s.transcript || []), { role: "me", text, at: new Date().toISOString() }];
      const reply = await ai(systemFor(s), asMsgs(t), 300);
      t.push({ role: "investor", text: reply, at: new Date().toISOString() });
      await db.from("pitch_sessions").update({ transcript: t, turns: s.turns + 1 }).eq("id", id);
      return out({ reply, turns: s.turns + 1, max_turns: cfg.max_turns, done: s.turns + 1 >= cfg.max_turns });
    }

    if (action === "end") {
      if (s.score) return out({ score: s.score, summary: s.summary });
      const t = s.transcript || [];
      if (!t.some((x: any) => x.role === "me")) {
        await db.from("pitch_sessions").update({ status: "abandoned", ended_at: new Date().toISOString() }).eq("id", id);
        return out({ score: null, summary: "No pitch recorded." });
      }
      const cats = s.mode === "lp"
        ? ["Thesis & strategy", "Track record", "Team & GP commitment", "Portfolio construction", "Terms & fees", "Edge & differentiation", "Q&A handling"]
        : ["Story & clarity", "Problem & market", "Product & traction", "Business model & economics", "Team", "The ask & use of funds", "Q&A handling"];
      const persona = PERSONAS[s.mode as "founder" | "lp"][s.persona];
      const sys = `You are an experienced pitch coach reviewing a practice ${s.mode === "lp" ? "LP fundraising pitch by a fund manager" : "investor pitch by a founder"} to ${persona.label} (${s.difficulty}). Be candid, specific and constructive. Quote or reference what they actually said. Do not give investment, legal or financial advice.
Return ONLY JSON: {"overall":1-10,"categories":{${cats.map((c) => `"${c}":1-10`).join(",")}},"verdict":"one sentence: would this investor take a second meeting and why","strengths":["…"],"improvements":["specific, actionable …"],"questions_to_prepare":["questions they struggled with or will be asked next"],"better_answer":{"question":"the weakest-answered question","suggested_answer":"a stronger answer using only their facts"}}`;
      const raw = await ai(sys, [{ role: "user", content: "Transcript:\n" + t.map((x: any) => `${x.role === "me" ? "PITCHER" : "INVESTOR"}: ${x.text}`).join("\n").slice(-30000) }], 1500);
      let score: any = null;
      try { score = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { score = { overall: null, verdict: clip(raw, 800) }; }
      const summary = clip(score?.verdict, 500);
      await db.from("pitch_sessions").update({ score, summary, status: "completed", ended_at: new Date().toISOString() }).eq("id", id);
      return out({ score, summary });
    }
    throw new HttpError(400, "Unknown action");
  } catch (e: any) {
    if (!(e instanceof HttpError)) console.error(e);
    return out({ error: e instanceof HttpError ? e.message : "Pitch Practice error — try again" }, e instanceof HttpError ? e.status : 500);
  }
});
