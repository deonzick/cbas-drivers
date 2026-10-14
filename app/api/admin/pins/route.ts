import { handle, HttpError, requireAdmin } from "@/lib/server";
import { sectionKey, subdivisionKey } from "@/lib/format";
import type { ParsedPin } from "@/lib/parse/normalize";
import { fetchAll } from "@/lib/fetchAll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Optional: save section coordinates. They're kept across quarters and applied to
 *  matching sections now and in every future import. */
export const POST = handle(async (req) => {
  const { db } = await requireAdmin(req);
  const body = await req.json();

  if (body.action === "clear") {
    await db.from("section_pins").delete().neq("subdivision_key", "");
    await db.from("sections").update({ lat: null, lng: null }).not("lat", "is", null);
    return Response.json({ ok: true });
  }

  const pins = (body.pins || []) as ParsedPin[];
  if (!pins.length) throw new HttpError(400, "No section coordinates to save.");
  const rows = pins.map(p => ({
    subdivision_key: subdivisionKey(p.subdivision), section_key: sectionKey(p.section),
    lat: p.lat, lng: p.lng, updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("section_pins").upsert(rows.slice(i, i + 500), { onConflict: "subdivision_key,section_key" });
    if (error) throw error;
  }

  // Apply to the active quarter right away.
  let applied = 0;
  const { data: q } = await db.from("quarters").select("id").eq("is_active", true).maybeSingle();
  if (q) {
    const want = new Map(rows.map(r => [`${r.subdivision_key}|${r.section_key}`, r]));
    const subs = await fetchAll<any>((f, t) => db.from("subdivisions").select("id,name,sections(id,label)").eq("quarter_id", q.id).order("id").range(f, t));
    for (const s of subs) for (const x of s.sections || []) {
      const pin = want.get(`${subdivisionKey(s.name)}|${sectionKey(x.label)}`);
      if (pin) { await db.from("sections").update({ lat: pin.lat, lng: pin.lng }).eq("id", x.id); applied++; }
    }
  }
  const { count } = await db.from("section_pins").select("*", { count: "exact", head: true });
  return Response.json({ ok: true, saved: rows.length, applied, total: count ?? rows.length });
});
