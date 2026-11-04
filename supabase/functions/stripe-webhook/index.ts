// Flagstick — Stripe webhook for the clubs' connected accounts. Deploy as the Edge Function `stripe-webhook` with
// --no-verify-jwt (Stripe signs the call; the signature is checked here). Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// In the Stripe dashboard the endpoint listens to events on CONNECTED accounts: payment_intent.succeeded,
// checkout.session.completed, charge.refunded. Every payment lands on the member's account exactly once (ref = the
// PaymentIntent id); a saved card from a Checkout setup session (or a payment made with "save for autopay") turns
// autopay on for that member; a refund posts a credit.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Stripe from "npm:stripe@16.12.0";

Deno.serve(async (req) => {
  const sk = Deno.env.get("STRIPE_SECRET_KEY"), wh = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!sk || !wh) return new Response("not configured", { status: 500 });
  const stripe = new Stripe(sk, { apiVersion: "2024-06-20" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  let ev: Stripe.Event;
  try { ev = await stripe.webhooks.constructEventAsync(await req.text(), req.headers.get("stripe-signature") || "", wh); }
  catch (e) { return new Response("bad signature: " + String((e as Error)?.message || e), { status: 400 }); }
  const acct = ev.account; const opts = acct ? { stripeAccount: acct } : undefined;
  const label = async (pmId: string | null) => { if (!pmId) return null; try { const pm = await stripe.paymentMethods.retrieve(pmId, opts); return pm.card ? `${pm.card.brand} ·${pm.card.last4}` : pm.us_bank_account ? `${pm.us_bank_account.bank_name || "Bank"} ·${pm.us_bank_account.last4}` : pm.type; } catch { return null; } };
  const saveCard = async (tenant: string, member_id: string, customer: string | null, pm: string | null) => {
    if (!pm) return; await admin.from("member_users").update({ autopay: true, stripe_pm: pm, pm_label: await label(pm), ...(customer ? { stripe_customer: customer } : {}) }).eq("tenant", tenant).eq("member_id", member_id);
  };
  try {
    if (ev.type === "payment_intent.succeeded") {
      const pi = ev.data.object as Stripe.PaymentIntent; const { tenant, member_id, autopay } = pi.metadata || {};
      if (tenant && member_id) {
        const ref = "stripe:" + pi.id; const { data: had } = await admin.from("acct_items").select("id").eq("tenant", tenant).eq("ref", ref).maybeSingle();
        if (!had) { const method = pi.payment_method_types?.length === 1 && pi.payment_method_types[0] === "us_bank_account" ? "ach" : "card";
          await admin.from("acct_items").insert({ tenant, member_id, kind: "payment", source: "manual", item: "payment", ref, descr: autopay === "1" && pi.setup_future_usage ? "Online payment (card saved for autopay)" : "Online payment", amount: (pi.amount_received || pi.amount) / 100, method, reference: pi.id, posted: new Date().toISOString().slice(0, 10), created_by: "stripe" }); }
        if (autopay === "1" && pi.setup_future_usage) await saveCard(tenant, member_id, typeof pi.customer === "string" ? pi.customer : null, typeof pi.payment_method === "string" ? pi.payment_method : null);
      }
    } else if (ev.type === "checkout.session.completed") {
      const s = ev.data.object as Stripe.Checkout.Session;
      if (s.mode === "setup" && s.metadata?.tenant && s.metadata?.member_id && s.setup_intent) {
        const si = await stripe.setupIntents.retrieve(String(s.setup_intent), opts);
        await saveCard(s.metadata.tenant, s.metadata.member_id, typeof s.customer === "string" ? s.customer : null, typeof si.payment_method === "string" ? si.payment_method : null);
      }
    } else if (ev.type === "charge.refunded") {
      const c = ev.data.object as Stripe.Charge; const pi = typeof c.payment_intent === "string" ? await stripe.paymentIntents.retrieve(c.payment_intent, opts) : null;
      const { tenant, member_id } = pi?.metadata || {}; if (tenant && member_id && c.amount_refunded) {
        const ref = `refund:${c.id}:${c.amount_refunded}`; const { data: had } = await admin.from("acct_items").select("id").eq("tenant", tenant).eq("ref", ref).maybeSingle();
        if (!had) { const { data: prev } = await admin.from("acct_items").select("amount").eq("tenant", tenant).eq("member_id", member_id).like("ref", `refund:${c.id}:%`); const already = (prev || []).reduce((t: number, r: { amount: number }) => t + Number(r.amount), 0);
          const delta = Math.round((c.amount_refunded / 100 - already) * 100) / 100; if (delta > 0) await admin.from("acct_items").insert({ tenant, member_id, kind: "charge", source: "manual", item: "other", ref, descr: "Online payment refunded", amount: delta, reference: c.id, posted: new Date().toISOString().slice(0, 10), created_by: "stripe" }); }
      }
    }
  } catch (e) { return new Response("error: " + String((e as Error)?.message || e), { status: 500 }); }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
