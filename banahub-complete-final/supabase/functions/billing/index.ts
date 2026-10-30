// BANAHUB membership billing — one endpoint, three actions (POST JSON, signed-in members only):
//   { action: "checkout", plan: "growth"|"scale", period: "monthly"|"annual", method: "card"|"paynow" }
//       card   → Stripe Checkout (subscription mode, auto-renews)          → { url }
//       paynow → Stripe Billing subscription with send_invoice collection;
//                Stripe issues an invoice each period payable by PayNow QR (or card) → { url } (hosted invoice)
//   { action: "portal" }   → Stripe Customer Portal session                 → { url }
//   { action: "summary" }  → membership + recent invoices (with pay links)  → { membership, invoices }
// Prices are read from public.membership_plans (editable in Admin OS) — never from the browser.
// Stripe Products / Prices are created on first use with stable lookup keys and stored as external IDs.
import { db, json, round2, SITE_URL, Stripe, stripe } from "../_shared/stripe.ts";

const ORIGINS = [SITE_URL, "https://banahub.com", "https://www.banahub.com"];
const cors = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  const allow = ORIGINS.includes(o) || /^https:\/\/banahub-[a-z0-9-]+\.vercel\.app$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : SITE_URL;
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
};

type Plan = { id: string; code: string; name: string; monthly_price: number | null; annual_price: number | null; currency: string; self_service: boolean; active: boolean;
  stripe_product_id: string | null; stripe_price_monthly: string | null; stripe_price_annual: string | null; stripe_price_monthly_amount: number | null; stripe_price_annual_amount: number | null };

async function ensurePrice(plan: Plan, period: "monthly" | "annual"): Promise<string> {
  const amount = Number(period === "annual" ? plan.annual_price : plan.monthly_price);
  if (!(amount > 0)) throw new HttpError(400, "This plan is not available for that billing period");
  const stored = period === "annual" ? plan.stripe_price_annual : plan.stripe_price_monthly;
  const storedAmt = Number(period === "annual" ? plan.stripe_price_annual_amount : plan.stripe_price_monthly_amount);
  if (stored && storedAmt === amount) return stored;

  let productId = plan.stripe_product_id;
  if (!productId) {
    const found = await stripe.products.search({ query: `metadata['plan_code']:'${plan.code}' AND metadata['product_family']:'membership'` }).catch(() => null);
    productId = found?.data?.[0]?.id ?? (await stripe.products.create({
      name: `BANAHUB ${plan.name}`,
      metadata: { product_family: "membership", plan_code: plan.code, tier: plan.code, plan_id: plan.id },
    })).id;
  }
  const cents = Math.round(amount * 100);
  const lookup = `banahub_membership_${plan.code}_${period}_${plan.currency.toLowerCase()}_${cents}`;
  const existing = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
  const price = existing.data[0] ?? await stripe.prices.create({
    product: productId,
    currency: plan.currency.toLowerCase(),
    unit_amount: cents,
    recurring: { interval: period === "annual" ? "year" : "month" },
    lookup_key: lookup,
    nickname: `${plan.name} — ${period}`,
    metadata: { product_family: "membership", tier: plan.code, plan_code: plan.code, billing_period: period, plan_id: plan.id },
  });
  const patch: Record<string, unknown> = { stripe_product_id: productId };
  if (period === "annual") { patch.stripe_price_annual = price.id; patch.stripe_price_annual_amount = amount; }
  else { patch.stripe_price_monthly = price.id; patch.stripe_price_monthly_amount = amount; }
  await db.from("membership_plans").update(patch).eq("id", plan.id);
  return price.id;
}

async function ensureCustomer(user: { id: string; email?: string }, profile: { full_name?: string | null; company_name?: string | null } | null, existing: string | null) {
  if (existing) return existing;
  const found = await stripe.customers.search({ query: `metadata['user_id']:'${user.id}'` }).catch(() => null);
  const id = found?.data?.[0]?.id ?? (await stripe.customers.create({
    email: user.email, name: profile?.full_name || undefined,
    metadata: { user_id: user.id, organisation: profile?.company_name || "" },
    preferred_locales: ["en"],
  })).id;
  await db.from("memberships").upsert({ user_id: user.id, stripe_customer_id: id, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return id;
}

class HttpError extends Error { constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); } }

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    const user = auth?.user;
    if (!user) throw new HttpError(401, "Please sign in first");
    const { data: u } = await db.from("users").select("id, email, full_name, company_name, blocked, status").eq("id", user.id).maybeSingle();
    if (u?.blocked) throw new HttpError(403, "This account is blocked. Please contact BANAHUB.");
    const body = await req.json().catch(() => ({}));
    const { data: m } = await db.from("memberships").select("*").eq("user_id", user.id).maybeSingle();

    if (body.action === "checkout") {
      const period = body.period === "annual" ? "annual" : "monthly";
      const method = body.method === "paynow" ? "paynow" : "card";
      const { data: plan } = await db.from("membership_plans").select("*").eq("code", String(body.plan || "")).eq("active", true).maybeSingle();
      if (!plan || !plan.self_service || plan.code === "free") throw new HttpError(400, "This plan cannot be purchased online");
      if (method === "paynow" && plan.currency.toUpperCase() !== "SGD") throw new HttpError(400, "PayNow is available for SGD plans only");

      // one paid subscription per member: changes go through the billing portal / BANAHUB team
      if (m?.stripe_subscription_id && ["active", "past_due", "pending_payment", "incomplete"].includes(m.status)) {
        if (m.status === "pending_payment" && m.payment_method === "paynow" && m.plan_code === plan.code && m.billing_period === period) {
          const sub = await stripe.subscriptions.retrieve(m.stripe_subscription_id, { expand: ["latest_invoice"] });
          const inv = sub.latest_invoice as Stripe.Invoice | null;
          if (inv?.hosted_invoice_url && inv.status === "open") return json({ url: inv.hosted_invoice_url, reused: true }, 200, headers);
        }
        // never paid (abandoned first PayNow invoice): replace it with the new choice
        if (["pending_payment", "incomplete"].includes(m.status) && !m.access_until) {
          const old = await stripe.subscriptions.retrieve(m.stripe_subscription_id, { expand: ["latest_invoice"] }).catch(() => null);
          const oldInv = old?.latest_invoice as Stripe.Invoice | null | undefined;
          if (oldInv?.status === "open") await stripe.invoices.voidInvoice(oldInv.id).catch(() => null); // the old QR can no longer be paid
          await stripe.subscriptions.cancel(m.stripe_subscription_id, { invoice_now: false, prorate: false }).catch(() => null);
          await db.from("memberships").update({ status: "canceled", stripe_subscription_id: null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
        } else {
          throw new HttpError(409, "You already have a membership. Use Billing to change or cancel it.", { billing: true });
        }
      }

      const priceId = await ensurePrice(plan as Plan, period);
      const customer = await ensureCustomer({ id: user.id, email: user.email }, u, m?.stripe_customer_id ?? null);
      const meta = { user_id: user.id, plan_code: plan.code, tier: plan.code, billing_period: period, product_family: "membership", payment_method: method };

      if (method === "card") {
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          customer,
          client_reference_id: user.id,
          payment_method_types: ["card"],
          line_items: [{ price: priceId, quantity: 1 }],
          subscription_data: { metadata: meta, description: `${plan.name} (${period})` },
          metadata: meta,
          allow_promotion_codes: false,
          billing_address_collection: "auto",
          customer_update: { address: "auto", name: "auto" },
          success_url: `${SITE_URL}/billing.html?status=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${SITE_URL}/membership.html?status=cancelled`,
        });
        await db.from("memberships").update({ organisation: u?.company_name ?? null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
        return json({ url: session.url }, 200, headers);
      }

      // PayNow: Stripe can't auto-charge PayNow, so the subscription invoices the member every period
      const sub = await stripe.subscriptions.create({
        customer,
        items: [{ price: priceId, quantity: 1 }],
        collection_method: "send_invoice",
        days_until_due: 7,
        payment_settings: { payment_method_types: ["paynow", "card"] },
        description: `${plan.name} (${period}) — pay each invoice by PayNow or card`,
        metadata: meta,
        expand: ["latest_invoice"],
      }, { idempotencyKey: `paynow-sub-${user.id}-${plan.code}-${period}-${new Date().toISOString().slice(0, 13)}` });
      let inv = sub.latest_invoice as Stripe.Invoice;
      if (inv && inv.status === "draft") inv = await stripe.invoices.finalizeInvoice(inv.id);
      await db.from("memberships").update({
        plan_code: plan.code, status: "pending_payment", billing_period: period, payment_method: "paynow",
        stripe_subscription_id: sub.id, current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(), organisation: u?.company_name ?? null, updated_at: new Date().toISOString(),
      }).eq("user_id", user.id);
      if (!inv?.hosted_invoice_url) throw new HttpError(502, "Invoice could not be created. Please try again.");
      return json({ url: inv.hosted_invoice_url }, 200, headers);
    }

    if (body.action === "portal") {
      if (!m?.stripe_customer_id) throw new HttpError(400, "No billing account yet");
      const s = await stripe.billingPortal.sessions.create({ customer: m.stripe_customer_id, return_url: `${SITE_URL}/billing.html` });
      return json({ url: s.url }, 200, headers);
    }

    if (body.action === "summary") {
      let invoices: unknown[] = [];
      if (m?.stripe_customer_id) {
        const list = await stripe.invoices.list({ customer: m.stripe_customer_id, limit: 24 });
        invoices = list.data.filter((i) => i.status !== "draft").map((i) => ({
          id: i.id, number: i.number, status: i.status, total: round2((i.total || 0) / 100), amount_due: round2((i.amount_remaining || 0) / 100),
          currency: (i.currency || "sgd").toUpperCase(), created: i.created, due_date: i.due_date,
          period_start: i.lines?.data?.[0]?.period?.start ?? i.period_start, period_end: i.lines?.data?.[0]?.period?.end ?? i.period_end,
          hosted_invoice_url: i.hosted_invoice_url, invoice_pdf: i.invoice_pdf, description: i.lines?.data?.[0]?.description || null,
        }));
      }
      return json({ membership: m ?? null, invoices }, 200, headers);
    }

    throw new HttpError(400, "Unknown action");
  } catch (e) {
    const err = e as HttpError & { raw?: { message?: string } };
    console.error("billing error", err?.message, err?.raw?.message);
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: status === 500 ? "Billing is temporarily unavailable. Please try again or contact BANAHUB." : err.message, ...(err.extra || {}) }, status, headers);
  }
});
