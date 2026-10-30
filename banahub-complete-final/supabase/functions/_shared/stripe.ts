// Shared Stripe + Supabase helpers for BANAHUB billing Edge Functions.
// Secrets (Supabase → Edge Functions → Secrets): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SITE_URL
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import Stripe from "npm:stripe@17.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-11-20.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});
export const cryptoProvider = Stripe.createSubtleCryptoProvider();
export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
export const SITE_URL = (Deno.env.get("SITE_URL") || "https://banahub.com").replace(/\/$/, "");
export { Stripe };

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

// monthly-equivalent value of a recurring price, in major units
export function mrrOf(price: Stripe.Price | null | undefined, qty = 1): number {
  if (!price || !price.unit_amount || !price.recurring) return 0;
  const amt = (price.unit_amount / 100) * qty;
  const n = price.recurring.interval_count || 1;
  switch (price.recurring.interval) {
    case "year": return round2(amt / (12 * n));
    case "month": return round2(amt / n);
    case "week": return round2((amt * 52) / (12 * n));
    default: return round2((amt * 365) / (12 * n));
  }
}
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const ts = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
