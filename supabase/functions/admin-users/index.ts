// Flagstick — privileged account actions for the client portal. Deploy as the Edge Function `admin-users`
// (Supabase dashboard → Edge Functions → Deploy new function → paste this file; or `supabase functions deploy admin-users`).
// Every call carries the caller's own session token. A Flagstick admin may do everything. A club's STAFF login may
// create / invite / reset / unlink board logins of its own club; a board ADMINISTRATOR (an org login with `manage`)
// may do the same for board logins inside its own organizations. Nobody else gets past the first check.
//
// Actions (POST JSON {action, ...} → {ok, data} | {error}):
//   create       {email, password, name?, tenant?, role?, orgs?, manage?, admin?}  create a login with a password the caller sets
//   invite       {email, name?, tenant?, role?, orgs?, manage?, admin?, redirect}  create the login and e-mail an invite (they set a password)
//   set_password {user_id, password, tenant?}                                     set / reset a password (within the caller's scope)
//   delete       {user_id}                                                        delete the login everywhere (Flagstick only)
//   sso          {redirect}                                                       a one-time sign-in link for the caller (Flagstick only)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: me, error: e0 } = await admin.auth.getUser(jwt);
    if (e0 || !me?.user) return json({ error: "Not signed in" }, 401);
    const { data: isAdmin } = await admin.from("flagstick_admins").select("user_id").eq("user_id", me.user.id).maybeSingle();
    const b = await req.json();
    const email = String(b.email || "").trim().toLowerCase();
    const role = b.role === "org" ? "org" : "staff", orgs: string[] = Array.isArray(b.orgs) ? b.orgs.map(String) : [];
    // what may this caller do? Flagstick: everything. Otherwise their grant on b.tenant decides.
    let may = !!isAdmin;
    if (!may && b.tenant && !b.admin && ["create", "invite", "set_password"].includes(b.action)) {
      const { data: g } = await admin.from("tenant_users").select("role, orgs, manage").eq("user_id", me.user.id).eq("tenant", b.tenant).maybeSingle();
      const sub = (a: string[], of: string[]) => a.every((x) => of.includes(x));
      if (g?.role === "staff") may = true;
      else if (g?.role === "org" && g.manage && role === "org" && orgs.length && sub(orgs, g.orgs || [])) may = true;
      if (may && b.action === "set_password") {   // the target must be a login of this club inside the caller's scope
        const { data: tgt } = await admin.from("tenant_users").select("role, orgs").eq("user_id", b.user_id).eq("tenant", b.tenant).maybeSingle();
        may = !!tgt && (g?.role === "staff" ? tgt.role === "org" || tgt.role === "staff" : tgt.role === "org" && sub(tgt.orgs || [], g!.orgs || []));
      }
    }
    if (!may) return json({ error: isAdmin ? "Not allowed" : "Your login may not manage these logins" }, 403);
    const link = async (userId: string) => {   // attach the login to a tenant and/or the Flagstick team
      if (b.tenant) {
        const { error } = await admin.from("tenant_users").upsert({ user_id: userId, tenant: b.tenant, role, orgs, manage: role === "org" && !!b.manage, email, name: b.name || "", invited_at: b.action === "invite" ? new Date().toISOString() : null }, { onConflict: "user_id,tenant" });
        if (error) throw error;
      }
      if (b.admin) { const { error } = await admin.from("flagstick_admins").upsert({ user_id: userId, email }); if (error) throw error; }
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
        if (!email) return json({ error: "E-mail required" }, 400);
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: b.redirect || undefined, data: { name: b.name || "" } });
        if (error) return json({ error: error.message }, 400);
        await link(data.user.id);
        return json({ ok: true, data: { id: data.user.id, email } });
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
