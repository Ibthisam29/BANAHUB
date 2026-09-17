// supabase/functions/luma-sync-guests/index.ts
// Deploy: supabase functions deploy luma-sync-guests
// Same secrets as luma-sync-event (LUMA_API_KEY, service role).
//
// Pulls the guest list for a synced event from Luma and mirrors it into
// event_rsvps so the admin sees RSVPs/approvals/check-ins without
// leaving BANAHub admin. Call on a "Sync RSVPs" button click, or on a
// schedule (e.g. Supabase cron every 15 min) for near-live numbers.

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
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !userData?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    const { data: profile } = await sb.from("users").select("role").eq("id", userData.user.id).single();
    if (profile?.role !== "admin") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: cors });

    const { event_id } = await req.json();
    const { data: ev } = await sb.from("events").select("id, luma_event_id").eq("id", event_id).single();
    if (!ev?.luma_event_id) return new Response(JSON.stringify({ error: "Event not synced to Luma yet" }), { status: 400, headers: cors });

    let cursor: string | undefined = undefined;
    let total = 0;
    do {
      const url = new URL(`${LUMA_BASE}/event/get-guests`);
      url.searchParams.set("event_api_id", ev.luma_event_id);
      if (cursor) url.searchParams.set("pagination_cursor", cursor);

      const res = await fetch(url.toString(), { headers: { "x-luma-api-key": LUMA_API_KEY } });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "Luma guest fetch failed", detail: data }), { status: 502, headers: cors });
      }

      const guests = data.entries || [];
      for (const g of guests) {
        await sb.from("event_rsvps").upsert({
          event_id: ev.id,
          luma_guest_id: g.api_id,
          name: g.name || g.guest?.name,
          email: g.email || g.guest?.email,
          approval_status: g.approval_status,
          checked_in: !!g.checked_in_at,
          synced_at: new Date().toISOString(),
        }, { onConflict: "event_id,luma_guest_id" });
        total++;
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return new Response(JSON.stringify({ success: true, synced: total }), { status: 200, headers: cors });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Guest sync failed" }), { status: 500, headers: cors });
  }
});
