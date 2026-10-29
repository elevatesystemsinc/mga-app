// Flagstick — outgoing e-mail for a club or an organization, white-labelled. Deploy as the Edge Function `mail`.
//
// Who sends: a staff login of the tenant, a Flagstick admin, or an organization (board) login for its own org.
// From whom: the organization's row in mail_settings (Settings → Outgoing e-mail), falling back to the club's row,
// then to Flagstick (MAIL_FROM). How: provider 'resend' (https://resend.com — secret RESEND_API_KEY; a club's own
// domain once verified there) or 'm365' (the organization's Microsoft 365: an Azure app registration with the Graph
// application permission Mail.Send, client credentials stored on the row; the mail goes out of `mailbox`).
//
//   POST {tenant, org?, to, subject, text, html?, attachments?: [{filename, content (base64)}]} → {ok, id} | {error}
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
type Att = { filename: string; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: me, error: e0 } = await admin.auth.getUser(jwt);
    if (e0 || !me?.user) return json({ error: "Not signed in" }, 401);
    const b = await req.json();
    const tenant = String(b.tenant || ""), org = String(b.org || "club");
    const { data: isAdmin } = await admin.from("flagstick_admins").select("user_id").eq("user_id", me.user.id).maybeSingle();
    if (!isAdmin) {
      const { data: g } = await admin.from("tenant_users").select("role, orgs").eq("user_id", me.user.id).eq("tenant", tenant).maybeSingle();
      const ok = g?.role === "staff" || (g?.role === "org" && Array.isArray(g.orgs) && g.orgs.includes(org));
      if (!ok) return json({ error: "Your login may not send e-mail for this organization" }, 403);
    }
    const { data: t } = await admin.from("tenants").select("name, login_email").eq("slug", tenant).maybeSingle();
    const to = String(b.to || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: "Bad address" });
    // the sender: the organization's settings, else the club's, else Flagstick
    let { data: ms } = await admin.from("mail_settings").select("*").eq("tenant", tenant).eq("org", org).maybeSingle();
    if (!ms && org !== "club") ({ data: ms } = await admin.from("mail_settings").select("*").eq("tenant", tenant).eq("org", "club").maybeSingle());
    const subject = String(b.subject || (t?.name || "Flagstick")).slice(0, 200), text = String(b.text || ""), html = b.html ? String(b.html) : undefined;
    const atts: Att[] = Array.isArray(b.attachments) ? b.attachments.slice(0, 5).map((a: Att) => ({ filename: String(a.filename || "file.pdf"), content: String(a.content || "") })) : [];
    const fromName = ms?.from_name || t?.name || "Flagstick", replyTo = ms?.reply_to || t?.login_email || undefined;

    if (ms?.provider === "m365") {
      if (!ms.m365_tenant || !ms.m365_client || !ms.m365_secret || !ms.mailbox) return json({ error: "Microsoft 365 is not fully set up: tenant id, client id, secret and the sending mailbox are needed" });
      const tok = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(ms.m365_tenant)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: ms.m365_client, client_secret: ms.m365_secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
      const tj = await tok.json().catch(() => ({}));
      if (!tok.ok || !tj.access_token) return json({ error: "Microsoft 365 sign-in failed: " + (tj.error_description || tj.error || tok.status) });
      const message = { subject, body: { contentType: html ? "HTML" : "Text", content: html || text }, toRecipients: [{ emailAddress: { address: to } }],
        from: { emailAddress: { address: ms.from_email || ms.mailbox, name: fromName } }, replyTo: replyTo ? [{ emailAddress: { address: replyTo } }] : undefined,
        attachments: atts.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", contentBytes: a.content })) };
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ms.mailbox)}/sendMail`, { method: "POST", headers: { Authorization: "Bearer " + tj.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ message, saveToSentItems: true }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return json({ error: "Microsoft 365 refused the message: " + (e?.error?.message || r.status) }); }
      return json({ ok: true, id: "m365", via: "m365" });
    }
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "not configured: set RESEND_API_KEY" });
    const from = ms?.from_email ? `${fromName.replace(/[<>"]/g, "")} <${ms.from_email}>` : (Deno.env.get("MAIL_FROM") || "Flagstick <statements@flagstickhub.com>");
    const payload: Record<string, unknown> = { from, to: [to], subject, text, html, reply_to: replyTo, attachments: atts.length ? atts : undefined };
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: out?.message || ("Mail failed (" + r.status + ")") });
    return json({ ok: true, id: out?.id, via: "resend" });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
});
