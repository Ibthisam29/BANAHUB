// supabase/functions/create-payment-link/index.ts
// Deploy: supabase functions deploy create-payment-link
// Auth:   Admin-only — JWT must belong to a user with role='admin' in the users table.
//
// POST body: { pricing_catalog_id: "uuid" }
//
// Flow:
//   1. Verify caller is admin (service_role reads users table)
//   2. Load pricing row
//   3. Upsert Stripe Product + Price (idempotent by metadata lookup)
//   4. Create Stripe Payment Link (or retrieve existing)
//   5. Write stripe_product_id, stripe_price_id, stripe_payment_link back to pricing_catalog
//   6. Return { payment_link, price_id, product_id }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY          = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL               = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
const SITE_URL                   = Deno.env.get("SITE_URL") || "https://www.banahub.com";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const sb     = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  "Access-Control-Allow-Origin":  SITE_URL,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── 1. Verify admin ────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: adminRow } = await sb.from("users").select("role").eq("id", user.id).single();
  if (adminRow?.role !== "admin") return json({ error: "Forbidden — admins only" }, 403);

  // ── 2. Load pricing row ────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const { pricing_catalog_id } = body;
  if (!pricing_catalog_id) return json({ error: "pricing_catalog_id required" }, 400);

  const { data: item, error: itemErr } = await sb
    .from("pricing_catalog")
    .select("*")
    .eq("id", pricing_catalog_id)
    .single();

  if (itemErr || !item) return json({ error: "Pricing item not found" }, 404);
  if (!item.price_amount || item.price_amount <= 0) {
    return json({ error: "Price must be > 0 to generate a Payment Link" }, 400);
  }

  // ── 3. Upsert Stripe Product ───────────────────────────────────────────────
  let productId = item.stripe_product_id;
  if (!productId) {
    // Check if one already exists by metadata
    const existing = await stripe.products.search({
      query: `metadata['bana_catalog_id']:'${item.id}'`,
    }).catch(() => ({ data: [] }));
    if (existing.data.length > 0) {
      productId = existing.data[0].id;
    } else {
      const product = await stripe.products.create({
        name:        item.name,
        description: item.description || undefined,
        metadata:    { bana_catalog_id: item.id, category: item.category },
      });
      productId = product.id;
    }
  }

  // ── 4. Upsert Stripe Price ─────────────────────────────────────────────────
  let priceId = item.stripe_price_id;
  if (!priceId) {
    const isRecurring = item.billing_cycle === "monthly" || item.billing_cycle === "annual";
    const priceParams: Stripe.PriceCreateParams = {
      product:     productId,
      currency:    (item.currency || "SGD").toLowerCase(),
      unit_amount: Math.round(item.price_amount * 100),
      metadata:    { bana_catalog_id: item.id },
      ...(isRecurring ? {
        recurring: {
          interval: item.billing_cycle === "annual" ? "year" : "month",
        },
      } : {}),
    };
    const price = await stripe.prices.create(priceParams);
    priceId = price.id;
  }

  // ── 5. Create Stripe Payment Link ──────────────────────────────────────────
  // If one already exists, return it (deactivate then re-create on price change)
  let paymentLink = item.stripe_payment_link;
  if (!paymentLink) {
    const pl = await stripe.paymentLinks.create({
      line_items: [{ price: priceId, quantity: 1 }],
      after_completion: {
        type:    "redirect",
        redirect: { url: `${SITE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}` },
      },
      metadata: { bana_catalog_id: item.id, category: item.category },
    });
    paymentLink = pl.url;
  }

  // ── 6. Persist back to pricing_catalog ────────────────────────────────────
  await sb.from("pricing_catalog").update({
    stripe_product_id:   productId,
    stripe_price_id:     priceId,
    stripe_payment_link: paymentLink,
  }).eq("id", item.id);

  return json({ payment_link: paymentLink, price_id: priceId, product_id: productId });
});

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
