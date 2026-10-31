// BANAHUB billing admin — Admin OS → Payments & Invoices. Admins only (public.users.role = 'admin', checked server-side).
// POST JSON { action, ... }:
//   status                                   → Stripe account / key mode / webhook + sync health
//   sync                                     → pull customers, subscriptions, invoices (and payments) from Stripe into Supabase
//   create_invoice { user_id? | email, name?, items:[{description, amount, quantity?}], currency?, days_until_due?,
//                    methods?:['paynow','card'], revenue_source?, memo?, send? }
//   finalize | send | void | mark_paid | mark_uncollectible | delete_draft { invoice_id, note? }
//   refund { invoice_id | charge_id, amount?, reason? }
//   cancel_subscription { user_id, at_period_end? } · resume_subscription { user_id }
//   portal_link { user_id }                   → Stripe Customer Portal link to send to the member
// Every action is written to public.billing_admin_log.
import { db, json, round2, SITE_URL, Stripe, stripe } from "../_shared/stripe.ts";
import { mirrorInvoice } from "../_shared/invoices.ts";
import { cid, onInvoicePaid, syncSubscription } from "../_shared/sync.ts";

const ORIGINS = [SITE_URL, "https://banahub.com", "https://www.banahub.com"];
const cors = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const allow = ORIGINS.includes(o) || /^https:\/\/banahub-[a-z0-9-]+\.vercel\.app$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SITE_URL;
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
};
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const SOURCES = ["membership", "event", "programme", "sponsorship", "advisory", "other"];
const KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

async function getInvoice(id: unknown) {
  if (typeof id !== "string" || !/^in_[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, "Invalid invoice id");
  return await stripe.invoices.retrieve(id, { expand: ["charge", "customer"] });
}
const refresh = async (id: string, extra: Record<string, unknown> = {}) => mirrorInvoice(await stripe.invoices.retrieve(id, { expand: ["charge", "customer"] }), extra);

async function customerFor(userId: string | null, email: string, name?: string) {
  if (userId) {
    const { data: m } = await db.from("memberships").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
    if (m?.stripe_customer_id) return m.stripe_customer_id;
  }
  const found = await stripe.customers.list({ email, limit: 1 });
  const id = found.data[0]?.id ?? (await stripe.customers.create({ email, name: name || undefined, metadata: userId ? { user_id: userId } : {}, preferred_locales: ["en"] })).id;
  if (userId) await db.from("memberships").upsert({ user_id: userId, stripe_customer_id: id, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return id;
}

async function subFor(userId: unknown) {
  if (typeof userId !== "string") throw new HttpError(400, "user_id required");
  const { data: m } = await db.from("memberships").select("stripe_subscription_id, stripe_customer_id").eq("user_id", userId).maybeSingle();
  return m;
}

async function runSync() {
  const out = { customers: 0, linked: 0, subscriptions: 0, invoices: 0, payments: 0, errors: [] as string[] };
  const cap = 2000;
  // customers → link to BANAHUB accounts by metadata.user_id or email
  for await (const c of stripe.customers.list({ limit: 100 })) {
    if (++out.customers > cap) break;
    let uid = c.metadata?.user_id || null;
    if (!uid && c.email) { const { data } = await db.from("users").select("id").ilike("email", c.email).limit(1); uid = data?.[0]?.id ?? null; }
    if (!uid) continue;
    const { data: m } = await db.from("memberships").select("stripe_customer_id").eq("user_id", uid).maybeSingle();
    if (!m?.stripe_customer_id) { await db.from("memberships").upsert({ user_id: uid, stripe_customer_id: c.id, updated_at: new Date().toISOString() }, { onConflict: "user_id" }); out.linked++; }
    if (!c.metadata?.user_id) await stripe.customers.update(c.id, { metadata: { user_id: uid } }).catch(() => null);
  }
  // subscriptions (oldest first so the newest one wins the membership row)
  const subs: Stripe.Subscription[] = [];
  for await (const s of stripe.subscriptions.list({ status: "all", limit: 100 })) { subs.push(s); if (subs.length >= cap) break; }
  for (const s of subs.sort((a, b) => a.created - b.created)) {
    try { if (await syncSubscription(s, s.status === "canceled")) out.subscriptions++; } catch (e) { out.errors.push(`${s.id}: ${(e as Error).message}`); }
  }
  // invoices → mirror; paid ones are recorded as payments (idempotent, no onboarding tasks)
  for await (const inv of stripe.invoices.list({ limit: 100, expand: ["data.charge"] })) {
    if (++out.invoices > cap) break;
    try {
      await mirrorInvoice(inv);
      if (inv.status === "paid" && ((inv.amount_paid || 0) > 0 || inv.paid_out_of_band)) { await onInvoicePaid(inv, { tasks: false }); out.payments++; }
    } catch (e) { out.errors.push(`${inv.id}: ${(e as Error).message}`); }
  }
  out.errors = out.errors.slice(0, 20);
  await db.from("stripe_sync_state").upsert({ id: 1, last_run_at: new Date().toISOString(), last_ok: out.errors.length === 0, summary: out, livemode: KEY.startsWith("sk_live") || KEY.startsWith("rk_live") });
  return out;
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);
  let adminId: string | null = null; let action = ""; let body: Record<string, unknown> = {};
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) throw new HttpError(401, "Please sign in");
    const { data: u } = await db.from("users").select("id, role, blocked").eq("id", auth.user.id).maybeSingle();
    if (!u || u.role !== "admin" || u.blocked) throw new HttpError(403, "Admins only");
    adminId = u.id;
    body = await req.json().catch(() => ({}));
    action = String(body.action || "");

    if (action === "status") {
      const out: Record<string, unknown> = { configured: !!KEY, mode: KEY.includes("_live_") ? "live" : KEY.includes("_test_") ? "test" : null, webhook_secret: !!Deno.env.get("STRIPE_WEBHOOK_SECRET") };
      if (KEY) {
        try {
          const a = await stripe.accounts.retrieve();
          Object.assign(out, { account: a.id, name: a.settings?.dashboard?.display_name || a.business_profile?.name, country: a.country, currency: a.default_currency, charges_enabled: a.charges_enabled, payouts_enabled: a.payouts_enabled, details_submitted: a.details_submitted });
        } catch (e) { out.key_error = (e as Error).message; }
      }
      const { data: ev } = await db.from("stripe_events").select("type, received_at, processed_at, error, livemode").order("received_at", { ascending: false }).limit(1);
      const { data: st } = await db.from("stripe_sync_state").select("*").eq("id", 1).maybeSingle();
      return json({ ...out, last_event: ev?.[0] ?? null, sync: st ?? null }, 200, headers);
    }
    if (!KEY) throw new HttpError(503, "Stripe is not connected: add STRIPE_SECRET_KEY in Supabase → Edge Functions → Secrets");

    let result: unknown;
    switch (action) {
      case "sync": result = await runSync(); break;

      case "create_invoice": {
        const email = String(body.email || "").trim().toLowerCase();
        const userId = typeof body.user_id === "string" && body.user_id ? body.user_id : null;
        let to = email, name = String(body.name || "").trim();
        if (userId) { const { data: m } = await db.from("users").select("email, full_name").eq("id", userId).maybeSingle(); if (!m) throw new HttpError(400, "Member not found"); to = m.email; name = name || m.full_name || ""; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, "A valid email is required");
        const items = Array.isArray(body.items) ? body.items as { description?: string; amount?: number; quantity?: number }[] : [];
        const clean = items.map((i) => ({ description: String(i.description || "").trim().slice(0, 250), amount: Number(i.amount), quantity: Math.max(1, Math.min(1000, Math.floor(Number(i.quantity) || 1))) }))
          .filter((i) => i.description && i.amount > 0);
        if (!clean.length || clean.length > 25) throw new HttpError(400, "Add at least one line item with a description and amount");
        if (clean.some((i) => i.amount > 1_000_000)) throw new HttpError(400, "Line amount too large");
        const currency = String(body.currency || "SGD").toLowerCase();
        if (!/^[a-z]{3}$/.test(currency)) throw new HttpError(400, "Invalid currency");
        let methods = (Array.isArray(body.methods) ? body.methods : ["paynow", "card"]).filter((m) => ["paynow", "card"].includes(String(m))) as ("paynow" | "card")[];
        if (currency !== "sgd") methods = methods.filter((m) => m !== "paynow");
        if (!methods.length) methods = ["card"];
        const source = SOURCES.includes(String(body.revenue_source)) ? String(body.revenue_source) : "advisory";
        const days = Math.max(1, Math.min(90, Math.floor(Number(body.days_until_due) || 7)));
        const customer = await customerFor(userId, to, name);
        const inv = await stripe.invoices.create({
          customer, collection_method: "send_invoice", days_until_due: days, currency, auto_advance: false,
          pending_invoice_items_behavior: "exclude", description: String(body.memo || "").slice(0, 500) || undefined,
          payment_settings: { payment_method_types: methods },
          metadata: { revenue_source: source, created_by: adminId, ...(userId ? { user_id: userId } : {}) },
        });
        for (const i of clean) {
          await stripe.invoiceItems.create({ customer, invoice: inv.id, currency, description: i.description, quantity: i.quantity, unit_amount: Math.round(i.amount * 100) });
        }
        let fin = inv;
        if (body.send !== false) { fin = await stripe.invoices.finalizeInvoice(inv.id); fin = await stripe.invoices.sendInvoice(fin.id); }
        result = await refresh(fin.id, { created_by: adminId });
        break;
      }
      case "finalize": { const inv = await getInvoice(body.invoice_id); if (inv.status !== "draft") throw new HttpError(400, "Only drafts can be finalized"); await stripe.invoices.finalizeInvoice(inv.id); result = await refresh(inv.id); break; }
      case "send": {
        let inv = await getInvoice(body.invoice_id);
        if (inv.collection_method !== "send_invoice") throw new HttpError(400, "Card subscription invoices are charged automatically and can't be emailed");
        if (inv.status === "draft") inv = await stripe.invoices.finalizeInvoice(inv.id);
        if (inv.status !== "open") throw new HttpError(400, `Invoice is ${inv.status}`);
        await stripe.invoices.sendInvoice(inv.id); result = await refresh(inv.id); break;
      }
      case "void": { const inv = await getInvoice(body.invoice_id); if (inv.status !== "open" && inv.status !== "uncollectible") throw new HttpError(400, `Can't void a ${inv.status} invoice`); await stripe.invoices.voidInvoice(inv.id); result = await refresh(inv.id); break; }
      case "mark_uncollectible": { const inv = await getInvoice(body.invoice_id); if (inv.status !== "open") throw new HttpError(400, "Only open invoices"); await stripe.invoices.markUncollectible(inv.id); result = await refresh(inv.id); break; }
      case "delete_draft": { const inv = await getInvoice(body.invoice_id); if (inv.status !== "draft") throw new HttpError(400, "Only drafts can be deleted"); await stripe.invoices.del(inv.id); await db.from("stripe_invoices").delete().eq("id", inv.id); result = { deleted: inv.id }; break; }
      case "mark_paid": {
        // money received outside Stripe (bank transfer, cheque): record it and settle the invoice
        let inv = await getInvoice(body.invoice_id);
        if (inv.status === "draft") inv = await stripe.invoices.finalizeInvoice(inv.id);
        if (inv.status !== "open" && inv.status !== "uncollectible") throw new HttpError(400, `Invoice is ${inv.status}`);
        const note = String(body.note || "").slice(0, 200);
        if (note) await stripe.invoices.update(inv.id, { metadata: { ...(inv.metadata || {}), paid_note: note, marked_paid_by: adminId! } });
        const paid = await stripe.invoices.pay(inv.id, { paid_out_of_band: true });
        await onInvoicePaid(paid, { tasks: true }); // webhook will repeat idempotently
        result = await refresh(inv.id); break;
      }
      case "refund": {
        let charge: string | null = typeof body.charge_id === "string" && /^(ch|py)_/.test(body.charge_id) ? body.charge_id : null;
        let pi: string | null = null; let invId: string | null = null;
        if (!charge && body.invoice_id) { const inv = await getInvoice(body.invoice_id); invId = inv.id; charge = cid(inv.charge as string | Stripe.Charge | null); pi = cid(inv.payment_intent as string | Stripe.PaymentIntent | null);
          if (inv.paid_out_of_band) throw new HttpError(400, "Paid outside Stripe — refund it the same way it was paid"); }
        if (!charge && !pi) throw new HttpError(400, "No Stripe payment to refund");
        const ch = charge ? await stripe.charges.retrieve(charge) : null;
        const left = ch ? (ch.amount - ch.amount_refunded) / 100 : null;
        const amount = body.amount == null || body.amount === "" ? null : round2(Number(body.amount));
        if (amount != null && (!(amount > 0) || (left != null && amount > left))) throw new HttpError(400, `Refund must be between 0 and ${left}`);
        const reason = ["duplicate", "fraudulent", "requested_by_customer"].includes(String(body.reason)) ? String(body.reason) as Stripe.RefundCreateParams.Reason : "requested_by_customer";
        const r = await stripe.refunds.create({ ...(charge ? { charge } : { payment_intent: pi! }), ...(amount != null ? { amount: Math.round(amount * 100) } : {}), reason, metadata: { refunded_by: adminId! } });
        // update records now (charge.refunded webhook repeats this)
        const c2 = await stripe.charges.retrieve(r.charge as string);
        const refunded = c2.amount_refunded / 100, status = c2.refunded ? "refunded" : "partially_refunded";
        await db.from("transactions").update({ amount_refunded: refunded, status }).eq("stripe_charge_id", c2.id);
        const inv2 = invId || cid((c2 as unknown as { invoice?: string | null }).invoice);
        if (inv2) await db.from("stripe_invoices").update({ amount_refunded: refunded, synced_at: new Date().toISOString() }).eq("id", inv2);
        result = { refund: r.id, amount: r.amount / 100, status: r.status, total_refunded: refunded }; break;
      }
      case "cancel_subscription": {
        const m = await subFor(body.user_id); if (!m?.stripe_subscription_id) throw new HttpError(400, "No subscription");
        const sub = body.at_period_end === false
          ? await stripe.subscriptions.cancel(m.stripe_subscription_id, { prorate: false })
          : await stripe.subscriptions.update(m.stripe_subscription_id, { cancel_at_period_end: true });
        await syncSubscription(sub, sub.status === "canceled"); result = { status: sub.status, cancel_at_period_end: sub.cancel_at_period_end }; break;
      }
      case "resume_subscription": {
        const m = await subFor(body.user_id); if (!m?.stripe_subscription_id) throw new HttpError(400, "No subscription");
        const sub = await stripe.subscriptions.update(m.stripe_subscription_id, { cancel_at_period_end: false });
        await syncSubscription(sub); result = { status: sub.status, cancel_at_period_end: sub.cancel_at_period_end }; break;
      }
      case "portal_link": {
        const m = await subFor(body.user_id); if (!m?.stripe_customer_id) throw new HttpError(400, "Member has no billing account yet");
        const s = await stripe.billingPortal.sessions.create({ customer: m.stripe_customer_id, return_url: `${SITE_URL}/billing.html` });
        result = { url: s.url }; break;
      }
      default: throw new HttpError(400, "Unknown action");
    }
    await db.from("billing_admin_log").insert({ admin_id: adminId, action, target: String(body.invoice_id || body.user_id || body.email || ""), detail: { ...body, action: undefined } });
    return json({ ok: true, result }, 200, headers);
  } catch (e) {
    const err = e as HttpError & { raw?: { message?: string }; type?: string };
    const isStripe = !!err?.raw || /^Stripe/.test(String(err?.type || ""));
    const status = err instanceof HttpError ? err.status : isStripe ? 400 : 500;
    const msg = err instanceof HttpError || isStripe ? (err.raw?.message || err.message) : "Billing admin error — see function logs";
    console.error("billing-admin", action, err?.message);
    if (adminId && action && action !== "status") await db.from("billing_admin_log").insert({ admin_id: adminId, action, target: String(body.invoice_id || body.user_id || body.email || ""), ok: false, error: String(err?.message || e).slice(0, 500) });
    return json({ error: msg }, status, headers);
  }
});
