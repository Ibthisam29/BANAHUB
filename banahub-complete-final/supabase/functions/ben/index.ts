// BANAHUB "Ben" — Admin OS chief of staff (AI agent). Admins only (public.users.role = 'admin', checked server-side).
//
// POST { probe:true }                                   → { ai, model }
// POST { message, history?, snapshot?, panels?, context?, today?, attachments?:[{name,mime,data(base64)}] }
//      → { ai:true, reply, sources:[{title,url}], actions:[...], created:[...] }
// POST { execute:{ kind, params } }                      → runs a write the CEO confirmed in the UI
//
// Ben can: search everything on the platform, open any record, read pitch decks / data-room files / uploaded files
// (PDF natively, Word, Excel, CSV, text), research markets on the web, assess investor readiness, draft articles,
// create tasks. Low-risk writes (tasks, unpublished article drafts) happen directly; anything consequential
// (approvals, publishing, data-room access, status changes) is PROPOSED and only runs after the CEO clicks Confirm.
// All reads and writes run under the admin's own JWT, so RLS still applies.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import mammoth from "npm:mammoth@1.8.0";
import * as XLSX from "npm:xlsx@0.18.5";
import { Buffer } from "node:buffer";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE_URL = (Deno.env.get("SITE_URL") || "https://banahub.com").replace(/\/$/, "");
const KEY = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
let keyCheck: { at: number; ok: boolean; msg: string } | null = null;
const MODEL = Deno.env.get("BEN_MODEL") || "claude-sonnet-5-5";
const WEB = (Deno.env.get("BEN_WEB_SEARCH") ?? "on") !== "off";
const ORIGINS = [SITE_URL, "https://banahub.com", "https://www.banahub.com"];
const cors = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const allow = ORIGINS.includes(o) || /^https:\/\/banahub-[a-z0-9-]+\.vercel\.app$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SITE_URL;
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
};
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const isId = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const like = (s: string) => `%${s.replace(/[,%()*\\]/g, " ").trim().slice(0, 80)}%`;

/* ------------------------------------------------------------------ prompt */
const SYSTEM = (ctx: { panels: string; snapshot: string; today: string; context: string; me: string }) => `You are Ben, chief of staff to ${ctx.me}, founder & CEO of BANAHUB — a Singapore-based GTM advisory, investment-readiness and market-expansion platform (Southeast Asia, the Gulf, North Asia) serving founders, companies, investors, family offices and fund managers.
You work inside the BANAHUB Admin OS with tools to search and read everything on the platform, read pitch decks and data-room files, research the web, draft articles, create tasks and propose actions.

How you work
- Act, don't ask: use tools to gather what you need before answering. Chain tools (search → get_record → read_document → web_search) as needed.
- Be terse and decision-ready: headline first, then short sections and bullets; tables where they help. No filler.
- Cite web sources you used. Never invent data, numbers, names or investors. Say clearly when something is unknown or an estimate.
- Writes: create_task and save_article_draft run immediately (drafts are never published). Everything else that changes data (approve / reject members, publish articles, review submissions, grant data-room access, change statuses, create events) must go through propose_action — the CEO confirms it with one click. Membership and investor approvals are always manual.
- Compliance: BANAHUB is not MAS-licensed. Never give investment, legal or tax advice, never promise investor introductions, funding or returns, never make unverified claims about investors or performance. Frame investor-readiness work as preparation and advisory.

Expert playbooks
1. Pitch / proposal review (read the deck first): summarise the company (problem, solution, market, model, traction, team, ask, use of funds, valuation); score each 1–10 with one-line reasons; strengths; gaps & red flags; what's missing from the deck; the 10 questions investors will ask; concrete rewrite suggestions.
2. Investor-readiness assessment (company): score 0–100 across Team, Market, Product, Traction, Business model & unit economics, Financials & projections, Cap table & round structure, Legal & corporate hygiene, Pitch materials, Data room. Then: ✅ what's in place, ❌ what's missing (check the data-room file list against a standard checklist: deck, one-pager, financial model, historical financials / management accounts, cap table, incorporation & constitution, shareholder agreements, key contracts, IP, team CVs & org chart, customer metrics, pipeline, compliance/licences), ⚠️ red flags, and next steps as a 30 / 60 / 90-day plan with owners. State the realistic investor types to target and what they will need to see.
3. Fund / LP readiness (investors & fund managers): thesis, track record & attribution, team & GP commitment, fund size vs strategy, portfolio construction & reserves, terms (fees, carry, hurdle), governance, operational DD readiness (admin, audit, valuation policy), LP-materials checklist (deck, PPM/LPA, DDQ, track-record schedule), next steps.
4. Market analysis: use web_search for current data. Structure: market definition, size (TAM/SAM/SOM with method and sources), growth drivers, regulation (esp. Singapore / ASEAN / GCC), competitors & positioning, customer segments, entry strategy & GTM, risks, and a clear recommendation. Mark estimates.
5. Articles: write in BANAHUB's voice — institutional, clear, practical, no hype; strong headline, 100-160 char meta description, H2/H3 structure, short paragraphs, actionable takeaways; no investment advice or promises. Save with save_article_draft (HTML body) and tell the CEO it is waiting in Blog for review.
6. Operations: prioritise what needs attention (pending members, new submissions, enquiries, overdue tasks/invoices, security), recommend next steps, create tasks.

Today: ${ctx.today} (Asia/Singapore).
Admin OS panels you can open (id — label):
${ctx.panels}
What the CEO is looking at right now: ${ctx.context || "—"}
Live platform snapshot:
${ctx.snapshot}`;

/* ------------------------------------------------------------------ tools */
const PROPOSE_KINDS = ["approve_member", "reject_member", "publish_article", "update_enquiry", "review_submission", "grant_data_room", "create_event_draft", "update_raise"];
const TOOLS: any[] = [
  { name: "search_platform", description: "Search BANAHUB data by keyword (name, company, email, sector…). Returns compact rows with ids.", input_schema: { type: "object", properties: { query: { type: "string" }, kinds: { type: "array", items: { type: "string", enum: ["members", "investors", "raises", "enquiries", "companies", "articles", "events", "crm", "partners"] } } }, required: ["query"] } },
  { name: "list_records", description: "List recent records of one kind with optional status filter (e.g. pending members, new raises, open enquiries, draft articles).", input_schema: { type: "object", properties: { kind: { type: "string", enum: ["members", "investors", "raises", "enquiries", "articles", "events", "tasks", "invoices", "pitch_sessions"] }, status: { type: "string" }, limit: { type: "integer" } }, required: ["kind"] } },
  { name: "get_record", description: "Get the full record. For raises and investors also returns the deck info and the data-room file list.", input_schema: { type: "object", properties: { kind: { type: "string", enum: ["member", "investor", "raise", "enquiry", "article", "event", "company"] }, id: { type: "string" } }, required: ["kind", "id"] } },
  { name: "read_document", description: "Read a pitch deck or data-room file so you can analyse it. Give deal_room_id (company raise deck), investor_id (fund / investor deck) or data_room_file_id.", input_schema: { type: "object", properties: { deal_room_id: { type: "string" }, investor_id: { type: "string" }, data_room_file_id: { type: "string" } } } },
  { name: "create_task", description: "Create a task / reminder in the CEO's task list (runs immediately).", input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, priority: { type: "string", enum: ["high", "normal", "low"] }, notes: { type: "string" } }, required: ["title"] } },
  { name: "save_article_draft", description: "Save an article as an UNPUBLISHED draft in the Blog (runs immediately). body_html uses <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a>.", input_schema: { type: "object", properties: { title: { type: "string" }, body_html: { type: "string" }, category: { type: "string" }, meta_description: { type: "string" }, tags: { type: "string" } }, required: ["title", "body_html"] } },
  { name: "propose_action", description: `Propose a data-changing action for the CEO to confirm with one click. kinds: approve_member {user_id}; reject_member {user_id}; publish_article {article_id}; update_enquiry {enquiry_id, status: new|in_progress|responded|closed, notes?}; review_submission {kind: raise|investor, id, review_status: in_review|needs_info|accepted|declined, note?}; grant_data_room {deal_room_id|investor_id, grantee_user_id, days?, can_download?}; create_event_draft {title, event_date?(ISO), location?, description?, format?: in_person|virtual|hybrid}; update_raise {deal_room_id, pipeline_stage?, next_action?, next_action_date?}.`, input_schema: { type: "object", properties: { kind: { type: "string", enum: PROPOSE_KINDS }, params: { type: "object" }, summary: { type: "string", description: "One line shown on the confirm button, e.g. 'Approve Jane Tan (Hopp Capital)'" } }, required: ["kind", "params", "summary"] } },
  { name: "open_panel", description: "Offer a button that opens an Admin OS panel.", input_schema: { type: "object", properties: { panel: { type: "string" }, label: { type: "string" } }, required: ["panel"] } },
];

const DOC_MAX = 24 * 1048576;
async function fileToBlocks(name: string, mime: string, bytes: Uint8Array): Promise<any[]> {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (bytes.byteLength > DOC_MAX) return [{ type: "text", text: `[${name}: file is larger than 24 MB — ask for a smaller PDF export]` }];
  if (ext === "pdf" || mime === "application/pdf")
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") }, title: clip(name, 200) }];
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext))
    return [{ type: "image", source: { type: "base64", media_type: ext === "jpg" ? "image/jpeg" : `image/${ext}`, data: Buffer.from(bytes).toString("base64") } }];
  try {
    if (ext === "docx") { const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }); return [{ type: "text", text: `[${name}]\n${clip(r.value, 120000)}` }]; }
    if (["xlsx", "xls", "csv"].includes(ext)) {
      const wb = XLSX.read(bytes, { type: "array" });
      const txt = wb.SheetNames.slice(0, 12).map((n) => `## Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n]).split("\n").slice(0, 400).join("\n")}`).join("\n\n");
      return [{ type: "text", text: `[${name}]\n${clip(txt, 120000)}` }];
    }
    if (["txt", "md", "json", "html", "htm"].includes(ext) || /^text\//.test(mime)) return [{ type: "text", text: `[${name}]\n${clip(new TextDecoder().decode(bytes), 120000)}` }];
  } catch (e) { return [{ type: "text", text: `[${name}: could not be read — ${(e as Error).message}]` }]; }
  return [{ type: "text", text: `[${name}: .${ext} files can't be read — ask for a PDF export]` }];
}

const ROW = {
  members: "id,full_name,email,company_name,role,member_category,status,country,linkedin_verified,created_at",
  investors: "id,organization,full_name,email,investor_type,investor_subtype,hq_country,check_min,check_max,check_currency,preferred_stages,focus_sectors,invest_geographies,review_status,user_id",
  raises: "id,company_name,company_type,stage,target_raise,currency,raised_amount,sectors,industries,hq_country,review_status,pipeline_stage,campaign_status,submitted_by,submitted_at,next_action,deck_path",
  enquiries: "id,name,email,company,service,status,priority,message,created_at,responded_at",
  companies: "id,company_name,stage,industry,status,website,email,contact_name",
  articles: "id,title,status,published,category,publish_date,created_at,author_name",
  events: "id,title,event_date,location,format,published,capacity",
  crm: "id,name,company,email,contact_type,pipeline_stage,next_action,next_action_date",
  partners: "id,name,type,tier,category,website,published",
  tasks: "id,title,due_date,priority,status,notes",
  invoices: "id,number,customer_name,customer_email,status,total,amount_remaining,currency,due_date",
  pitch_sessions: "id,user_id,mode,persona,difficulty,status,score,summary,created_at",
};
const TABLE: Record<string, string> = { members: "users", investors: "investors", raises: "deal_rooms", enquiries: "enquiries", companies: "companies", articles: "articles", events: "events", crm: "crm_contacts", partners: "partners", tasks: "os_tasks", invoices: "stripe_invoices", pitch_sessions: "pitch_sessions" };
const SEARCH_COLS: Record<string, string[]> = {
  members: ["full_name", "email", "company_name"], investors: ["organization", "full_name", "email"], raises: ["company_name", "description"],
  enquiries: ["name", "email", "company", "message"], companies: ["company_name", "email", "description"], articles: ["title", "category"],
  events: ["title", "location"], crm: ["name", "company", "email"], partners: ["name", "description"],
};

type Ctx = { sb: SupabaseClient; uid: string; extra: any[]; proposals: any[]; navs: any[]; created: any[] };
async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }

async function runTool(name: string, input: any, c: Ctx): Promise<unknown> {
  const sb = c.sb;
  switch (name) {
    case "search_platform": {
      const term = clip(input.query, 80).trim(); if (term.length < 2) return { error: "query too short" };
      const kinds: string[] = (Array.isArray(input.kinds) && input.kinds.length ? input.kinds : Object.keys(SEARCH_COLS)).filter((k: string) => SEARCH_COLS[k]);
      const out: Record<string, unknown> = {};
      await Promise.all(kinds.map(async (k) => {
        const r = await sb.from(TABLE[k]).select((ROW as any)[k]).or(SEARCH_COLS[k].map((col) => `${col}.ilike.${like(term)}`).join(",")).limit(8);
        if (!r.error && r.data?.length) out[k] = r.data;
      }));
      return Object.keys(out).length ? out : { results: "none" };
    }
    case "list_records": {
      const k = String(input.kind); if (!TABLE[k]) return { error: "unknown kind" };
      let qq: any = sb.from(TABLE[k]).select((ROW as any)[k]);
      const st = clip(input.status, 40);
      if (st) qq = qq.eq(k === "raises" || k === "investors" ? "review_status" : "status", st);
      if (k === "raises") qq = qq.not("submitted_by", "is", null);
      const order = { events: "event_date", tasks: "due_date", raises: "submitted_at" } as Record<string, string>;
      qq = qq.order(order[k] || "created_at", { ascending: k === "tasks", nullsFirst: false }).limit(Math.min(50, Math.max(1, Number(input.limit) || 15)));
      return await q(qq);
    }
    case "get_record": {
      const map: Record<string, string> = { member: "users", investor: "investors", raise: "deal_rooms", enquiry: "enquiries", article: "articles", event: "events", company: "companies" };
      const t = map[input.kind]; if (!t || !isId(input.id)) return { error: "bad kind or id" };
      const row: any = await q(sb.from(t).select("*").eq("id", input.id).maybeSingle()); if (!row) return { error: "not found" };
      if (input.kind === "raise" || input.kind === "investor") {
        const col = input.kind === "raise" ? "deal_room_id" : "investor_id";
        row._data_room_files = (await sb.from("data_room_files").select("id,folder,name,size,mime,created_at").eq(col, input.id).order("folder")).data || [];
        row._deck = row.deck_path ? { name: row.deck_name, size: row.deck_size } : null;
        const owner = row.submitted_by || row.user_id;
        if (owner) row._owner = (await sb.from("users").select("id,full_name,email,company_name,member_category,status,linkedin_verified").eq("id", owner).maybeSingle()).data;
      }
      if (input.kind === "article" && row.body) row.body = clip(row.body, 20000);
      return row;
    }
    case "read_document": {
      let bucket = "", path = "", fname = "";
      if (isId(input.data_room_file_id)) {
        const f: any = await q(sb.from("data_room_files").select("name,path,mime").eq("id", input.data_room_file_id).maybeSingle());
        if (!f) return { error: "file not found" }; bucket = "dataroom"; path = f.path; fname = f.name;
      } else if (isId(input.deal_room_id) || isId(input.investor_id)) {
        const r: any = await q(sb.from(isId(input.deal_room_id) ? "deal_rooms" : "investors").select("deck_path,deck_name,deck_url").eq("id", input.deal_room_id || input.investor_id).maybeSingle());
        if (!r) return { error: "record not found" };
        if (!r.deck_path) return { error: "no deck uploaded", deck_link: r.deck_url || null };
        bucket = "decks"; path = r.deck_path; fname = r.deck_name || "deck.pdf";
      } else return { error: "give deal_room_id, investor_id or data_room_file_id" };
      const { data, error } = await db.storage.from(bucket).download(path);
      if (error || !data) return { error: "could not download file" };
      const blocks = await fileToBlocks(fname, data.type, new Uint8Array(await data.arrayBuffer()));
      c.extra.push({ type: "text", text: `Contents of ${fname} (requested via read_document):` }, ...blocks);
      return { ok: true, file: fname, note: "The document is attached right after this tool result." };
    }
    case "create_task": {
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(input.due)) ? input.due : null;
      const row: any = await q(sb.from("os_tasks").insert({ title: clip(input.title, 200), due_date: due, priority: ["high", "normal", "low"].includes(input.priority) ? input.priority : "normal", notes: clip(input.notes, 2000) || null, status: "open", entity_type: "other", assignee_id: c.uid, created_by: c.uid }).select("id,title,due_date,priority").single());
      c.created.push({ type: "task", ...row }); return { created: row };
    }
    case "save_article_draft": {
      const title = clip(input.title, 200).trim(); if (!title) return { error: "title required" };
      const body = clip(input.body_html, 120000).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "");
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) + "-" + Date.now().toString(36);
      const row: any = await q(sb.from("articles").insert({ title, body, slug, status: "draft", published: false, category: clip(input.category, 80) || null, meta_description: clip(input.meta_description, 300) || null, tags: clip(input.tags, 300) || null, author_id: c.uid, author_name: "BANAHUB" }).select("id,title").single());
      c.created.push({ type: "article", ...row }); c.navs.push({ panel: "blog", label: "Review draft in Blog" });
      return { saved_as_draft: row };
    }
    case "propose_action": {
      if (!PROPOSE_KINDS.includes(input.kind)) return { error: "unknown kind" };
      c.proposals.push({ kind: input.kind, params: input.params || {}, summary: clip(input.summary, 160) });
      return { proposed: true, note: "Shown to the CEO as a Confirm button — it has NOT run yet." };
    }
    case "open_panel": { c.navs.push({ panel: clip(input.panel, 40), label: clip(input.label, 60) || null }); return { ok: true }; }
  }
  return { error: "unknown tool" };
}

/* ------------------------------------------------------------------ confirmed actions */
async function execute(kind: string, p: any, sb: SupabaseClient, uid: string) {
  const one = async (pp: PromiseLike<any>) => { const r = await pp; if (r.error) throw new HttpError(400, r.error.message); return r.data; };
  let res: any; let label = kind;
  switch (kind) {
    case "approve_member": case "reject_member": {
      if (!isId(p.user_id)) throw new HttpError(400, "user_id required");
      res = await one(sb.from("users").update({ status: kind === "approve_member" ? "approved" : "rejected" }).eq("id", p.user_id).select("id,email,status").single()); label = `${res.email} → ${res.status}`; break;
    }
    case "publish_article": {
      if (!isId(p.article_id)) throw new HttpError(400, "article_id required");
      res = await one(sb.from("articles").update({ published: true, status: "published", publish_date: new Date().toISOString().slice(0, 10) }).eq("id", p.article_id).select("id,title").single()); label = `published “${res.title}”`; break;
    }
    case "update_enquiry": {
      if (!isId(p.enquiry_id) || !["new", "in_progress", "responded", "closed"].includes(p.status)) throw new HttpError(400, "enquiry_id and valid status required");
      const patch: any = { status: p.status }; if (p.notes) patch.notes = clip(p.notes, 4000); if (p.status === "responded") patch.responded_at = new Date().toISOString();
      res = await one(sb.from("enquiries").update(patch).eq("id", p.enquiry_id).select("id,name,status").single()); label = `${res.name} → ${res.status}`; break;
    }
    case "review_submission": {
      if (!isId(p.id) || !["in_review", "needs_info", "accepted", "declined"].includes(p.review_status)) throw new HttpError(400, "id and valid review_status required");
      const patch: any = { review_status: p.review_status, review_note: clip(p.note, 2000) || null };
      if (p.kind === "raise") { if (p.review_status === "accepted") patch.pipeline_stage = "screening"; if (p.review_status === "declined") patch.pipeline_stage = "lost"; res = await one(sb.from("deal_rooms").update(patch).eq("id", p.id).select("id,company_name,review_status").single()); label = `${res.company_name} → ${res.review_status}`; }
      else { if (p.review_status === "accepted") patch.status = "approved"; res = await one(sb.from("investors").update(patch).eq("id", p.id).select("id,organization,review_status").single()); label = `${res.organization} → ${res.review_status}`; }
      break;
    }
    case "grant_data_room": {
      if (!isId(p.grantee_user_id) || !(isId(p.deal_room_id) || isId(p.investor_id))) throw new HttpError(400, "room and grantee required");
      const days = Math.min(365, Math.max(1, Number(p.days) || 30));
      res = await one(sb.from("data_room_access").insert({ deal_room_id: isId(p.deal_room_id) ? p.deal_room_id : null, investor_id: isId(p.deal_room_id) ? null : p.investor_id, grantee_id: p.grantee_user_id, granted_by: uid, can_download: !!p.can_download, expires_at: new Date(Date.now() + days * 864e5).toISOString() }).select("id").single());
      label = `data room access granted for ${days} days`; break;
    }
    case "create_event_draft": {
      const title = clip(p.title, 200).trim(); if (!title) throw new HttpError(400, "title required");
      res = await one(sb.from("events").insert({ title, event_date: p.event_date && !isNaN(Date.parse(p.event_date)) ? new Date(p.event_date).toISOString() : null, location: clip(p.location, 200) || null, description: clip(p.description, 10000) || null, format: ["in_person", "virtual", "hybrid"].includes(p.format) ? p.format : null, published: false, created_by: uid }).select("id,title").single());
      label = `event draft “${res.title}” created`; break;
    }
    case "update_raise": {
      if (!isId(p.deal_room_id)) throw new HttpError(400, "deal_room_id required");
      const patch: any = {}; ["pipeline_stage", "next_action"].forEach((k) => { if (p[k]) patch[k] = clip(p[k], 300); });
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(p.next_action_date))) patch.next_action_date = p.next_action_date;
      if (!Object.keys(patch).length) throw new HttpError(400, "nothing to update");
      res = await one(sb.from("deal_rooms").update(patch).eq("id", p.deal_room_id).select("id,company_name,pipeline_stage").single()); label = `${res.company_name} updated`; break;
    }
    default: throw new HttpError(400, "Unknown action");
  }
  await sb.from("activity_logs").insert({ action: `admin.ben_${kind}`, category: "admin", description: clip(label, 300) });
  return { done: true, label, result: res };
}

/* ------------------------------------------------------------------ claude */
async function claude(body: any) {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { console.error("anthropic", r.status, JSON.stringify(j).slice(0, 600)); throw Object.assign(new Error(j?.error?.message || "AI error"), { status: r.status }); }
  return j;
}

Deno.serve(async (req) => {
  const h = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: h });
  try {
    const authz = req.headers.get("Authorization") || "";
    const { data: auth } = await db.auth.getUser(authz.replace(/^Bearer\s+/i, ""));
    if (!auth?.user) throw new HttpError(401, "Please sign in");
    const { data: u } = await db.from("users").select("id, role, blocked, full_name").eq("id", auth.user.id).maybeSingle();
    if (!u || u.role !== "admin" || u.blocked) throw new HttpError(403, "Admins only");
    const sb = createClient(URL_, ANON, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
    const b = await req.json().catch(() => ({}));
    if (b.probe) {
      if (!KEY) { console.log("ben probe: ANTHROPIC_API_KEY not set"); return out({ ai: false, reason: "ANTHROPIC_API_KEY is not set in Supabase Edge Function secrets" }); }
      if (!keyCheck || Date.now() - keyCheck.at > 600000) {
        try { await claude({ model: MODEL, max_tokens: 5, messages: [{ role: "user", content: "ping" }] }); keyCheck = { at: Date.now(), ok: true, msg: "" }; }
        catch (e: any) { keyCheck = { at: Date.now(), ok: false, msg: `${e.status || ""} ${clip(e.message, 160)}` }; }
        console.log(`ben probe: key ${KEY.trim().startsWith("sk-ant-") ? "format ok" : "unexpected format"}; model ${MODEL}; anthropic ${keyCheck.ok ? "OK" : "FAILED " + keyCheck.msg}`);
      }
      return out({ ai: keyCheck.ok, model: MODEL, web: WEB, reason: keyCheck.ok ? null : "Anthropic rejected the request: " + keyCheck.msg });
    }
    if (b.execute) return out(await execute(String(b.execute.kind), b.execute.params || {}, sb, u.id));
    if (!KEY) return out({ ai: false });

    const message = clip(b.message, 8000).trim();
    if (!message) throw new HttpError(400, "Empty message");
    const userBlocks: any[] = [];
    for (const a of (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 4)) {
      if (!a?.data) continue;
      const bytes = Uint8Array.from(atob(String(a.data)), (ch) => ch.charCodeAt(0));
      userBlocks.push({ type: "text", text: `Attached by the CEO: ${clip(a.name, 200)}` }, ...(await fileToBlocks(clip(a.name, 200), clip(a.mime, 100), bytes)));
    }
    userBlocks.push({ type: "text", text: message });

    const ctx = {
      panels: (Array.isArray(b.panels) ? b.panels : []).slice(0, 120).map((p: any) => `${clip(p.id, 40)} — ${clip(p.label, 60)}`).join("\n"),
      snapshot: clip(JSON.stringify(b.snapshot ?? {}), 10000),
      today: /^\d{4}-\d{2}-\d{2}$/.test(String(b.today)) ? b.today : new Date().toISOString().slice(0, 10),
      context: clip(b.context, 600), me: u.full_name || "the CEO",
    };
    const history = (Array.isArray(b.history) ? b.history : []).slice(-12).filter((m: any) => (m.role === "user" || m.role === "assistant") && m.content).map((m: any) => ({ role: m.role, content: clip(m.content, 6000) }));
    while (history.length && history[0].role !== "user") history.shift();
    for (let i = history.length - 1; i > 0; i--) if (history[i].role === history[i - 1].role) history.splice(i, 1);
    if (history.length && history[history.length - 1].role === "user") history.pop();

    const c: Ctx = { sb, uid: u.id, extra: [], proposals: [], navs: [], created: [] };
    let tools = WEB ? [...TOOLS, { type: "web_search_20250305", name: "web_search", max_uses: 6 }] : TOOLS;
    const messages: any[] = [...history, { role: "user", content: userBlocks }];
    const system = SYSTEM(ctx);
    let final: any = null; const sources = new Map<string, string>();
    const started = Date.now();
    for (let step = 0; step < 10; step++) {
      let j: any;
      try { j = await claude({ model: MODEL, max_tokens: 6000, system, tools, messages }); }
      catch (e: any) { if (tools !== TOOLS && /web_search|tool/i.test(e.message)) { tools = TOOLS; j = await claude({ model: MODEL, max_tokens: 6000, system, tools, messages }); } else throw e; }
      messages.push({ role: "assistant", content: j.content });
      for (const blk of j.content || []) for (const ci of blk.citations || []) if (ci.url) sources.set(ci.url, ci.title || ci.url);
      final = j;
      if (j.stop_reason === "pause_turn") continue;
      if (j.stop_reason !== "tool_use") break;
      if (Date.now() - started > 110000) break;
      const results: any[] = [];
      for (const blk of j.content) if (blk.type === "tool_use") {
        let r: unknown; try { r = await runTool(blk.name, blk.input || {}, c); } catch (e) { r = { error: (e as Error).message }; }
        results.push({ type: "tool_result", tool_use_id: blk.id, content: clip(JSON.stringify(r), 60000) });
      }
      messages.push({ role: "user", content: [...results, ...c.extra.splice(0)] });
    }
    // text of the last assistant turn(s) after the final tool round
    let reply = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]; if (m.role !== "assistant") break;
      const t = (m.content || []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("").trim(); if (t) reply = t + (reply ? "\n\n" + reply : "");
    }
    if (!reply && final?.stop_reason === "tool_use") reply = "I ran out of time on that one — ask me to continue and I'll pick up where I left off.";
    return out({ ai: true, reply: clip(reply, 60000), sources: [...sources].slice(0, 12).map(([url, title]) => ({ url, title })), proposals: c.proposals.slice(0, 8), navs: c.navs.slice(0, 6), created: c.created });
  } catch (e: any) {
    if (!(e instanceof HttpError)) console.error(e);
    const status = e instanceof HttpError ? e.status : e?.status === 429 ? 429 : 500;
    return out({ error: e instanceof HttpError ? e.message : status === 429 ? "Ben is busy — try again in a minute" : "Ben hit an error — " + clip(e?.message, 200) }, status);
  }
});
