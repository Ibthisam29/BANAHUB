// BANAHUB Data Room — short-lived signed URLs for files the caller may open, with a view / download log.
// POST { action:'open', file_id, download?: boolean } → { url, name, mime, size, watermark, can_download }
// Access is decided by RLS on data_room_files (owner, BANAHUB staff, or an active grant) evaluated as the caller.
// Grantees can download only when their grant allows it. Views by anyone other than the owner are logged.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL = (Deno.env.get("SITE_URL") || "https://banahub.com").replace(/\/$/, "");
const ORIGINS = [SITE_URL, "https://banahub.com", "https://www.banahub.com"];
const cors = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const allow = ORIGINS.includes(o) || /^https:\/\/banahub-[a-z0-9-]+\.vercel\.app$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SITE_URL;
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
};

Deno.serve(async (req) => {
  const h = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: h });
  try {
    const authz = req.headers.get("Authorization") || "";
    const { data: auth } = await db.auth.getUser(authz.replace(/^Bearer\s+/i, ""));
    if (!auth?.user) return out({ error: "Please sign in" }, 401);
    const uid = auth.user.id;
    const b = await req.json().catch(() => ({}));
    if (b.action !== "open" || !/^[0-9a-f-]{36}$/.test(String(b.file_id))) return out({ error: "Bad request" }, 400);

    // RLS check as the caller
    const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
    const { data: f } = await asUser.from("data_room_files").select("id, owner_id, deal_room_id, investor_id, name, path, mime, size").eq("id", b.file_id).maybeSingle();
    if (!f) return out({ error: "File not found or access expired" }, 404);

    const { data: me } = await db.from("users").select("full_name, email, role, company_name").eq("id", uid).maybeSingle();
    const owner = f.owner_id === uid, staff = me?.role === "admin" || !!(await asUser.rpc("os_can", { p: "raises.read" }).then((r) => r.data, () => false));
    let canDownload = owner || staff;
    if (!canDownload) {
      const col = f.deal_room_id ? "deal_room_id" : "investor_id";
      const { data: g } = await db.from("data_room_access").select("can_download, expires_at").eq(col, f.deal_room_id || f.investor_id).eq("grantee_id", uid).is("revoked_at", null).maybeSingle();
      if (!g || (g.expires_at && new Date(g.expires_at) < new Date())) return out({ error: "Access expired" }, 403);
      canDownload = !!g.can_download;
    }
    const download = !!b.download;
    if (download && !canDownload) return out({ error: "Downloads are disabled for this room" }, 403);

    const { data: s, error } = await db.storage.from("dataroom").createSignedUrl(f.path, 120, download ? { download: f.name } : undefined);
    if (error || !s) return out({ error: "Could not open file" }, 500);
    if (!owner) await db.from("data_room_views").insert({ file_id: f.id, viewer_id: uid, action: download ? "download" : "view" });
    const wm = `${me?.full_name || me?.email || "BANAHUB member"}${me?.company_name ? " · " + me.company_name : ""} · ${new Date().toISOString().slice(0, 10)} · Confidential`;
    return out({ url: s.signedUrl, name: f.name, mime: f.mime, size: f.size, watermark: owner ? null : wm, can_download: canDownload });
  } catch (e) {
    console.error(e);
    return out({ error: "Data room error" }, 500);
  }
});
