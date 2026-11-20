// Flagstick — the website's "Book a demo" form. Deploy as the Edge Function `demo-request` with --no-verify-jwt (the marketing
// site has no session). POST {name, role, club, email, message?} → one e-mail to Flagstick (DEMO_TO, default info@flagstickhub.com)
// through Resend (RESEND_API_KEY, the sender MAIL_FROM — the same secrets the `mail` function uses), reply-to the visitor, and a
// short acknowledgement to the visitor. A honeypot field (`website`) filled in = a bot: answered ok, nothing sent. Rate: one
// request per e-mail address per minute inside this instance. Answers {ok} or {error}; the site falls back to a mailto.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
const recent = new Map<string, number>();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown> = {}; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const s = (k: string, max = 200) => String(b[k] ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  const name = s("name"), role = s("role"), club = s("club"), email = s("email").toLowerCase(), message = String(b.message ?? "").trim().slice(0, 2000);
  if (s("website")) return json({ ok: true });   // the honeypot
  if (!name || !club || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please give your name, your club and a valid e-mail address" });
  const last = recent.get(email) || 0; if (Date.now() - last < 60_000) return json({ ok: true }); recent.set(email, Date.now());
  const key = Deno.env.get("RESEND_API_KEY"); if (!key) return json({ error: "not configured" });
  const from = Deno.env.get("MAIL_FROM") || "Flagstick <statements@flagstickhub.com>";
  const to = Deno.env.get("DEMO_TO") || "info@flagstickhub.com";
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
  const rows = [["Name", name], ["Role", role], ["Club or organization", club], ["E-mail", email], ["Received", when + " (Central)"]];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") + (message ? `\n\nMessage:\n${message}` : "") + "\n\nSent from the Book a demo form on flagstickhub.com.";
  const html = `<div style="font-family:'Public Sans',Arial,sans-serif;color:#0F2A38;max-width:560px"><h2 style="font-weight:700;margin:0 0 12px">Demo request — ${esc(club)}</h2>
<table style="border-collapse:collapse;font-size:15px">${rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#56626A">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("")}</table>
${message ? `<p style="white-space:pre-wrap;margin-top:14px">${esc(message)}</p>` : ""}<p style="font-size:12px;color:#8FA0AA;margin-top:18px">Sent from the Book a demo form on flagstickhub.com. Reply to this e-mail to answer ${esc(name)}.</p></div>`;
  const send = (payload: Record<string, unknown>) => fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const r = await send({ from, to: [to], reply_to: email, subject: `Flagstick demo — ${club}`, text, html });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: String(out?.message || out?.error || `Resend answered HTTP ${r.status}`) });
  // the acknowledgement; a failure here is not the visitor's problem
  await send({ from, to: [email], subject: "Your Flagstick demo request", text: `Hi ${name},\n\nThanks for asking about Flagstick. We have your request for ${club} and will be in touch the same day to set up a time.\n\nFlagstick\ninfo@flagstickhub.com`,
    html: `<div style="font-family:'Public Sans',Arial,sans-serif;color:#0F2A38;max-width:560px"><p>Hi ${esc(name)},</p><p>Thanks for asking about Flagstick. We have your request for <b>${esc(club)}</b> and will be in touch the same day to set up a time.</p><p>Flagstick<br><a href="mailto:info@flagstickhub.com" style="color:#7E5F1A">info@flagstickhub.com</a></p></div>` }).catch(() => null);
  return json({ ok: true, id: out?.id });
});
