// supabase/functions/stripe-webhook/index.ts
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
//   (--no-verify-jwt is required: Stripe calls this directly, not as
//    an authenticated Supabase user — signature verification below is
//    what actually secures this endpoint, not a Supabase JWT)
// Secrets: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// Register this URL in Stripe Dashboard → Developers → Webhooks:
//   https://ositmmczozefrdzcgxrp.supabase.co/functions/v1/stripe-webhook
//   Events to send: checkout.session.completed, checkout.session.expired
//
// SECURITY MODEL:
// - Every request's signature is verified against STRIPE_WEBHOOK_SECRET.
//   A request without a valid signature is rejected outright — this is
//   what stops anyone from POSTing a fake "payment succeeded" event.
// - This is the ONLY place a transaction is ever marked 'completed'.
//   The client (create-checkout-session) only ever inserts 'pending'.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    // This line is the entire security boundary for this function.
    event = await stripe.webhooks.constructEventAsync(body, signature!, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await sb.from("transactions")
      .update({
        status: "completed",
        stripe_payment_intent_id: session.payment_intent as string,
      })
      .eq("stripe_session_id", session.id);

    // Optional: auto-enroll the buyer — e.g. mark program/event registration.
    // Uncomment and adapt once you have a registrations table:
    // await sb.from("registrations").insert({
    //   item_type: session.metadata?.item_type,
    //   item_id: session.metadata?.item_id,
    //   user_id: session.metadata?.user_id || null,
    //   email: session.customer_email,
    // });
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await sb.from("transactions")
      .update({ status: "failed" })
      .eq("stripe_session_id", session.id);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
