import { handle, HttpError, requireAdmin } from "@/lib/server";
import type { ParsedSubdivision } from "@/lib/parse/normalize";
import { sectionKey, subdivisionKey } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Saves a previewed assignment file to one driver for the active quarter.
 *  mode "replace" swaps out that driver's current list (keeping check-offs on sections that carry over);
 *  mode "add" appends to it. */
export const POST = handle(async (req) => {
  const { db, profile } = await requireAdmin(req);
  const form = await req.formData();
  const file = form.get("file");
  const payload = JSON.parse(String(form.get("payload") || "{}"));
  const { driverId, quarterId, mode = "replace" } = payload as { driverId: string; quarterId: string; mode: "replace" | "add" };
  const rows = (payload.rows || []) as ParsedSubdivision[];
  if (!driverId || !quarterId) throw new HttpError(400, "Pick a driver and quarter.");
  if (!rows.length) throw new HttpError(400, "There are no rows to import.");

  const { data: quarter } = await db.from("quarters").select("id,label").eq("id", quarterId).single();
  if (!quarter) throw new HttpError(404, "Quarter not found.");
  const { data: driver } = await db.from("profiles").select("id,full_name").eq("id", driverId).single();
  if (!driver) throw new HttpError(404, "Driver not found.");

  // Remember existing check-offs so a corrected re-upload doesn't wipe a driver's progress.
  const keep = new Map<string, { at: string; by: string | null }>();
  const keepScan = new Map<string, { at: string; by: string | null }>();
  const { data: existing } = await db.from("subdivisions")
    .select("id,name,scanned_at,scanned_by,sections(label,completed_at,completed_by)").eq("quarter_id", quarterId).eq("driver_id", driverId);
  for (const s of existing || []) {
    for (const x of (s as any).sections || [])
      if (x.completed_at) keep.set(`${s.name.toLowerCase()}|${x.label.toUpperCase()}`, { at: x.completed_at, by: x.completed_by });
    if ((s as any).scanned_at) keepScan.set(s.name.toLowerCase(), { at: (s as any).scanned_at, by: (s as any).scanned_by });
  }

  if (mode === "replace") {
    const { data: oldUploads } = await db.from("uploads").select("id,storage_path").eq("quarter_id", quarterId).eq("driver_id", driverId);
    const paths = (oldUploads || []).map(u => u.storage_path).filter(Boolean) as string[];
    if (paths.length) await db.storage.from("assignment-files").remove(paths);
    await db.from("subdivisions").delete().eq("quarter_id", quarterId).eq("driver_id", driverId);
    await db.from("uploads").delete().eq("quarter_id", quarterId).eq("driver_id", driverId);
  }

  let storagePath: string | null = null;
  if (file instanceof File) {
    const safe = (file.name || "assignments").replace(/[^\w.\-]+/g, "_");
    storagePath = `${quarter.label}/${driverId}/${Date.now()}-${safe}`;
    const up = await db.storage.from("assignment-files").upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream", upsert: true,
    });
    if (up.error) storagePath = null; // keep going; the data matters more than the copy of the file
  }

  const sectionCount = rows.reduce((n, r) => n + Math.max(1, r.sections.length), 0);
  const { data: upload, error: upErr } = await db.from("uploads").insert({
    quarter_id: quarterId, driver_id: driverId, file_name: (file as File)?.name || "import",
    storage_path: storagePath, subdivision_count: rows.length, section_count: sectionCount, uploaded_by: profile.id,
  }).select("id").single();
  if (upErr) throw upErr;

  // A subdivision stays "scanned" only if every one of its sections carries over as complete.
  const stillScanned = (r: ParsedSubdivision) => {
    const k = keepScan.get(r.name.toLowerCase());
    const list = r.sections.length ? r.sections : [{ label: "ALL" }];
    return k && list.every(sec => keep.has(`${r.name.toLowerCase()}|${sec.label.toUpperCase()}`)) ? k : null;
  };
  const { data: subs, error: subErr } = await db.from("subdivisions").insert(rows.map((r, i) => {
    const sc = mode === "replace" ? stillScanned(r) : null;
    return {
      quarter_id: quarterId, driver_id: driverId, upload_id: upload.id,
      county: r.county, city: r.city, market: r.market, submarket: r.submarket,
      name: r.name, lat: r.lat, lng: r.lng, sort: i + (mode === "add" ? 1000 : 0),
      scanned_at: sc?.at ?? null, scanned_by: sc?.by ?? null,
    };
  })).select("id,sort");
  if (subErr) throw subErr;

  // Section coordinates saved earlier (optional feature) are applied automatically.
  const pinMap = new Map<string, { lat: number; lng: number }>();
  const subKeys = [...new Set(rows.map(r => subdivisionKey(r.name)))];
  for (let i = 0; i < subKeys.length; i += 200) {
    const { data: pins } = await db.from("section_pins").select("*").in("subdivision_key", subKeys.slice(i, i + 200));
    for (const p of pins || []) pinMap.set(`${p.subdivision_key}|${p.section_key}`, { lat: p.lat, lng: p.lng });
  }

  const idBySort = new Map(subs!.map(s => [s.sort - (mode === "add" ? 1000 : 0), s.id]));
  const sectionRows: any[] = [];
  rows.forEach((r, i) => {
    const list = r.sections.length ? r.sections : [{ label: "ALL", kinds: ["active"] }];
    list.forEach((sec, j) => {
      const k = keep.get(`${r.name.toLowerCase()}|${sec.label.toUpperCase()}`);
      const pin = pinMap.get(`${subdivisionKey(r.name)}|${sectionKey(sec.label)}`);
      sectionRows.push({
        subdivision_id: idBySort.get(i), label: sec.label, kinds: sec.kinds, sort: j,
        lat: pin?.lat ?? null, lng: pin?.lng ?? null,
        completed_at: k?.at ?? null, completed_by: k?.by ?? null,
      });
    });
  });
  for (let i = 0; i < sectionRows.length; i += 500) {
    const { error } = await db.from("sections").insert(sectionRows.slice(i, i + 500));
    if (error) throw error;
  }
  return Response.json({ ok: true, subdivisions: rows.length, sections: sectionRows.length, kept: keep.size });
});
