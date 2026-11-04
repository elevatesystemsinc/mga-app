// Flagstick — online member payments through the CLUB's own Stripe account (Stripe Connect, Standard accounts).
// Deploy as the Edge Function `stripe`. Secrets: STRIPE_SECRET_KEY (Flagstick's platform key). The money settles to
// the club's connected account; Flagstick takes no application fee (Flagstick bills the club separately).
//
//   connect      {tenant, return}        staff: create the club's connected account if needed, return the onboarding URL
//   status       {tenant}                staff: refresh and return the account's status (charges_enabled…)
//   pay          {tenant, amount, autopay?, return}   member: a Checkout session for a payment on their account
//   setup        {tenant, return}        member: a Checkout session that saves a card / bank account for autopay
//   autopay_run  {tenant}                staff: charge every autopay member's card on file for their balance due
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Stripe from "npm:stripe@16.12.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const cents = (v: number) => Math.round(Math.abs(Number(v) || 0) * 100);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sk = Deno.env.get("STRIPE_SECRET_KEY");
    if (!sk) return json({ error: "not configured: set STRIPE_SECRET_KEY" });
    const stripe = new Stripe(sk, { apiVersion: "2024-06-20" });
    const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = req.headers.get("Authorization") || "", jwt = auth.replace(/^Bearer\s+/i, "");
    const { data: me, error: e0 } = await admin.auth.getUser(jwt);
    if (e0 || !me?.user) return json({ error: "Not signed in" }, 401);
    const b = await req.json(); const tenant = String(b.tenant || ""), action = String(b.action || "");
    const { data: t } = await admin.from("tenants").select("slug, name, login_email, stripe_account, stripe_status").eq("slug", tenant).maybeSingle();
    if (!t) return json({ error: "Unknown club" });
    const { data: isAdmin } = await admin.from("flagstick_admins").select("user_id").eq("user_id", me.user.id).maybeSingle();
    const { data: g } = await admin.from("tenant_users").select("role").eq("user_id", me.user.id).eq("tenant", tenant).maybeSingle();
    const staff = !!isAdmin || g?.role === "staff";
    const saveStatus = async (acct: Stripe.Account) => {
      const st = { charges_enabled: !!acct.charges_enabled, details_submitted: !!acct.details_submitted, payouts_enabled: !!acct.payouts_enabled, at: new Date().toISOString() };
      await admin.from("tenants").update({ stripe_status: st }).eq("slug", tenant); return st;
    };

    if (action === "connect") {
      if (!staff) return json({ error: "Only the club's staff may connect Stripe" }, 403);
      let id = t.stripe_account;
      if (!id) { const acct = await stripe.accounts.create({ type: "standard", metadata: { tenant }, business_profile: { name: t.name }, email: t.login_email || undefined }); id = acct.id; await admin.from("tenants").update({ stripe_account: id }).eq("slug", tenant); }
      const link = await stripe.accountLinks.create({ account: id, refresh_url: String(b.return), return_url: String(b.return), type: "account_onboarding" });
      return json({ ok: true, url: link.url });
    }
    if (action === "status") {
      if (!staff) return json({ error: "Staff only" }, 403);
      if (!t.stripe_account) return json({ ok: true, connected: false });
      const acct = await stripe.accounts.retrieve(t.stripe_account); return json({ ok: true, connected: true, status: await saveStatus(acct) });
    }
    if (!t.stripe_account || !t.stripe_status?.charges_enabled) return json({ error: "This club does not take online payments yet" });
    const opts = { stripeAccount: t.stripe_account };

    if (action === "pay" || action === "setup") {
      // the member, by the e-mail on the directory — the same resolution the portal uses
      const mine = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: meRow } = await mine.rpc("member_me", { p_tenant: tenant });
      const m = meRow?.member; if (!m) return json({ error: "Your e-mail is not on the club's directory" });
      const { data: u } = await admin.from("member_users").select("*").eq("tenant", tenant).eq("member_id", m.id).maybeSingle();
      let customer = u?.stripe_customer;
      if (!customer) { const c = await stripe.customers.create({ email: m.email, name: [m.first, m.last].filter(Boolean).join(" "), metadata: { tenant, member_id: m.id, memberNo: m.memberNo || "" } }, opts); customer = c.id; await admin.from("member_users").update({ stripe_customer: customer }).eq("tenant", tenant).eq("member_id", m.id); }
      const ret = String(b.return || "").split("?")[0];
      if (action === "pay") {
        const amount = cents(b.amount); if (amount < 100) return json({ error: "The minimum online payment is $1.00" }); if (amount > 2500000) return json({ error: "That amount is too large for an online payment" });
        const s = await stripe.checkout.sessions.create({
          mode: "payment", customer, payment_method_types: ["card", "us_bank_account"],
          line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name: `${t.name} — member account payment` } } }],
          payment_intent_data: { metadata: { tenant, member_id: m.id, autopay: b.autopay ? "1" : "0" }, setup_future_usage: b.autopay ? "off_session" : undefined, description: `${t.name} member account · ${m.first || ""} ${m.last || ""}`.trim() },
          success_url: ret + "?paid=1", cancel_url: ret,
        }, opts);
        return json({ ok: true, url: s.url });
      }
      const s = await stripe.checkout.sessions.create({ mode: "setup", customer, payment_method_types: ["card", "us_bank_account"], metadata: { tenant, member_id: m.id }, success_url: ret + "?autopay=1", cancel_url: ret }, opts);
      return json({ ok: true, url: s.url });
    }
    if (action === "autopay_run") {
      if (!staff) return json({ error: "Staff only" }, 403);
      const { data: users } = await admin.from("member_users").select("*").eq("tenant", tenant).eq("autopay", true);
      const out: { member_id: string; amount: number; ok: boolean; error?: string }[] = [];
      for (const u of users || []) {
        if (!u.stripe_pm || !u.stripe_customer) continue;
        const { data: items } = await admin.from("acct_items").select("kind, amount").eq("tenant", tenant).eq("member_id", u.member_id).is("void_at", null);
        const bal = Math.round((items || []).reduce((s: number, i: { kind: string; amount: number }) => s + (i.kind === "charge" ? Number(i.amount) : -Number(i.amount)), 0) * 100) / 100;
        if (bal < 1) continue;
        try {
          const pi = await stripe.paymentIntents.create({ amount: cents(bal), currency: "usd", customer: u.stripe_customer, payment_method: u.stripe_pm, off_session: true, confirm: true, metadata: { tenant, member_id: u.member_id, autopay: "1" }, description: `${t.name} member account · autopay` }, opts);
          if (pi.status === "succeeded") { await postPayment(admin, tenant, u.member_id, pi, "Autopay — card on file"); }
          out.push({ member_id: u.member_id, amount: bal, ok: pi.status === "succeeded" || pi.status === "processing", error: pi.status === "succeeded" || pi.status === "processing" ? undefined : pi.status });
        } catch (e) { out.push({ member_id: u.member_id, amount: bal, ok: false, error: String((e as Error)?.message || e) }); }
      }
      return json({ ok: true, results: out });
    }
    return json({ error: "Unknown action" });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
});

// one payment row per PaymentIntent, whoever gets there first (the webhook posts the same ref)
export async function postPayment(admin: ReturnType<typeof createClient>, tenant: string, member_id: string, pi: Stripe.PaymentIntent, descr: string) {
  const ref = "stripe:" + pi.id;
  const { data: had } = await admin.from("acct_items").select("id").eq("tenant", tenant).eq("ref", ref).maybeSingle();
  if (had) return;
  const method = (pi.payment_method_types || []).includes("us_bank_account") && !(pi.payment_method_types || []).includes("card") ? "ach" : "card";
  await admin.from("acct_items").insert({ tenant, member_id, kind: "payment", source: "manual", item: "payment", ref, descr, amount: (pi.amount_received || pi.amount) / 100, method, reference: pi.id, posted: new Date().toISOString().slice(0, 10), created_by: "stripe" });
}
