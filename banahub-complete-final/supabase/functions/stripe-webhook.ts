// supabase/functions/stripe-webhook/index.ts
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
//   (--no-verify-jwt is required: Stripe calls this directly, not as
//    an authenticated Supabase user — signature verification below is
//    what actually secures this endpoint, not a Supabase JWT)
// Secrets: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// Register this URL in Stripe Dashboard → Developers → Webhooks:
//   https://mfqdqisbryoepdpqebkb.supabase.co/functions/v1/stripe-webhook
//   Events to send:
//     checkout.session.completed
//     checkout.session.expired
//     customer.subscription.updated
//     customer.subscription.deleted
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
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://www.banahub.com";

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
    const userId = session.metadata?.user_id || null;
    const itemType = session.metadata?.item_type;
    const billing = session.metadata?.billing; // 'monthly' | 'annual'
    const stripeSubId = typeof session.subscription === "string" ? session.subscription : null;

    // Mark transaction completed
    await sb.from("transactions")
      .update({
        status: "completed",
        stripe_payment_intent_id: session.payment_intent as string,
      })
      .eq("stripe_session_id", session.id);

    // If membership checkout → activate subscription record
    if (itemType === "membership" && userId) {
      await sb.from("subscriptions").upsert({
        user_id: userId,
        plan: billing === "monthly" ? "Monthly" : "Annual",
        status: "active",
        stripe_subscription_id: stripeSubId,
      }, { onConflict: "user_id" });
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id || null;
    await sb.from("transactions")
      .update({ status: "failed" })
      .eq("stripe_session_id", session.id);
    // Revert pending subscription to cancelled
    if (userId) {
      await sb.from("subscriptions")
        .update({ status: "cancelled" })
        .eq("user_id", userId)
        .eq("status", "pending");
    }
  }

  // Stripe subscription lifecycle events (monthly plan renewals/cancellations)
  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as Stripe.Subscription;
    const stripeStatus = sub.status; // active, past_due, canceled, etc.
    const dbStatus = stripeStatus === "active" ? "active"
      : stripeStatus === "canceled" || stripeStatus === "cancelled" ? "cancelled"
      : stripeStatus === "past_due" ? "pending"
      : stripeStatus;
    await sb.from("subscriptions")
      .update({ status: dbStatus })
      .eq("stripe_subscription_id", sub.id);
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await sb.from("subscriptions")
      .update({ status: "cancelled" })
      .eq("stripe_subscription_id", sub.id);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
