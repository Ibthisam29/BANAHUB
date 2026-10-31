// BANAHUB Stripe webhook — the ONLY place payments are confirmed and access is granted.
// Deploy with JWT verification OFF (Stripe calls it directly); the signature check below is the security boundary.
// Endpoint: https://<project>.supabase.co/functions/v1/stripe-webhook
// Events: checkout.session.completed, checkout.session.expired, customer.subscription.created,
//         customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed,
//         invoice.overdue, invoice.created, invoice.finalized, invoice.updated, invoice.sent, invoice.voided,
//         invoice.marked_uncollectible, charge.refunded
// Idempotent: every event id is stored in public.stripe_events; an event already processed is acknowledged and skipped.
import { cryptoProvider, db, json, Stripe, stripe } from "../_shared/stripe.ts";
import { cid, onInvoicePaid, syncSubscription, task, userIdFor } from "../_shared/sync.ts";
import { mirrorInvoice } from "../_shared/invoices.ts";

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

async function onPaymentProblem(inv: Stripe.Invoice, kind: "failed" | "overdue") {
  const subId = cid(inv.subscription as string | Stripe.Subscription | null);
  if (!subId) return;
  const uid = await userIdFor(cid(inv.customer as string | Stripe.Customer | null), null);
  if (!uid) return;
  const { data: m } = await db.from("memberships").select("access_until, payment_at_risk, plan_code").eq("user_id", uid).maybeSingle();
  // first PayNow invoice simply not paid yet: nothing to flag
  if (!m?.access_until && kind === "overdue") { await db.from("memberships").update({ status: "incomplete", updated_at: new Date().toISOString() }).eq("user_id", uid); return; }
  await db.from("memberships").update({ status: "past_due", payment_at_risk: true, updated_at: new Date().toISOString() }).eq("user_id", uid);
  if (!m?.payment_at_risk) await task(`Payment ${kind === "failed" ? "failed" : "overdue"}: ${inv.customer_email || uid} (${m?.plan_code})`, 1, "high",
    "Stripe will retry card payments; PayNow members must pay the open invoice. Contact the member if unresolved.");
}

async function onCheckoutCompleted(s: Stripe.Checkout.Session) {
  if (s.mode === "subscription") {
    const subId = cid(s.subscription as string | Stripe.Subscription | null);
    if (subId) await syncSubscription(await stripe.subscriptions.retrieve(subId));
    return;
  }
  // one-time payments (events, programmes, sponsorship) created by create-checkout-session
  if (s.payment_status === "paid") {
    await db.from("transactions").update({
      status: "completed", stripe_payment_intent_id: cid(s.payment_intent as string | Stripe.PaymentIntent | null),
      stripe_customer_id: cid(s.customer as string | Stripe.Customer | null), paid_at: new Date().toISOString(),
      payment_method: s.payment_method_types?.length === 1 ? s.payment_method_types[0] : null,
      revenue_source: s.metadata?.item_type === "program" ? "programme" : s.metadata?.item_type === "sponsorship_package" ? "sponsorship" : s.metadata?.item_type || null,
    }).eq("stripe_session_id", s.id).neq("status", "completed");
  }
}

async function onCharge(ch: Stripe.Charge) {
  const refunded = (ch.amount_refunded || 0) / 100;
  const status = ch.refunded ? "refunded" : refunded > 0 ? "partially_refunded" : undefined;
  const patch: Record<string, unknown> = { amount_refunded: refunded }; if (status) patch.status = status;
  const pi = cid(ch.payment_intent as string | Stripe.PaymentIntent | null);
  const { data } = await db.from("transactions").update(patch).eq("stripe_charge_id", ch.id).select("id");
  const invId = cid((ch as unknown as { invoice?: string | { id: string } | null }).invoice);
  if (invId) await db.from("stripe_invoices").update({ amount_refunded: refunded, synced_at: new Date().toISOString() }).eq("id", invId);
  if ((!data || !data.length) && pi) await db.from("transactions").update(patch).eq("stripe_payment_intent_id", pi);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig ?? "", WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    console.error("signature verification failed", (e as Error).message);
    return json({ error: "Invalid signature" }, 400);
  }
  const { data: seen } = await db.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
  if (seen?.processed_at) return json({ received: true, duplicate: true });
  if (!seen) await db.from("stripe_events").insert({ id: event.id, type: event.type, livemode: event.livemode });

  try {
    const o = event.data.object as unknown;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": await onCheckoutCompleted(o as Stripe.Checkout.Session); break;
      case "checkout.session.expired":
        await db.from("transactions").update({ status: "failed" }).eq("stripe_session_id", (o as Stripe.Checkout.Session).id).eq("status", "pending"); break;
      case "customer.subscription.created":
      case "customer.subscription.updated": await syncSubscription(o as Stripe.Subscription); break;
      case "customer.subscription.deleted": {
        const uid = await syncSubscription(o as Stripe.Subscription, true);
        const { data: was } = uid ? await db.from("memberships").select("access_until").eq("user_id", uid).maybeSingle() : { data: null };
        if (uid && was?.access_until) await task(`Membership cancelled — retention follow-up: ${uid}`, 3, "normal", "Ask why they left; record the churn reason in Admin OS → Membership.");
        break;
      }
      case "invoice.paid": await mirrorInvoice(o as Stripe.Invoice); await onInvoicePaid(o as Stripe.Invoice); break;
      case "invoice.payment_failed": await mirrorInvoice(o as Stripe.Invoice); await onPaymentProblem(o as Stripe.Invoice, "failed"); break;
      case "invoice.overdue": await mirrorInvoice(o as Stripe.Invoice); await onPaymentProblem(o as Stripe.Invoice, "overdue"); break;
      case "invoice.created": case "invoice.finalized": case "invoice.updated": case "invoice.sent":
      case "invoice.voided": case "invoice.marked_uncollectible": case "invoice.deleted":
        if (event.type === "invoice.deleted") await db.from("stripe_invoices").delete().eq("id", (o as Stripe.Invoice).id).eq("status", "draft");
        else await mirrorInvoice(o as Stripe.Invoice);
        break;
      case "charge.refunded": await onCharge(o as Stripe.Charge); break;
      default: break; // payment_intent.succeeded, invoice.finalized: acknowledged (payments are recorded from invoice.paid / checkout)
    }
    await db.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    return json({ received: true });
  } catch (e) {
    console.error("webhook processing failed", event.type, e);
    await db.from("stripe_events").update({ error: String((e as Error)?.message || e).slice(0, 500) }).eq("id", event.id);
    return json({ error: "Processing failed" }, 500); // Stripe retries
  }
});
