// Flagstick — privileged account actions for the hubs and the client portal. Deploy as the Edge Function `admin-users`
// (Supabase MCP / dashboard → Edge Functions, or `supabase functions deploy admin-users`). Needs login-invites-setup.sql.
// Every call but `accept` carries the caller's own session token. A Flagstick admin may do everything. A club's STAFF
// login may create / invite / reset / unlink logins of its own club; a board ADMINISTRATOR (an org login with `manage`)
// may do the same for board logins inside its own organizations. Nobody else gets past the first check.
//
// Actions (POST JSON {action, ...} → {ok, data} | {error}):
//   create       {email, password, name?, tenant?, role?, orgs?, manage?, admin?}  create a login with a password the caller sets
//   invite       {email, name?, tenant?, role?, orgs?, manage?, admin?, redirect}  find or create the login, link it, e-mail an
//                                                                                 invitation through the club's own mailer (the `mail`
//                                                                                 function) with a 7-day link → {id, email, existed,
//                                                                                 signedIn, sent, link, mailError?, from?}
//   reinvite     {user_id, tenant?, redirect}                                     a fresh invitation (or sign-in link) for an existing login
//   accept       {token}                                                          NO sign-in: the hub hands back an invite token on arrival →
//                                                                                 {token_hash, email, fresh} for sb.auth.verifyOtp (one use)
//   set_password {user_id, password, tenant?}                                     set / reset a password (within the caller's scope)
//   delete       {user_id}                                                        delete the login everywhere (Flagstick only)
//   sso          {redirect}                                                       a one-time sign-in link for the caller (Flagstick only)
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((x) => x.toString(16).padStart(2, "0")).join("");
const randomToken = () => { const u = new Uint8Array(32); crypto.getRandomValues(u); return btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const DOMAIN = Deno.env.get("BASE_DOMAIN") || "flagstickhub.com";
const INVITE_DAYS = 7;

/* an invitation token → a one-time sign-in for that login (no caller session: the hub calls this on arrival) */
async function accept(admin: SupabaseClient, b: Record<string, unknown>) {
  const token = String(b.token || "");
  if (token.length < 20) return json({ error: "That invitation link is not valid" }, 400);
  const { data: inv } = await admin.from("login_invites").select("*").eq("token_hash", await sha256(token)).maybeSingle();
  if (!inv) return json({ error: "That invitation link is not valid" }, 400);
  if (inv.used_at) return json({ error: "That invitation link has already been used — sign in with your password, or ask for a new invitation" }, 400);
  if (new Date(inv.expires_at).getTime() < Date.now()) return json({ error: "That invitation has expired — ask for a new one" }, 400);
  const { data: u, error: eu } = await admin.auth.admin.getUserById(inv.user_id);
  if (eu || !u?.user?.email) return json({ error: "That login no longer exists" }, 400);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (error) return json({ error: error.message }, 400);
  await admin.from("login_invites").update({ used_at: new Date().toISOString() }).eq("id", inv.id);
  return json({ ok: true, data: { token_hash: data.properties.hashed_token, email: u.user.email, fresh: !u.user.last_sign_in_at, tenant: inv.tenant, role: inv.role } });
}

/* the invitation e-mail: the club's name in the band, who invited them, one button, the plain link, the 7-day note */
function inviteMail(o: { hub: string; what: string; by: string; link: string; signedIn: boolean; url: string }) {
  const title = o.signedIn ? `You now have access to ${o.what}` : `You're invited to manage ${o.what}`;
  const lead = o.signedIn
    ? `${o.by} has given your Flagstick login access to ${o.what}. Open the hub with the button below — your usual password works there.`
    : `${o.by} has invited you to manage ${o.what} on Flagstick. Open the link below to choose your password; after that you sign in at ${o.url}.`;
  const note = `This link is for you alone and works for ${INVITE_DAYS} days. If it has expired, ask ${o.by} to send a new one from the hub.`;
  const text = `${title}\n\n${lead}\n\n${o.link}\n\n${note}\n\nFlagstick · ${DOMAIN}`;
  const html = `<!doctype html><html><body style="margin:0;background:#F4F0E6;padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="560" style="max-width:560px;background:#fff;border:1px solid #E3DCC9;border-radius:12px" cellspacing="0" cellpadding="0">
    <tr><td style="background:#0F2A38;border-radius:12px 12px 0 0;padding:18px 24px;border-bottom:4px solid #C7A13A"><div style="font:700 18px Georgia,serif;color:#fff">${esc(o.hub)}</div></td></tr>
    <tr><td style="padding:22px 24px 8px"><h1 style="margin:0 0 14px;font:700 24px Georgia,serif;color:#0F2A38">${esc(title)}</h1>
      <p style="margin:0 0 12px;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14222B">${esc(lead)}</p>
      <p style="margin:18px 0 6px"><a href="${esc(o.link)}" style="display:inline-block;background:#0F2A38;color:#fff;text-decoration:none;font:700 14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:12px 20px;border-radius:10px">${o.signedIn ? "Open the hub" : "Set up your login"}</a></p>
      <p style="margin:0 0 12px;font:12.5px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#56626A;word-break:break-all">Or paste this into your browser: ${esc(o.link)}</p></td></tr>
    <tr><td style="padding:10px 24px 20px;font:12.5px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#56626A;border-top:1px solid #E3DCC9">${esc(note)}<br>Flagstick · ${esc(DOMAIN)}</td></tr></table></td></tr></table></body></html>`;
  return { subject: title, text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
    const b = await req.json();
    if (b.action === "accept") return await accept(admin, b);   // the one action without a signed-in caller
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: me, error: e0 } = await admin.auth.getUser(jwt);
    if (e0 || !me?.user) return json({ error: "Not signed in" }, 401);
    const { data: isAdmin } = await admin.from("flagstick_admins").select("user_id").eq("user_id", me.user.id).maybeSingle();
    const email = String(b.email || "").trim().toLowerCase();
    let role = b.role === "org" ? "org" : "staff", orgs: string[] = Array.isArray(b.orgs) ? b.orgs.map(String) : [];
    const sub = (a: string[], of: string[]) => a.every((x) => of.includes(x));
    // what may this caller do? Flagstick: everything. Otherwise their grant on b.tenant decides.
    let may = !!isAdmin;
    let target: { role: string; orgs: string[]; email?: string; name?: string } | null = null;   // the login a set_password / reinvite is about
    if (b.tenant && ["set_password", "reinvite"].includes(b.action) && b.user_id) {
      const { data: tgt } = await admin.from("tenant_users").select("role, orgs, email, name").eq("user_id", b.user_id).eq("tenant", b.tenant).maybeSingle();
      target = tgt;
    }
    if (!may && b.tenant && !b.admin && ["create", "invite", "set_password", "reinvite"].includes(b.action)) {
      const { data: g } = await admin.from("tenant_users").select("role, orgs, manage").eq("user_id", me.user.id).eq("tenant", b.tenant).maybeSingle();
      if (["set_password", "reinvite"].includes(b.action)) {   // the target must be a login of this club inside the caller's scope
        may = !!target && (g?.role === "staff" ? true : !!(g?.role === "org" && g.manage && target.role === "org" && sub(target.orgs || [], g.orgs || [])));
      } else if (g?.role === "staff") may = true;
      else if (g?.role === "org" && g.manage && role === "org" && orgs.length && sub(orgs, g.orgs || [])) may = true;
    }
    if (!may) return json({ error: isAdmin ? "Not allowed" : "Your login may not manage these logins" }, 403);
    const link = async (userId: string) => {   // attach the login to a tenant and/or the Flagstick team
      if (b.tenant) {
        const { error } = await admin.from("tenant_users").upsert({ user_id: userId, tenant: b.tenant, role, orgs, manage: role === "org" && !!b.manage, email, name: b.name || "", invited_at: b.action === "invite" ? new Date().toISOString() : null }, { onConflict: "user_id,tenant" });
        if (error) throw error;
      }
      if (b.admin) { const { error } = await admin.from("flagstick_admins").upsert({ user_id: userId, email }); if (error) throw error; }
    };
    /* mint a 7-day token for this login and send the invitation through the club's mailer; the link comes back whatever happened */
    const invite = async (userId: string, to: string, signedIn: boolean) => {
      const token = randomToken();
      const { error } = await admin.from("login_invites").insert({ tenant: b.tenant || null, user_id: userId, email: to, token_hash: await sha256(token), role: b.admin ? "admin" : role, orgs, by_email: me.user.email || "", redirect: String(b.redirect || "") });
      if (error) throw error;
      const base = String(b.redirect || (b.tenant ? `https://${b.tenant}.${DOMAIN}/` : `https://app.${DOMAIN}/`));
      const invLink = base + (base.includes("#") ? "&" : "#") + "invite=" + token;
      let hub = "Flagstick", what = "the Flagstick portal", mailOrg = "club";
      if (b.tenant) {
        const { data: t } = await admin.from("tenants").select("name").eq("slug", b.tenant).maybeSingle();
        hub = t?.name || b.tenant; what = hub;
        if (role === "org" && orgs.length) {   // a board login: name the organizations it opens
          const { data: c } = await admin.from("mga_hub").select("orgs:data->orgs").eq("tenant", b.tenant).eq("id", "club").maybeSingle();
          const names = orgs.map((id) => { const o = ((c?.orgs as { id: string; name: string; short?: string }[]) || []).find((x) => x.id === id); return o ? (o.name || o.short || id) : id; });
          what = names.join(", ") + " at " + hub; if (orgs.length === 1) mailOrg = orgs[0];
        }
      }
      const by = (me.user.user_metadata?.name as string) || me.user.email || "Flagstick";
      const m = inviteMail({ hub, what, by, link: invLink, signedIn, url: base.split("#")[0] });
      let sent = false, mailError: string | undefined, from: string | undefined;
      try {
        const r = await fetch(`${url}/functions/v1/mail`, { method: "POST", headers: { Authorization: "Bearer " + jwt, apikey: anon, "Content-Type": "application/json" },
          body: JSON.stringify({ tenant: b.tenant || "", org: mailOrg, to, subject: m.subject, text: m.text, html: m.html }) });
        const out = await r.json().catch(() => ({}));
        if (r.ok && out?.ok) { sent = true; from = out.via; } else mailError = out?.error || ("mail answered " + r.status);
      } catch (e) { mailError = String((e as Error)?.message || e); }
      return { sent, link: invLink, mailError, from, signedIn };
    };
    switch (b.action) {
      case "create": {
        if (!email || !b.password || String(b.password).length < 8) return json({ error: "E-mail and a password of at least 8 characters" }, 400);
        const { data, error } = await admin.auth.admin.createUser({ email, password: String(b.password), email_confirm: true, user_metadata: { name: b.name || "" } });
        if (error) return json({ error: error.message }, 400);
        await link(data.user.id);
        return json({ ok: true, data: { id: data.user.id, email } });
      }
      case "invite": {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "A valid e-mail address is required" }, 400);
        // an existing login (another club's staff, a Flagstick person, someone invited before) is linked, never duplicated
        const { data: found } = await admin.rpc("auth_user_by_email", { p_email: email });
        let userId: string, signedIn = false, existed = false;
        if (found?.id) { userId = found.id; existed = true; signedIn = !!found.last_sign_in_at; }
        else {
          const { data, error } = await admin.auth.admin.createUser({ email, password: randomToken(), email_confirm: true, user_metadata: { name: b.name || "" } });
          if (error) return json({ error: error.message }, 400);
          userId = data.user.id;
        }
        await link(userId);
        const r = await invite(userId, email, signedIn);
        return json({ ok: true, data: { id: userId, email, existed, ...r } });
      }
      case "reinvite": {
        if (!b.user_id) return json({ error: "user_id required" }, 400);
        if (b.tenant) { if (!target) return json({ error: "No such login here" }, 404); role = target.role === "org" ? "org" : "staff"; orgs = target.orgs || []; }
        else if (!isAdmin) return json({ error: "Not allowed" }, 403);
        const { data: u, error: eu } = await admin.auth.admin.getUserById(String(b.user_id));
        if (eu || !u?.user?.email) return json({ error: "That login no longer exists" }, 404);
        if (b.tenant) await admin.from("tenant_users").update({ invited_at: new Date().toISOString() }).eq("user_id", b.user_id).eq("tenant", b.tenant);
        const r = await invite(u.user.id, u.user.email, !!u.user.last_sign_in_at);
        return json({ ok: true, data: { id: u.user.id, email: u.user.email, existed: true, ...r } });
      }
      case "set_password": {
        if (!b.user_id || !b.password || String(b.password).length < 8) return json({ error: "A password of at least 8 characters" }, 400);
        const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: String(b.password) });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "delete": {
        if (!b.user_id) return json({ error: "user_id required" }, 400);
        if (b.user_id === me.user.id) return json({ error: "You cannot delete your own login" }, 400);
        const { error } = await admin.auth.admin.deleteUser(b.user_id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "sso": {   // one-time link for the caller themselves; the hub verifies it and signs them in there
        const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: me.user.email!, options: { redirectTo: b.redirect || undefined } });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, data: { token_hash: data.properties.hashed_token } });
      }
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
});
