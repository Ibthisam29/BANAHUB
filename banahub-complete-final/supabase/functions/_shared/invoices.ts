// Mirror Stripe invoices into public.stripe_invoices (used by stripe-webhook and billing-admin).
import { db, round2, Stripe, ts } from "./stripe.ts";

export const cid = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);
const amt = (n?: number | null) => round2((n || 0) / 100);

export async function userForCustomer(customer: string | null, email?: string | null, meta?: Stripe.Metadata | null): Promise<string | null> {
  if (meta?.user_id) return meta.user_id;
  if (customer) {
    const { data } = await db.from("memberships").select("user_id").eq("stripe_customer_id", customer).maybeSingle();
    if (data?.user_id) return data.user_id;
  }
  if (email) {
    const { data } = await db.from("users").select("id").ilike("email", email).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  return null;
}

export async function mirrorInvoice(inv: Stripe.Invoice, extra: Record<string, unknown> = {}) {
  const customer = cid(inv.customer as string | Stripe.Customer | null);
  const cust = typeof inv.customer === "object" && inv.customer && !("deleted" in inv.customer) ? inv.customer as Stripe.Customer : null;
  const uid = await userForCustomer(customer, inv.customer_email, inv.metadata || cust?.metadata);
  const lines = (inv.lines?.data || []).map((l) => ({
    description: l.description, amount: amt(l.amount), quantity: l.quantity,
    plan_code: l.price?.metadata?.plan_code || null, period_start: ts(l.period?.start), period_end: ts(l.period?.end),
  }));
  const sub = inv.lines?.data?.find((l) => l.type === "subscription") ?? inv.lines?.data?.[0];
  const plan = inv.subscription_details?.metadata?.plan_code || sub?.price?.metadata?.plan_code || inv.metadata?.plan_code || null;
  const ch = typeof inv.charge === "object" && inv.charge ? inv.charge as Stripe.Charge : null;
  const row = {
    id: inv.id, number: inv.number, user_id: uid, stripe_customer_id: customer,
    customer_email: inv.customer_email, customer_name: inv.customer_name,
    stripe_subscription_id: cid(inv.subscription as string | Stripe.Subscription | null),
    status: inv.status, collection_method: inv.collection_method, billing_reason: inv.billing_reason,
    currency: (inv.currency || "sgd").toUpperCase(), subtotal: amt(inv.subtotal), total: amt(inv.total),
    amount_paid: amt(inv.amount_paid), amount_due: amt(inv.amount_due), amount_remaining: amt(inv.amount_remaining),
    description: inv.description || sub?.description || null,
    revenue_source: inv.metadata?.revenue_source || (plan ? "membership" : inv.subscription ? "membership" : "advisory"),
    plan_code: plan, lines,
    stripe_charge_id: cid(inv.charge as string | Stripe.Charge | null),
    stripe_payment_intent_id: cid(inv.payment_intent as string | Stripe.PaymentIntent | null),
    paid_out_of_band: !!inv.paid_out_of_band,
    hosted_invoice_url: inv.hosted_invoice_url, invoice_pdf: inv.invoice_pdf,
    due_date: ts(inv.due_date), period_start: ts(sub?.period?.start ?? inv.period_start), period_end: ts(sub?.period?.end ?? inv.period_end),
    created_at: ts(inv.created), finalized_at: ts(inv.status_transitions?.finalized_at),
    paid_at: ts(inv.status_transitions?.paid_at), voided_at: ts(inv.status_transitions?.voided_at),
    livemode: inv.livemode, synced_at: new Date().toISOString(),
    ...(ch ? { amount_refunded: amt(ch.amount_refunded), payment_method: ch.payment_method_details?.type || null } : {}),
    ...(inv.paid_out_of_band ? { payment_method: "out_of_band" } : {}),
    ...extra,
  };
  const { error } = await db.from("stripe_invoices").upsert(row, { onConflict: "id" });
  if (error) console.error("mirrorInvoice", inv.id, error.message);
  return row;
}
