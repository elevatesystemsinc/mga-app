// Flagstick — bulk loader for the shared course library (the `courses` table, tenant null). Deploy as `courses-import`.
//
// A one-off for the catalogue import (tools/courses/catalogue.py): it takes rows built by the importer and upserts them with
// the service role, which the importer cannot do from outside (the library is written by Flagstick admins only). It never
// touches a verified row or a club's own course (tenant set), so a card someone checked against the printed scorecard stays
// as it is. Guarded by IMPORT_KEY (an Edge Function secret) — without it the function refuses everything.
//
//   POST {rows:[{id,name,club,city,state,country,holes,data,geo,source,notes}]}  with header  x-import-key: <IMPORT_KEY>
//   → {upserted, skipped:{verified, owned}, errors}
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
type Row = { id: string; name: string; club?: string; city?: string; state?: string; country?: string; holes?: number; data: unknown; geo?: unknown; source?: string; notes?: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Deno.env.get("IMPORT_KEY") || "";
  if (!key || (req.headers.get("x-import-key") || "") !== key) return json({ error: "Not allowed" }, 403);
  try {
    const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
    const b = await req.json();
    const rows: Row[] = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: "No rows" }, 400);
    const ids = rows.map((r) => String(r.id || "")).filter(Boolean);
    const { data: have, error: e0 } = await admin.from("courses").select("id, tenant, verified").in("id", ids);
    if (e0) return json({ error: e0.message }, 500);
    const keep = new Map<string, { tenant: string | null; verified: boolean }>();
    for (const h of have || []) keep.set(h.id, { tenant: h.tenant, verified: !!h.verified });
    let verified = 0, owned = 0;
    const out = rows.filter((r) => {
      const h = keep.get(r.id);
      if (!h) return true;
      if (h.verified) { verified++; return false; }
      if (h.tenant) { owned++; return false; }
      return true;
    }).map((r) => ({
      id: r.id, tenant: null, name: r.name, club: r.club ?? null, city: r.city ?? null, state: r.state ?? null, country: r.country || "US",
      holes: r.holes || 18, data: r.data || {}, geo: r.geo ?? null, source: r.source || "golfcourseapi", verified: false, status: "live",
      notes: r.notes ?? null, updated_at: new Date().toISOString(), updated_by: "import",
    }));
    let upserted = 0; const errors: string[] = [];
    for (let i = 0; i < out.length; i += 200) {
      const chunk = out.slice(i, i + 200);
      const { error } = await admin.from("courses").upsert(chunk, { onConflict: "id" });
      if (error) errors.push(error.message); else upserted += chunk.length;
    }
    return json({ upserted, skipped: { verified, owned }, errors });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
});
