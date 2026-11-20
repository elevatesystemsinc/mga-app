// Flagstick — online payments through the DELUXE PAYMENTS PLATFORM (DPP) on the club's own merchant account. Deploy as the
// Edge Function `payments`. No Flagstick-wide secret: every club's credentials live in `payment_accounts` (service role only),
// entered by its staff from Billing setup after Trinity Merchant Group has onboarded the merchant and Deluxe has e-mailed the
// Client ID / Client Secret / Partner Token / HPF token. Card data never touches Flagstick: the browser tokenizes it in Deluxe's
// Hosted Payment Form (hostedform2.deluxe.com) and this function charges the TOKEN, or a card kept in Deluxe's VAULT for autopay.
//
//   POST {tenant, action, …}  — the caller is a staff login (hub), a member (the portal, by the e-mail on the directory) or a
//   register station (its link key, `key`); every action answers {ok, …} or {error}.
//   configure   {env, client_id, client_secret, partner_token, hpf_token, webhook_secret}   staff: save, then check the connection
//   status                                      staff: check again (an OAuth token + the gateway health call), return the redacted account
//   hpf                                         signed in or a station: what the Hosted Payment Form needs {script, xtoken, env}
//   pay         {amount, token | method_id, save, nickname}   member: a payment on their account — a fresh token from the form, or a card from their
//               wallet; `save` keeps a fresh card in the wallet (and makes it the autopay card when autopay is on)
//   wallet_add  {token, nickname, make_default}  member: keep a card / bank account in the vault (their wallet), no charge
//   wallet_remove {id}  wallet_default {id}  autopay_on {id?}  autopay_off     member: the wallet and autopay
//   setup       {token}                          member: wallet_add + autopay_on in one (the old portal call)
//   sale        {token, amount, ref, descr, member_id?, key?}   staff or a station: a one-off card sale (a register ticket, a fund checkout)
//   refund      {payment_id, amount}             staff: a full or partial refund of a sale (posts the reversal on the member's account)
//   charge_vault {member_id, amount, descr}      staff: charge a member's card on file
//   autopay_run                                  staff: charge every autopay member's balance due (Run statements)
//   transactions {limit?}                        staff: the log
//
// The DPP calls, VERIFIED against the sandbox on Nov 20, 2026 (Bushwood's credentials): OAuth2 client credentials at
// /secservices/oauth2/v2/token (Basic client_id:client_secret, grant_type=client_credentials, expires_in 3600), then every call with
// Authorization: Bearer + PartnerToken headers under /dpp/v1/gateway (GET / answers the gateway's version). A sale is
// POST /payments {amount:{amount,currency}, paymentMethod:{token:{token,expiry 'MM/YY'}} | {vault:{paymentMethodId (uuid), customerId (number)}}
// | {card:{card,expiry,cvv,nameOnCard}}, paymentType:'Credit'|'Debit', orderData:{orderId}, customData:[{name,value}], isSavePaymentMethod}
// → {paymentId, responseCode (0 = approved; 10 = error), responseMessage:[…], amountApproved, authResponse, customerId, paymentMethodId,
// token, batchNumber}. Refund: POST /refunds {paymentId, amount:{amount,currency}} — "Transaction has not settled" the same day, when
// POST /payments/cancel {paymentId} voids it instead. Vault: POST /customers {firstName,lastName,email} → {customerId (number)};
// POST /paymentmethods {customerId, paymentMethod:{token|card}} → {paymentMethodId}; GET /customers/{id} lists the vaults. The Hosted
// Payment Form renders with the PARTNER TOKEN as xtoken and answers {type:'Token', status:'success', data:{token, expDate, maskedPan,
// cardType, nameOnCard}}; its ACH form posts aba / dda fields. Not yet seen: an approved sale (the sandbox merchant TMG set up is a
// FLEET merchant — "Merchant not enabled for Credit" — ask Deluxe to enable Credit and ACH on it) and ACH's paymentType value.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

type Acct = { tenant: string; provider: string; env: string; client_id: string | null; client_secret: string | null; partner_token: string | null; hpf_token: string | null; webhook_secret: string | null; status: Record<string, unknown> | null };

/* ---------- the Deluxe adapter ---------- */
const DPP = {
  host: (env: string) => env === "production" ? "https://api.deluxe.com" : "https://sandbox.api.deluxe.com",
  token: "/secservices/oauth2/v2/token",
  base: "/dpp/v1/gateway",
  health: "/",                       // GET  — the health check from the solution guide
  payments: "/payments",             // POST — a sale with a token or a vaulted payment method
  refunds: "/refunds",               // POST — {paymentId, amount:{amount,currency}} once the batch has settled
  cancel: "/payments/cancel",        // POST — {paymentId}: a same-day void (before the batch settles)
  customers: "/customers",           // POST — a vault customer
  paymentMethods: "/paymentmethods", // POST — add a tokenized card / bank account to a customer's vault
  hpfScript: "https://hostedform2.deluxe.com/V2/deluxe.js",
};
const tokens = new Map<string, { bearer: string; exp: number }>();   // per tenant, inside this instance
async function bearerFor(a: Acct): Promise<string> {
  const k = a.tenant + ":" + a.env, hit = tokens.get(k); if (hit && hit.exp > Date.now()) return hit.bearer;
  if (!a.client_id || !a.client_secret) throw new Error("not configured: the Deluxe client id and secret are missing");
  const res = await fetch(DPP.host(a.env) + DPP.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${a.client_id}:${a.client_secret}`) }, body: "grant_type=client_credentials" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error("Deluxe did not accept the credentials" + (body.error_description || body.error ? ": " + (body.error_description || body.error) : ` (HTTP ${res.status})`));
  const ttl = Math.max(60, Math.min(3300, Number(body.expires_in) || 3300));
  tokens.set(k, { bearer: body.access_token, exp: Date.now() + (ttl - 30) * 1000 }); return body.access_token;
}
async function dpp(a: Acct, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const bearer = await bearerFor(a);
  const res = await fetch(DPP.host(a.env) + DPP.base + path, { method, headers: { Authorization: "Bearer " + bearer, PartnerToken: a.partner_token || "", "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let data: Record<string, unknown> = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (res.status === 401) { tokens.delete(a.tenant + ":" + a.env); }
  const er = (data.errors || {}) as Record<string, unknown>;   // the gateway's errors: {errors:{message:'Bad Request', details:'/paymentType … is not a valid enum value'}}
  if (!res.ok) throw new Error(String(er.details || er.message || data.message || data.error_description || data.error || data.responseMessage || `Deluxe answered HTTP ${res.status}`));
  return data;
}
/* what a sale answered: the processor's id, whether it was approved, the card on the slip, the vault ids when a card was kept */
function readSale(r: Record<string, unknown>, card?: Record<string, unknown>) {
  const s = (k: string) => (r[k] == null ? "" : String(r[k]));
  const msgs = Array.isArray(r.responseMessage) ? (r.responseMessage as unknown[]).map(String) : r.responseMessage ? [String(r.responseMessage)] : [];
  const code = s("responseCode").toUpperCase();
  const approved = r.responseCode === 0 || code === "0" || code === "00" || (!code && !!(r.paymentId || r.id) && !msgs.length);
  const c = (card || {}) as Record<string, unknown>;
  const brand = String(c.cardType || c.brand || r.cardType || ""), last4 = String(c.maskedPan || r.maskedPan || c.last4 || r.token || "").replace(/\D/g, "").slice(-4);
  const ach = /ach|bank|checking|savings/i.test(String(c.type || c.method || r.paymentType || "")) || !!c.aba || !!c.dda;
  return { approved, id: s("paymentId") || s("id") || s("transactionId"), customerId: s("customerId"), methodId: s("paymentMethodId") || s("vaultId"), method: ach ? "ach" : "card", label: ach ? `Bank ·${last4}` : brand ? `${brand} ·${last4}` : last4 ? `Card ·${last4}` : "Card", message: msgs.join("; ") || s("authResponse") || s("message") };
}
/* the hosted form's answer, as the browsers send it on: {token, expDate 'MM/YY', cardType, maskedPan, nameOnCard} or just the token string */
const tokenOf = (t: unknown) => typeof t === "string" ? { token: t, expiry: "" } : t && typeof t === "object" ? { token: String((t as Record<string, unknown>).token || ""), expiry: String((t as Record<string, unknown>).expDate || (t as Record<string, unknown>).expiry || ""), card: t as Record<string, unknown> } : { token: "", expiry: "" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
    const b = await req.json(); const tenant = String(b.tenant || ""), action = String(b.action || "");
    const { data: t } = await admin.from("tenants").select("slug, name, login_email").eq("slug", tenant).maybeSingle();
    if (!t) return json({ error: "Unknown club" });
    // who is calling: a signed-in login, or a register station with its key
    const auth = req.headers.get("Authorization") || "", jwt = auth.replace(/^Bearer\s+/i, "");
    let userId = "", email = "", staff = false, station: Record<string, unknown> | null = null;
    if (b.key) { const { data: st } = await admin.rpc("pos_station", { p_key: String(b.key) }); const s = Array.isArray(st) ? st[0] : st; if (s && s.tenant === tenant) station = s; }
    if (!station) {
      const { data: me, error: e0 } = await admin.auth.getUser(jwt); if (e0 || !me?.user) return json({ error: "Not signed in" }, 401);
      userId = me.user.id; email = (me.user.email || "").toLowerCase();
      const { data: isAdmin } = await admin.from("flagstick_admins").select("user_id").eq("user_id", userId).maybeSingle();
      const { data: g } = await admin.from("tenant_users").select("role").eq("user_id", userId).eq("tenant", tenant).maybeSingle();
      staff = !!isAdmin || g?.role === "staff";
    }
    const who = station ? "station:" + String(station.name || station.id) : email || "member";
    const { data: acct0 } = await admin.from("payment_accounts").select("*").eq("tenant", tenant).maybeSingle();
    let acct = acct0 as Acct | null;
    const redacted = (a: Acct | null) => a ? { provider: a.provider, env: a.env, client_id: a.client_id ? a.client_id.slice(0, 4) + "…" : "", has_secret: !!a.client_secret, partner_token: a.partner_token ? "…" + a.partner_token.slice(-6) : "", hpf_token: a.hpf_token ? "…" + a.hpf_token.slice(-6) : "", has_webhook_secret: !!a.webhook_secret, status: a.status || null } : null;
    const saveStatus = async (st: Record<string, unknown>) => { await admin.from("payment_accounts").update({ status: st }).eq("tenant", tenant); await admin.from("tenants").update({ pay_status: { ok: !!st.ok, env: acct?.env, at: st.at, message: st.message || "" } }).eq("slug", tenant); };
    const check = async (): Promise<Record<string, unknown>> => {
      const st: Record<string, unknown> = { at: new Date().toISOString(), ok: false, message: "" };
      try { if (!acct) throw new Error("not configured"); await bearerFor(acct); try { await dpp(acct, "GET", DPP.health); } catch (e) { st.health = String((e as Error).message); } st.ok = true; st.message = "Connected" + (st.health ? " (token ok; the health call answered: " + st.health + ")" : ""); }
      catch (e) { st.message = String((e as Error).message || e); }
      if (acct) await saveStatus(st); return st;
    };
    const log = async (row: Record<string, unknown>) => { const { data } = await admin.from("payments").insert({ tenant, provider: "deluxe", env: acct?.env, created_by: who, ...row }).select("id").maybeSingle(); return data?.id; };
    const postPayment = async (member_id: string, amount: number, ref: string, descr: string, method: string, reference: string) => {
      const { data: had } = await admin.from("acct_items").select("id").eq("tenant", tenant).eq("ref", ref).maybeSingle(); if (had) return had.id;
      const { data } = await admin.from("acct_items").insert({ tenant, member_id, kind: "payment", source: "manual", item: "payment", ref, descr, amount: r2(amount), method, reference, posted: today(), created_by: who }).select("id").maybeSingle(); return data?.id;
    };
    const memberMe = async () => { const mine = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
      if (b.as && staff) { const { data } = await mine.rpc("member_me_as", { p_tenant: tenant, p_member: String(b.as) }); return data?.member || null; }   // staff acting for a member from "View portal as member"
      const { data } = await mine.rpc("member_me", { p_tenant: tenant }); return data?.member || null; };
    const customerFor = async (member: { id: string; first?: string; last?: string; email?: string }, u: Record<string, unknown> | null) => {
      if (u?.pay_customer) return String(u.pay_customer);
      const r = await dpp(acct!, "POST", DPP.customers, { firstName: member.first || "", lastName: member.last || "", email: member.email || "" });
      const id = String(r.customerId || r.id || ""); if (!id) throw new Error("Deluxe did not return a customer id");
      await admin.from("member_users").upsert({ tenant, member_id: member.id, email: member.email || "", pay_provider: "deluxe", pay_customer: id }, { onConflict: "tenant,member_id" }); return id;
    };
    /* the wallet: one row per card or bank account in Deluxe's vault; the default is what autopay and "charge the card on file" use */
    const walletOf = async (member_id: string) => { const { data } = await admin.from("member_payment_methods").select("*").eq("tenant", tenant).eq("member_id", member_id).is("removed_at", null).order("is_default", { ascending: false }).order("created_at"); return data || []; };
    const walletAdd = async (member_id: string, customerId: string, methodId: string, s: { label: string; method: string }, exp: string, nickname: string, makeDefault: boolean) => {
      const have = await walletOf(member_id); const first = !have.length;
      if (makeDefault || first) await admin.from("member_payment_methods").update({ is_default: false }).eq("tenant", tenant).eq("member_id", member_id);
      const { data } = await admin.from("member_payment_methods").insert({ tenant, member_id, provider: "deluxe", customer_id: customerId, method_id: methodId, kind: s.method, label: s.label, nickname: nickname || null, exp: exp || null, is_default: makeDefault || first }).select("*").maybeSingle();
      await syncAutopay(member_id); return data;
    };
    /* member_users keeps the autopay flag and the method it charges (= the wallet's default) so autopay_run and the hub read one place */
    const syncAutopay = async (member_id: string) => { const w = await walletOf(member_id); const d = w.find((x: Record<string, unknown>) => x.is_default) || w[0] || null;
      const { data: u } = await admin.from("member_users").select("autopay").eq("tenant", tenant).eq("member_id", member_id).maybeSingle();
      await admin.from("member_users").update({ pay_provider: "deluxe", pay_customer: d ? d.customer_id : null, pay_method: d && u?.autopay ? d.method_id : null, pm_label: d ? [d.nickname, d.label].filter(Boolean).join(" · ") : null, autopay: !!(u?.autopay && d) }).eq("tenant", tenant).eq("member_id", member_id); };
    const keepCard = async (member_id: string, customerId: string, methodId: string, label: string) => {
      await admin.from("member_users").update({ autopay: true, pay_provider: "deluxe", pay_customer: customerId, pay_method: methodId, pm_label: label }).eq("tenant", tenant).eq("member_id", member_id);
    };
    const sale = async (o: { token?: unknown; methodId?: string; customerId?: string; amount: number; descr: string; ref: string; member_id?: string; save?: boolean; customer?: Record<string, unknown> }) => {
      if (!acct?.status?.ok) throw new Error("This club does not take payments online yet");
      const amount = r2(o.amount); if (amount < 1) throw new Error("The minimum online payment is $1.00"); if (amount > 25000) throw new Error("That amount is too large for an online payment");
      const tk = tokenOf(o.token);
      const body: Record<string, unknown> = { amount: { amount, currency: "USD" }, paymentType: "Credit", orderData: { orderId: o.ref.slice(0, 50) }, customData: [{ name: "tenant", value: tenant }, { name: "ref", value: o.ref }, { name: "member", value: o.member_id || "" }, { name: "descr", value: o.descr.slice(0, 120) }] };
      if (o.methodId) { body.paymentMethod = { vault: { paymentMethodId: o.methodId, customerId: Number(o.customerId) || o.customerId } }; }
      else if (tk.token) { body.paymentMethod = { token: { token: tk.token, expiry: tk.expiry } }; if (o.save) { body.isSavePaymentMethod = true; if (o.customerId) body.customerId = Number(o.customerId) || o.customerId; } }
      else throw new Error("No card to charge");
      let r: Record<string, unknown>; try { r = await dpp(acct, "POST", DPP.payments, body); } catch (e) { await log({ kind: "sale", amount, status: "error", member_id: o.member_id || null, ref: o.ref, descr: o.descr, response: { error: String((e as Error).message) } }); throw e; }
      const s = readSale(r, tk.card);
      const logId = await log({ kind: "sale", payment_id: s.id || null, amount, status: s.approved ? "approved" : "declined", method: s.method, label: s.label, member_id: o.member_id || null, ref: o.ref, descr: o.descr, response: r });
      if (!s.approved) throw new Error("The card was declined" + (s.message ? ": " + s.message : ""));
      return { ...s, amount, logId };
    };

    if (action === "configure") {
      if (!staff) return json({ error: "Only the club's staff may set up payments" }, 403);
      const cur = acct || ({} as Partial<Acct>); const keep = (k: keyof Acct, v: unknown) => (v === undefined || v === null || v === "" ? (cur[k] ?? null) : String(v));
      const row = { tenant, provider: "deluxe", env: b.env === "production" ? "production" : "sandbox", client_id: keep("client_id", b.client_id), client_secret: keep("client_secret", b.client_secret), partner_token: keep("partner_token", b.partner_token), hpf_token: keep("hpf_token", b.hpf_token), webhook_secret: keep("webhook_secret", b.webhook_secret), updated_at: new Date().toISOString(), updated_by: who };
      const { error } = await admin.from("payment_accounts").upsert(row, { onConflict: "tenant" }); if (error) return json({ error: error.message });
      tokens.delete(tenant + ":sandbox"); tokens.delete(tenant + ":production"); acct = { ...row, status: null } as Acct;
      const st = await check(); acct.status = st; return json({ ok: true, account: redacted(acct), webhook: `${url}/functions/v1/payments-webhook?tenant=${encodeURIComponent(tenant)}` });
    }
    if (action === "status") {
      if (!staff) return json({ error: "Staff only" }, 403);
      if (!acct) return json({ ok: true, configured: false, account: null, webhook: `${url}/functions/v1/payments-webhook?tenant=${encodeURIComponent(tenant)}` });
      const st = await check(); acct.status = st; return json({ ok: true, configured: true, account: redacted(acct), webhook: `${url}/functions/v1/payments-webhook?tenant=${encodeURIComponent(tenant)}` });
    }
    if (action === "transactions") {
      if (!staff) return json({ error: "Staff only" }, 403);
      const { data } = await admin.from("payments").select("id, kind, payment_id, parent_id, amount, status, method, label, member_id, ref, descr, created_at, created_by").eq("tenant", tenant).order("created_at", { ascending: false }).limit(Math.min(500, Number(b.limit) || 100));
      return json({ ok: true, rows: data || [] });
    }
    if (!acct || !acct.status?.ok) return json({ error: acct ? "This club does not take payments online yet: " + String(acct.status?.message || "check the connection in Billing setup") : "not configured: set up Deluxe in Billing setup" });
    if (action === "hpf") {
      const xtoken = acct.hpf_token || acct.partner_token;   // the form renders with the Partner Token (verified on the sandbox); a separate HPF token wins when Deluxe issues one
      if (!xtoken) return json({ error: "The Hosted Payment Form token is missing — add it in Billing setup" });
      return json({ ok: true, script: DPP.hpfScript, xtoken, env: acct.env });
    }
    if (["pay", "setup", "wallet_add", "wallet_remove", "wallet_default", "autopay_on", "autopay_off"].includes(action)) {
      const m = await memberMe(); if (!m) return json({ error: "Your e-mail is not on the club's directory" });
      const { data: u } = await admin.from("member_users").select("*").eq("tenant", tenant).eq("member_id", m.id).maybeSingle();
      const tk = tokenOf(b.token), token = b.token;
      const vaultIn = async (nickname: string, makeDefault: boolean) => {   // a fresh token into the vault, then into the wallet
        const customerId = await customerFor(m, u);
        const r = await dpp(acct!, "POST", DPP.paymentMethods, { customerId: Number(customerId) || customerId, paymentMethod: { token: { token: tk.token, expiry: tk.expiry } }, accNickName: nickname || "Wallet" });
        const s = readSale(r, tk.card); const methodId = s.methodId || String(r.id || ""); if (!methodId) throw new Error("Deluxe did not keep the card" + (s.message ? ": " + s.message : ""));
        const row = await walletAdd(m.id, customerId, methodId, s, tk.expiry, nickname, makeDefault);
        await log({ kind: "vault", payment_id: methodId, amount: 0, status: "stored", method: s.method, label: s.label, member_id: m.id, ref: "wallet", descr: "Kept in the wallet", response: r }); return { row, s };
      };
      if (action === "wallet_add" || action === "setup") {
        if (!tk.token) return json({ error: "The card was not tokenized" });
        try { const { row, s } = await vaultIn(String(b.nickname || ""), !!b.make_default || action === "setup"); if (action === "setup") { await admin.from("member_users").update({ autopay: true }).eq("tenant", tenant).eq("member_id", m.id); await syncAutopay(m.id); } return json({ ok: true, id: row?.id, label: s.label }); }
        catch (e) { return json({ error: String((e as Error).message) }); }
      }
      if (action === "wallet_remove") {
        const { data: w } = await admin.from("member_payment_methods").select("*").eq("tenant", tenant).eq("member_id", m.id).eq("id", String(b.id)).is("removed_at", null).maybeSingle(); if (!w) return json({ error: "That payment method is not in your wallet" });
        try { await dpp(acct, "PATCH", DPP.paymentMethods + "/" + encodeURIComponent(w.method_id), { customerId: Number(w.customer_id) || w.customer_id, isActive: false }); } catch (_) { /* the vault keeps it; the wallet forgets it */ }
        await admin.from("member_payment_methods").update({ removed_at: new Date().toISOString(), is_default: false }).eq("id", w.id);
        const left = await walletOf(m.id); if (w.is_default && left[0]) await admin.from("member_payment_methods").update({ is_default: true }).eq("id", left[0].id);
        await syncAutopay(m.id); return json({ ok: true });
      }
      if (action === "wallet_default" || action === "autopay_on") {
        if (b.id) { const { data: w } = await admin.from("member_payment_methods").select("id").eq("tenant", tenant).eq("member_id", m.id).eq("id", String(b.id)).is("removed_at", null).maybeSingle(); if (!w) return json({ error: "That payment method is not in your wallet" });
          await admin.from("member_payment_methods").update({ is_default: false }).eq("tenant", tenant).eq("member_id", m.id); await admin.from("member_payment_methods").update({ is_default: true }).eq("id", w.id); }
        if (action === "autopay_on") { const w = await walletOf(m.id); if (!w.length) return json({ error: "Add a card or bank account first" }); await admin.from("member_users").upsert({ tenant, member_id: m.id, email: m.email || "", autopay: true }, { onConflict: "tenant,member_id" }); }
        await syncAutopay(m.id); return json({ ok: true });
      }
      if (action === "autopay_off") { await admin.from("member_users").update({ autopay: false, pay_method: null }).eq("tenant", tenant).eq("member_id", m.id); return json({ ok: true }); }
      // pay: a card from the wallet, or a fresh token (kept in the wallet when asked)
      let s: Awaited<ReturnType<typeof sale>>, kept = false;
      if (b.method_id) {
        const { data: w } = await admin.from("member_payment_methods").select("*").eq("tenant", tenant).eq("member_id", m.id).eq("id", String(b.method_id)).is("removed_at", null).maybeSingle(); if (!w) return json({ error: "That payment method is not in your wallet" });
        s = await sale({ methodId: w.method_id, customerId: w.customer_id, amount: Number(b.amount), descr: `${t.name} — member account payment`, ref: "acct", member_id: m.id });
        s.label = [w.nickname, w.label].filter(Boolean).join(" · ") || s.label;
      } else {
        if (!tk.token) return json({ error: "The card was not tokenized" });
        s = await sale({ token, amount: Number(b.amount), descr: `${t.name} — member account payment`, ref: "acct", member_id: m.id });
        if (b.save) { try { await vaultIn(String(b.nickname || ""), !!b.make_default); kept = true; } catch (_) { kept = false; } }
      }
      const itemId = await postPayment(m.id, s.amount, "deluxe:" + s.id, "Online payment" + (kept ? " (card kept in the wallet)" : ""), s.method, s.id);
      if (itemId) await admin.from("payments").update({ acct_item: itemId }).eq("id", s.logId);
      return json({ ok: true, payment_id: s.id, amount: s.amount, label: s.label, kept });
    }
    if (action === "sale") {
      if (!staff && !station) return json({ error: "Staff or a register only" }, 403);
      const ref = String(b.ref || "sale"), member_id = b.member_id ? String(b.member_id) : "";
      const s = await sale({ token: b.token, amount: Number(b.amount), descr: String(b.descr || t.name), ref, member_id });
      return json({ ok: true, payment_id: s.id, amount: s.amount, label: s.label, method: s.method });
    }
    if (action === "charge_vault" || action === "autopay_run") {
      if (!staff) return json({ error: "Staff only" }, 403);
      const run = async (u: Record<string, unknown>, amount: number, descr: string) => {
        const s = await sale({ methodId: String(u.pay_method), customerId: String(u.pay_customer || ""), amount, descr, ref: "autopay", member_id: String(u.member_id) });
        const itemId = await postPayment(String(u.member_id), s.amount, "deluxe:" + s.id, descr, s.method, s.id); if (itemId) await admin.from("payments").update({ acct_item: itemId }).eq("id", s.logId); return s;
      };
      const balance = async (member_id: string) => { const { data: items } = await admin.from("acct_items").select("kind, amount").eq("tenant", tenant).eq("member_id", member_id).is("void_at", null); return r2((items || []).reduce((s: number, i: { kind: string; amount: number }) => s + (i.kind === "charge" ? Number(i.amount) : -Number(i.amount)), 0)); };
      if (action === "charge_vault") {
        const { data: u } = await admin.from("member_users").select("*").eq("tenant", tenant).eq("member_id", String(b.member_id)).maybeSingle();
        if (!u?.pay_method) return json({ error: "No card on file for this member" });
        const amount = Number(b.amount) || await balance(String(b.member_id)); const s = await run(u, amount, String(b.descr || "Card on file — charged by the office"));
        return json({ ok: true, payment_id: s.id, amount: s.amount, label: s.label });
      }
      const { data: users } = await admin.from("member_users").select("*").eq("tenant", tenant).eq("autopay", true);
      const out: { member_id: string; amount: number; ok: boolean; error?: string }[] = [];
      for (const u of users || []) { if (!u.pay_method) continue; const bal = await balance(u.member_id); if (bal < 1) continue;
        try { const s = await run(u, bal, "Autopay — card on file"); out.push({ member_id: u.member_id, amount: s.amount, ok: true }); } catch (e) { out.push({ member_id: u.member_id, amount: bal, ok: false, error: String((e as Error).message || e) }); } }
      return json({ ok: true, results: out });
    }
    if (action === "refund") {
      if (!staff) return json({ error: "Staff only" }, 403);
      const pid = String(b.payment_id || ""); const { data: orig } = await admin.from("payments").select("*").eq("tenant", tenant).eq("kind", "sale").eq("payment_id", pid).maybeSingle();
      if (!orig) return json({ error: "That payment is not in the log" });
      const { data: prev } = await admin.from("payments").select("amount").eq("tenant", tenant).eq("kind", "refund").eq("parent_id", pid).eq("status", "approved");
      const done = r2((prev || []).reduce((s: number, x: { amount: number }) => s + Number(x.amount), 0)); const amount = r2(Number(b.amount) || (Number(orig.amount) - done));
      if (amount <= 0 || amount > Number(orig.amount) - done + 0.004) return json({ error: `Up to ${(Number(orig.amount) - done).toFixed(2)} can still be refunded` });
      let r: Record<string, unknown>, kind = "refund";
      try { r = await dpp(acct, "POST", DPP.refunds, { paymentId: pid, amount: { amount, currency: "USD" } }); }
      catch (e) {   // the same day, before the batch settles, Deluxe refuses a refund: a VOID of the whole payment does it instead
        const msg = String((e as Error).message); if (/not settled/i.test(msg) && Math.abs(amount - (Number(orig.amount) - done)) < 0.005 && done === 0) { try { r = await dpp(acct, "POST", DPP.cancel, { paymentId: pid }); kind = "void"; } catch (e2) { await log({ kind: "refund", parent_id: pid, amount, status: "error", member_id: orig.member_id, ref: orig.ref, descr: String(b.reason || ""), response: { error: String((e2 as Error).message) } }); return json({ error: String((e2 as Error).message) }); } }
        else { await log({ kind: "refund", parent_id: pid, amount, status: "error", member_id: orig.member_id, ref: orig.ref, descr: String(b.reason || ""), response: { error: msg } }); return json({ error: /not settled/i.test(msg) ? "A payment can only be refunded in part once it has settled (overnight) — refund the whole amount now, or the part tomorrow" : msg }); } }
      const s = readSale(r); if (!s.approved) return json({ error: "The refund was not accepted" + (s.message ? ": " + s.message : "") });
      await log({ kind, payment_id: s.id || null, parent_id: pid, amount, status: "approved", method: orig.method, label: orig.label, member_id: orig.member_id, ref: orig.ref, descr: String(b.reason || "Refund"), response: r });
      if (orig.member_id && orig.acct_item) {   // the reversal on the member's account, once per refund
        const ref = `refund:${pid}:${s.id || done + amount}`; const { data: had } = await admin.from("acct_items").select("id").eq("tenant", tenant).eq("ref", ref).maybeSingle();
        if (!had) await admin.from("acct_items").insert({ tenant, member_id: orig.member_id, kind: "charge", source: "manual", item: "other", ref, descr: "Online payment refunded" + (b.reason ? " · " + String(b.reason) : ""), amount, posted: today(), created_by: who });
      }
      return json({ ok: true, refund_id: s.id, amount });
    }
    return json({ error: "Unknown action" });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }); }   // a 200 with the message: the clients show it (supabase-js hides the body of a non-2xx answer)
});
