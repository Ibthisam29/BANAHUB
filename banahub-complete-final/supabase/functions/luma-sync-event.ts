// supabase/functions/luma-sync-event/index.ts
// Deploy: supabase functions deploy luma-sync-event
// Secrets: supabase secrets set LUMA_API_KEY=secret_...
//   (Luma Plus required — generate key at luma.com/calendar/manage/api-keys)
//
// Called from admin.html when the admin clicks "Sync to Luma" on an
// event. Creates the event on Luma the first time (stores luma_event_id),
// updates it on subsequent syncs. Never runs client-side — the Luma API
// key never reaches the browser.
//
// SECURITY: only a caller with an authenticated Supabase session AND
// role='admin' may trigger this — checked below before any Luma call.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LUMA_API_KEY = Deno.env.get("LUMA_API_KEY")!;
const LUMA_BASE = "https://public-api.luma.com/v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "https://www.banahub.com", "Access-Control-Allow-Headers": "authorization, content-type" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    // ── Admin gate — verify the caller's own session, not a client claim ──
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    }
    const { data: profile } = await sb.from("users").select("role").eq("id", userData.user.id).single();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden — admin only" }), { status: 403, headers: cors });
    }

    const { event_id } = await req.json();
    const { data: ev, error } = await sb.from("events").select("*").eq("id", event_id).single();
    if (error || !ev) return new Response(JSON.stringify({ error: "Event not found" }), { status: 404, headers: cors });

    const lumaPayload: Record<string, unknown> = {
      name: ev.title,
      description: ev.description || "",
      start_at: ev.event_date,
      end_at: ev.end_date || ev.event_date,
      timezone: "Asia/Singapore",
      geo_address_json: ev.location ? { address: ev.location } : undefined,
      require_rsvp: true,
      require_rsvp_approval: !!ev.require_approval,
      visibility: ev.invite_only ? "private" : "public",
    };

    const isUpdate = !!ev.luma_event_id;
    const lumaRes = await fetch(`${LUMA_BASE}/events/${isUpdate ? "update" : "create"}`, {
      method: "POST",
      headers: { "x-luma-api-key": LUMA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(isUpdate ? { event_api_id: ev.luma_event_id, ...lumaPayload } : lumaPayload),
    });
    const lumaData = await lumaRes.json();
    if (!lumaRes.ok) {
      console.error("Luma API error", lumaData);
      return new Response(JSON.stringify({ error: "Luma sync failed", detail: lumaData }), { status: 502, headers: cors });
    }

    const lumaEventId = lumaData.api_id || ev.luma_event_id;
    const lumaUrl = lumaData.url || ev.luma_url;

    await sb.from("events").update({ luma_event_id: lumaEventId, luma_url: lumaUrl }).eq("id", event_id);

    return new Response(JSON.stringify({ success: true, luma_event_id: lumaEventId, luma_url: lumaUrl }), { status: 200, headers: cors });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Sync failed" }), { status: 500, headers: cors });
  }
});
