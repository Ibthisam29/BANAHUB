// Shared Stripe → Supabase sync logic (stripe-webhook + billing-admin).
import { db, mrrOf, Stripe, stripe, ts } from "./stripe.ts";

const PLAN_NAMES: Record<string, string> = { growth: "Growth", scale: "Scale" };
export async function ceoId(): Promise<string | null> {
  const { data } = await db.from("users").select("id").eq("role", "admin").order("created_at").limit(1);
  return data?.[0]?.id ?? null;
}
export async function task(title: string, days = 2, priority = "normal", notes?: string) {
  try {
    await db.from("os_tasks").insert({ title, entity_type: "other", assignee_id: await ceoId(), due_date: new Date(Date.now() + days * 864e5).toISOString().slice(0, 10), priority, notes: notes ?? null, status: "open" });
  } catch (e) { console.error("task", e); }
}
export async function userIdFor(customer: string | null, meta?: Stripe.Metadata | null): Promise<string | null> {
  if (meta?.user_id) return meta.user_id;
  if (!customer) return null;
  const { data } = await db.from("memberships").select("user_id").eq("stripe_customer_id", customer).maybeSingle();
  if (data?.user_id) return data.user_id;
  const c = await stripe.customers.retrieve(customer);
  return (c as Stripe.Customer).metadata?.user_id || null;
}
export const cid = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

// Mirror a Stripe subscription onto public.memberships (billing fields only)
export async function syncSubscription(sub: Stripe.Subscription, deleted = false) {
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

export async function onInvoicePaid(inv: Stripe.Invoice, opts: { tasks?: boolean } = { tasks: true }) {
  const subId = cid(inv.subscription as string | Stripe.Subscription | null);
  const customer = cid(inv.customer as string | Stripe.Customer | null);
  const line = inv.lines?.data?.find((l) => l.type === "subscription") ?? inv.lines?.data?.[0];
  let uid: string | null = null; let sub: Stripe.Subscription | null = null;
  if (subId) { sub = await stripe.subscriptions.retrieve(subId); uid = await userIdFor(customer, sub.metadata); }
  else uid = await userIdFor(customer, inv.metadata);
  const plan = sub?.metadata?.plan_code || line?.price?.metadata?.plan_code || null;
  let method = inv.paid_out_of_band ? "out_of_band" : sub?.collection_method === "send_invoice" ? "paynow" : "card";
  const chargeId = cid(inv.charge as string | Stripe.Charge | null);
  if (chargeId) {
    try { const ch = await stripe.charges.retrieve(chargeId); method = ch.payment_method_details?.type === "paynow" ? "paynow" : ch.payment_method_details?.type || method; } catch (_) { /* keep */ }
  }
  const periodEnd = ts(line?.period?.end ?? inv.period_end);
  // record the payment exactly once (unique on stripe_invoice_id)
  const { data: ins } = await db.from("transactions").upsert({
    user_id: uid, email: inv.customer_email, type: plan ? "membership_payment" : "invoice_payment", item_type: plan ? "membership" : "invoice",
    amount: (inv.amount_paid || (inv.paid_out_of_band ? inv.total : 0) || 0) / 100, currency: (inv.currency || "sgd").toUpperCase(), status: "completed",
    stripe_invoice_id: inv.id, stripe_subscription_id: subId, stripe_customer_id: customer, stripe_charge_id: chargeId,
    stripe_payment_intent_id: cid(inv.payment_intent as string | Stripe.PaymentIntent | null),
    plan_code: plan, billing_period: line?.price?.recurring?.interval === "year" ? "annual" : line?.price?.recurring ? "monthly" : null,
    payment_method: method, period_start: ts(line?.period?.start ?? inv.period_start), period_end: periodEnd,
    revenue_source: plan ? "membership" : (inv.metadata?.revenue_source || "advisory"),
    paid_at: ts(inv.status_transitions?.paid_at) ?? new Date().toISOString(),
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
  if (opts.tasks !== false && inv.billing_reason === "subscription_create" && ins && ins.length) {
    const name = PLAN_NAMES[plan] || plan;
    await task(`Onboard new ${name} member: ${inv.customer_email || uid}`, 2, plan === "scale" ? "high" : "normal",
      `Welcome call, portal walkthrough, assign relationship owner. Paid by ${method}.`);
    if (plan === "scale") await task(`Schedule quarterly Growth Diagnostic: ${inv.customer_email || uid}`, 7, "high", "Scale membership — flag for advisory opportunity.");
  }
}

