// Flagstick — outbound e-mail for a club's staff (statements). Deploy as the Edge Function `mail`.
// Sends through Resend (https://resend.com): set the secrets RESEND_API_KEY and, optionally, MAIL_FROM
// ("Flagstick <statements@flagstickhub.com>" by default — the sending domain must be verified in Resend).
// Only a staff login of the tenant (or a Flagstick admin) may send; replies go to the club's login e-mail.
//
//   POST {tenant, to, subject, text, html?, attachments?: [{filename, content (base64)}]} → {ok, id} | {error}
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "not configured: set RESEND_API_KEY" });
    const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: me, error: e0 } = await admin.auth.getUser(jwt);
    if (e0 || !me?.user) return json({ error: "Not signed in" }, 401);
    const b = await req.json();
    const tenant = String(b.tenant || "");
    const { data: isAdmin } = await admin.from("flagstick_admins").select("user_id").eq("user_id", me.user.id).maybeSingle();
    if (!isAdmin) {
      const { data: g } = await admin.from("tenant_users").select("role").eq("user_id", me.user.id).eq("tenant", tenant).maybeSingle();
      if (g?.role !== "staff") return json({ error: "Only the club's staff may send e-mail" }, 403);
    }
    const { data: t } = await admin.from("tenants").select("name, login_email").eq("slug", tenant).maybeSingle();
    const to = String(b.to || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: "Bad address" });
    const payload: Record<string, unknown> = {
      from: Deno.env.get("MAIL_FROM") || "Flagstick <statements@flagstickhub.com>",
      to: [to], subject: String(b.subject || (t?.name || "Flagstick")).slice(0, 200),
      text: String(b.text || ""), html: b.html ? String(b.html) : undefined,
      reply_to: t?.login_email || undefined,
      attachments: Array.isArray(b.attachments) ? b.attachments.slice(0, 5).map((a: { filename: string; content: string }) => ({ filename: String(a.filename || "file.pdf"), content: String(a.content || "") })) : undefined,
    };
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: out?.message || ("Mail failed (" + r.status + ")") });
    return json({ ok: true, id: out?.id });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
});
