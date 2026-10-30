// BANAHUB Stripe webhook — the ONLY place payments are confirmed and access is granted.
// Deploy with JWT verification OFF (Stripe calls it directly); the signature check below is the security boundary.
// Endpoint: https://<project>.supabase.co/functions/v1/stripe-webhook
// Events: checkout.session.completed, checkout.session.expired, customer.subscription.created,
//         customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed,
//         invoice.overdue, invoice.finalized, payment_intent.succeeded, charge.refunded
// Idempotent: every event id is stored in public.stripe_events; an event already processed is acknowledged and skipped.
import { cryptoProvider, db, json, mrrOf, Stripe, stripe, ts } from "../_shared/stripe.ts";

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const PLAN_NAMES: Record<string, string> = { growth: "Growth", scale: "Scale" };

async function ceoId(): Promise<string | null> {
  const { data } = await db.from("users").select("id").eq("role", "admin").order("created_at").limit(1);
  return data?.[0]?.id ?? null;
}
async function task(title: string, days = 2, priority = "normal", notes?: string) {
  try {
    await db.from("os_tasks").insert({ title, entity_type: "other", assignee_id: await ceoId(), due_date: new Date(Date.now() + days * 864e5).toISOString().slice(0, 10), priority, notes: notes ?? null, status: "open" });
  } catch (e) { console.error("task", e); }
}
async function userIdFor(customer: string | null, meta?: Stripe.Metadata | null): Promise<string | null> {
  if (meta?.user_id) return meta.user_id;
  if (!customer) return null;
  const { data } = await db.from("memberships").select("user_id").eq("stripe_customer_id", customer).maybeSingle();
  if (data?.user_id) return data.user_id;
  const c = await stripe.customers.retrieve(customer);
  return (c as Stripe.Customer).metadata?.user_id || null;
}
const cid = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

// Mirror a Stripe subscription onto public.memberships (billing fields only)
async function syncSubscription(sub: Stripe.Subscription, deleted = false) {
  const customer = cid(sub.customer);
  const uid = await userIdFor(customer, sub.metadata);
  if (!uid) { console.warn("subscription without user", sub.id); return null; }
  const item = sub.items.data[0];
  const price = item?.price;
  const plan = sub.metadata?.plan_code || price?.metadata?.plan_code || price?.metadata?.tier || null;
  if (!plan) { console.warn("subscription without plan", sub.id); return null; }
  const { data: cur } = await db.from("memberships").select("*").eq("user_id", uid).maybeSingle();
  // a different, newer subscription already owns this membership: ignore stale events from an old one
  if (cur?.stripe_subscription_id && cur.stripe_subscription_id !== sub.id && (deleted || ["canceled", "incomplete_expired"].includes(sub.status))) return null;
  const method = sub.collection_method === "send_invoice" ? "paynow" : "card";
  const paidCurrent = cur?.access_until && new Date(cur.access_until) >= new Date(sub.current_period_end * 1000 - 864e5);
  const status = deleted || sub.status === "canceled" ? "canceled"
    : sub.status === "incomplete_expired" ? "expired"
    : sub.status === "incomplete" ? "incomplete"
    : sub.status === "past_due" || sub.status === "unpaid" ? "past_due"
    // PayNow renewal invoice open: still active during the 7-day payment window, then past due
    : method === "paynow" && !paidCurrent ? (!cur?.access_until ? "pending_payment" : new Date(cur.access_until).getTime() + 7 * 864e5 > Date.now() ? "active" : "past_due")
    : "active";
  await db.from("memberships").upsert({
    user_id: uid, plan_code: plan, status,
    billing_period: price?.recurring?.interval === "year" ? "annual" : "monthly",
    payment_method: method, stripe_customer_id: customer, stripe_subscription_id: sub.id,
    current_period_start: ts(sub.current_period_start), current_period_end: ts(sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: deleted || sub.status === "canceled" ? (ts(sub.canceled_at) ?? new Date().toISOString()) : (sub.cancel_at_period_end ? (ts(sub.canceled_at) ?? cur?.canceled_at ?? null) : null),
    mrr: mrrOf(price, item?.quantity ?? 1),
    payment_at_risk: status === "past_due",
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  return uid;
}

async function onInvoicePaid(inv: Stripe.Invoice) {
  const subId = cid(inv.subscription as string | Stripe.Subscription | null);
  const customer = cid(inv.customer as string | Stripe.Customer | null);
  const line = inv.lines?.data?.find((l) => l.type === "subscription") ?? inv.lines?.data?.[0];
  let uid: string | null = null; let sub: Stripe.Subscription | null = null;
  if (subId) { sub = await stripe.subscriptions.retrieve(subId); uid = await userIdFor(customer, sub.metadata); }
  else uid = await userIdFor(customer, inv.metadata);
  const plan = sub?.metadata?.plan_code || line?.price?.metadata?.plan_code || null;
  let method = sub?.collection_method === "send_invoice" ? "paynow" : "card";
  const chargeId = cid(inv.charge as string | Stripe.Charge | null);
  if (chargeId) {
    try { const ch = await stripe.charges.retrieve(chargeId); method = ch.payment_method_details?.type === "paynow" ? "paynow" : ch.payment_method_details?.type || method; } catch (_) { /* keep */ }
  }
  const periodEnd = ts(line?.period?.end ?? inv.period_end);
  // record the payment exactly once (unique on stripe_invoice_id)
  const { data: ins } = await db.from("transactions").upsert({
    user_id: uid, email: inv.customer_email, type: plan ? "membership_payment" : "invoice_payment", item_type: plan ? "membership" : "invoice",
    amount: (inv.amount_paid || 0) / 100, currency: (inv.currency || "sgd").toUpperCase(), status: "completed",
    stripe_invoice_id: inv.id, stripe_subscription_id: subId, stripe_customer_id: customer, stripe_charge_id: chargeId,
    stripe_payment_intent_id: cid(inv.payment_intent as string | Stripe.PaymentIntent | null),
    plan_code: plan, billing_period: line?.price?.recurring?.interval === "year" ? "annual" : line?.price?.recurring ? "monthly" : null,
    payment_method: method, period_start: ts(line?.period?.start ?? inv.period_start), period_end: periodEnd,
    revenue_source: plan ? "membership" : (inv.metadata?.revenue_source || "advisory"), paid_at: ts(inv.status_transitions?.paid_at) ?? new Date().toISOString(),
    description: line?.description || inv.description || null,
  }, { onConflict: "stripe_invoice_id", ignoreDuplicates: true }).select("id");
  if (!uid || !sub || !plan) return;
  await syncSubscription(sub);
  const { data: cur } = await db.from("memberships").select("access_until, paid_since").eq("user_id", uid).maybeSingle();
  const until = [cur?.access_until, periodEnd].filter(Boolean).sort().pop();
  await db.from("memberships").update({
    access_until: until, status: "active", payment_at_risk: false, plan_code: plan,
    paid_since: cur?.paid_since ?? ts(line?.period?.start) ?? new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("user_id", uid);
  // paying members get full portal access (blocked accounts stay blocked)
  await db.from("users").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", uid).in("status", ["pending", "pending_review"]).eq("blocked", false);
  if (inv.billing_reason === "subscription_create" && ins && ins.length) {
    const name = PLAN_NAMES[plan] || plan;
    await task(`Onboard new ${name} member: ${inv.customer_email || uid}`, 2, plan === "scale" ? "high" : "normal",
      `Welcome call, portal walkthrough, assign relationship owner. Paid by ${method}.`);
    if (plan === "scale") await task(`Schedule quarterly Growth Diagnostic: ${inv.customer_email || uid}`, 7, "high", "Scale membership — flag for advisory opportunity.");
  }
}

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
      case "invoice.paid": await onInvoicePaid(o as Stripe.Invoice); break;
      case "invoice.payment_failed": await onPaymentProblem(o as Stripe.Invoice, "failed"); break;
      case "invoice.overdue": await onPaymentProblem(o as Stripe.Invoice, "overdue"); break;
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
