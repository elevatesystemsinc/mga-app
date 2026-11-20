// Flagstick — the Deluxe Payments Platform webhook. Deploy as the Edge Function `payments-webhook` with --no-verify-jwt
// (Deluxe signs each delivery: x-dpp-signature = HMAC-SHA256 hex of the raw body with the webhook secret the club pasted into
// Billing setup). The listening URL carries the club: …/functions/v1/payments-webhook?tenant=<slug> — give that URL to DPP
// (Developer Portal → Webhooks) for the events payment.completed / Payment Processed, refund.processed, ACH/EFT reject,
// Merchant Loaded / Merchant Updated. Every event is applied once (by the processor's id) and the raw event is kept on the
// payments log; a Merchant Loaded payload is kept on the account row for staff to read.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const pick = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o[k] != null && o[k] !== "") return o[k]; return undefined; };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const tenant = new URL(req.url).searchParams.get("tenant") || "";
  const { data: acct } = await admin.from("payment_accounts").select("tenant, webhook_secret, status").eq("tenant", tenant).maybeSingle();
  if (!acct) return new Response("unknown club", { status: 404 });
  const raw = await req.text();
  const sig = (req.headers.get("x-dpp-signature") || req.headers.get("X-DPP-Signature") || "").trim().toLowerCase().replace(/^sha256=/, "");
  if (acct.webhook_secret) { const want = await hmacHex(acct.webhook_secret, raw); if (!sig || !same(sig, want)) return new Response("bad signature", { status: 401 }); }
  let ev: Record<string, unknown> = {}; try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const type = String(pick(ev, ["event_type", "eventType", "type", "event"]) || "").toLowerCase().replace(/[\s_]+/g, ".");
  const data = ((ev.data || ev.payload || ev) as Record<string, unknown>);
  const pid = String(pick(data, ["transaction_id", "transactionId", "paymentId", "payment_id", "id"]) || "");
  const amount = r2(Number(pick(data, ["amount", "total", "transactionAmount"]) || 0));
  const status = String(pick(data, ["status", "responseMessage", "result"]) || "").toLowerCase();
  const eventId = String(pick(ev, ["event_id", "eventId", "id"]) || "");
  try {
    if (/merchant/.test(type)) {   // Merchant Loaded / Updated: keep it for staff; the credentials arrive by e-mail and are pasted in Billing setup
      await admin.from("payment_accounts").update({ status: { ...(acct.status || {}), merchant: { type, at: new Date().toISOString(), data } } }).eq("tenant", tenant);
      return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
    }
    const { data: row } = pid ? await admin.from("payments").select("*").eq("tenant", tenant).eq("kind", "sale").eq("payment_id", pid).maybeSingle() : { data: null };
    if (/payment|transaction|sale/.test(type)) {
      if (row) {
        const ok = !/declin|fail|reject|return|void|error/.test(status);
        await admin.from("payments").update({ status: ok ? "approved" : "declined", response: { ...(row.response || {}), webhook: { type, eventId, at: new Date().toISOString(), data } } }).eq("id", row.id);
        if (ok && row.member_id && !row.acct_item && row.ref !== "pos" && !String(row.ref || "").startsWith("pos:") && !String(row.ref || "").startsWith("fund:")) {   // a member payment the sync answer did not post (it normally does)
          const ref = "deluxe:" + pid; const { data: had } = await admin.from("acct_items").select("id").eq("tenant", tenant).eq("ref", ref).maybeSingle();
          if (!had) { const { data: it } = await admin.from("acct_items").insert({ tenant, member_id: row.member_id, kind: "payment", source: "manual", item: "payment", ref, descr: row.descr || "Online payment", amount: amount || Number(row.amount), method: row.method || "card", reference: pid, posted: today(), created_by: "deluxe-webhook" }).select("id").maybeSingle(); if (it) await admin.from("payments").update({ acct_item: it.id }).eq("id", row.id); }
        }
      } else if (pid) {   // a sale made outside Flagstick (the virtual terminal, a payment link): log it so it shows in the transactions
        await admin.from("payments").insert({ tenant, provider: "deluxe", kind: "sale", payment_id: pid, amount, status: /declin|fail/.test(status) ? "declined" : "approved", ref: "external", descr: String(pick(data, ["description", "descr"]) || type), response: { webhook: { type, eventId, data } }, created_by: "deluxe-webhook" });
      }
    } else if (/refund/.test(type)) {
      const parent = String(pick(data, ["original_transaction_id", "originalTransactionId", "parentPaymentId", "paymentId"]) || pid);
      const { data: had } = await admin.from("payments").select("id").eq("tenant", tenant).eq("kind", "refund").eq("payment_id", pid).maybeSingle();
      if (!had && pid) {   // a refund made from the Deluxe portal: log it and post the reversal on the member's account
        const { data: sale } = await admin.from("payments").select("*").eq("tenant", tenant).eq("kind", "sale").eq("payment_id", parent).maybeSingle();
        await admin.from("payments").insert({ tenant, provider: "deluxe", kind: "refund", payment_id: pid, parent_id: parent, amount, status: "approved", member_id: sale?.member_id || null, ref: sale?.ref || "external", descr: "Refund (from Deluxe)", response: { webhook: { type, eventId, data } }, created_by: "deluxe-webhook" });
        if (sale?.member_id && sale?.acct_item && amount > 0) { const ref = `refund:${parent}:${pid}`; const { data: h2 } = await admin.from("acct_items").select("id").eq("tenant", tenant).eq("ref", ref).maybeSingle();
          if (!h2) await admin.from("acct_items").insert({ tenant, member_id: sale.member_id, kind: "charge", source: "manual", item: "other", ref, descr: "Online payment refunded", amount, posted: today(), created_by: "deluxe-webhook" }); }
      }
    } else if (/ach|eft|reject|return|chargeback/.test(type)) {   // the bank bounced it: the payment on the account is voided, so the balance reopens
      if (row) {
        await admin.from("payments").update({ status: "returned", response: { ...(row.response || {}), webhook: { type, eventId, at: new Date().toISOString(), data } } }).eq("id", row.id);
        if (row.acct_item) await admin.from("acct_items").update({ void_at: new Date().toISOString(), void_reason: "Payment returned by the bank (" + type + ")" }).eq("id", row.acct_item).is("void_at", null);
        if (row.member_id && row.ref === "autopay") await admin.from("member_users").update({ autopay: false }).eq("tenant", tenant).eq("member_id", row.member_id);
      }
    }
  } catch (e) { return new Response("error: " + String((e as Error)?.message || e), { status: 500 }); }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
