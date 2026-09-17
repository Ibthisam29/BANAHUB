// supabase/functions/create-checkout-session/index.ts
// Deploy: supabase functions deploy create-checkout-session
// Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//
// SECURITY MODEL:
// - Client sends only { item_type: 'program'|'event', item_id, success_url, cancel_url }.
// - Price is looked up server-side from the DB — the client can NEVER
//   set or influence the amount charged. This closes the classic
//   "edit the hidden price field in devtools" exploit.
// - Card data never touches this function or your server at all —
//   Stripe Checkout is a Stripe-hosted page; you only get a URL back.
// - Uses the service_role key (server-side only) to read price_amount,
//   bypassing RLS safely since this function only reads, never writes
//   arbitrary data on the caller's behalf.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = "https://www.banahub.com";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_ITEM_TYPES = ["program", "event", "sponsorship_package"];

serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": SITE_URL,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { item_type, item_id, email } = await req.json();

    if (!ALLOWED_ITEM_TYPES.includes(item_type) || !item_id) {
      return new Response(JSON.stringify({ error: "Invalid item_type or item_id" }), { status: 400, headers: cors });
    }

    // Identify the authenticated user if a session token was sent (optional — guest checkout allowed)
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await sb.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }

    // ── Server-side price lookup — the ONLY source of truth for amount ──
    const table = item_type === "program" ? "programs" : item_type === "sponsorship_package" ? "sponsorship_packages" : "events";
    const titleColumn = item_type === "sponsorship_package" ? "name" : "title";
    const { data: item, error } = await sb
      .from(table)
      .select(`id, ${titleColumn}, price_amount, currency, published`)
      .eq("id", item_id)
      .single();

    if (error || !item) {
      return new Response(JSON.stringify({ error: "Item not found" }), { status: 404, headers: cors });
    }
    if (!item.published) {
      return new Response(JSON.stringify({ error: "Item not available" }), { status: 403, headers: cors });
    }
    if (!item.price_amount || item.price_amount <= 0) {
      return new Response(JSON.stringify({ error: "This item is free — use direct registration, not checkout" }), { status: 400, headers: cors });
    }
    const itemLabel = item[titleColumn];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency: (item.currency || "SGD").toLowerCase(),
          product_data: { name: itemLabel },
          unit_amount: Math.round(item.price_amount * 100), // Stripe uses cents
        },
        quantity: 1,
      }],
      success_url: `${SITE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/${item_type === "program" ? "programs" : item_type === "sponsorship_package" ? "events" : "events"}.html`,
      metadata: { item_type, item_id, user_id: userId || "" },
    });

    // Pre-log as pending — webhook flips this to 'completed' on confirmed payment
    await sb.from("transactions").insert({
      user_id: userId,
      email: email || null,
      type: item_type === "program" ? "program_payment" : item_type === "sponsorship_package" ? "sponsorship_payment" : "event_registration",
      item_type,
      item_id,
      amount: item.price_amount,
      currency: item.currency || "SGD",
      stripe_session_id: session.id,
      status: "pending",
    });

    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers: cors });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Checkout session creation failed" }), { status: 500, headers: cors });
  }
});
