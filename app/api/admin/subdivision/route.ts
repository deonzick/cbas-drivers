import { handle, HttpError, requireAdmin } from "@/lib/server";
import { normalizeRows } from "@/lib/parse/normalize";
import { sectionKey, subdivisionKey } from "@/lib/format";
import { fetchAll } from "@/lib/fetchAll";
import { isDriver } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Add one subdivision to a driver mid-drive (the rare one-or-two additions), move one to
 *  another driver, or remove one. */
export const POST = handle(async (req) => {
  const { db } = await requireAdmin(req);
  const b = await req.json();

  if (b.action === "reassign") {
    const { data: sub } = await db.from("subdivisions").select("id,name,quarter_id,quarters(is_active)").eq("id", b.id).maybeSingle();
    if (!sub) throw new HttpError(404, "Subdivision not found.");
    if (!(sub as any).quarters?.is_active) throw new HttpError(400, "That quarter is closed and read-only.");
    const { data: to } = await db.from("profiles").select("id,role,active,drives").eq("id", b.toDriverId).maybeSingle();
    if (!to || !isDriver(to) || !to.active) throw new HttpError(400, "Pick an active driver to move it to.");
    const { data: last } = await db.from("subdivisions").select("sort").eq("quarter_id", sub.quarter_id).eq("driver_id", to.id)
      .order("sort", { ascending: false }).limit(1).maybeSingle();
    // Sections, check-offs and the scanned mark move with it. It no longer belongs to the
    // original driver's uploaded sheet, so replacing that sheet later won't remove it.
    const { error } = await db.from("subdivisions").update({ driver_id: to.id, upload_id: null, sort: (last?.sort ?? -1) + 1 }).eq("id", sub.id);
    if (error) throw error;
    return Response.json({ ok: true });
  }

  if (b.action === "delete") {
    const { error } = await db.from("subdivisions").delete().eq("id", b.id);
    if (error) throw error;
    return Response.json({ ok: true });
  }

  if (!b.driverId || !b.quarterId) throw new HttpError(400, "Missing driver or quarter.");
  const { rows } = normalizeRows([{
    subdivision: b.name, county: b.county, city: b.city, market: b.market, submarket: b.submarket,
    new: b.newSections, active: b.activeSections, btr: b.btrSections, lat: String(b.lat ?? ""), lng: String(b.lng ?? ""),
  }]);
  const r = rows[0];
  if (!r) throw new HttpError(400, "Enter the subdivision name.");
  if (!r.sections.length) throw new HttpError(400, "List at least one section.");
  if (r.lat === null || r.lng === null) throw new HttpError(400, "Enter the latitude and longitude.");

  // Subdivisions are never split between drivers: refuse if someone already has it this quarter.
  const dupes = await fetchAll<{ name: string; driver_id: string }>((f, t) => db.from("subdivisions").select("name,driver_id").eq("quarter_id", b.quarterId).range(f, t));
  const clash = (dupes || []).find(d => subdivisionKey(d.name) === subdivisionKey(r.name));
  if (clash) {
    const { data: who } = await db.from("profiles").select("full_name").eq("id", clash.driver_id).maybeSingle();
    throw new HttpError(400, `${r.name} is already assigned${clash.driver_id === b.driverId ? " to this driver" : ` to ${who?.full_name || "another driver"}`} this quarter.`);
  }

  const { data: last } = await db.from("subdivisions").select("sort").eq("quarter_id", b.quarterId).eq("driver_id", b.driverId)
    .order("sort", { ascending: false }).limit(1).maybeSingle();
  const { data: sub, error } = await db.from("subdivisions").insert({
    quarter_id: b.quarterId, driver_id: b.driverId, county: r.county, city: r.city, market: r.market, submarket: r.submarket,
    name: r.name, lat: r.lat, lng: r.lng, sort: (last?.sort ?? -1) + 1,
  }).select("id").single();
  if (error) throw error;

  const { data: pins } = await db.from("section_pins").select("*").eq("subdivision_key", subdivisionKey(r.name));
  const pinOf = new Map((pins || []).map(p => [p.section_key, p]));
  const { error: se } = await db.from("sections").insert(r.sections.map((s, j) => {
    const pin = pinOf.get(sectionKey(s.label));
    return { subdivision_id: sub.id, label: s.label, kinds: s.kinds, sort: j, lat: pin?.lat ?? null, lng: pin?.lng ?? null };
  }));
  if (se) { await db.from("subdivisions").delete().eq("id", sub.id); throw se; }
  return Response.json({ ok: true, id: sub.id, sections: r.sections.length });
});
