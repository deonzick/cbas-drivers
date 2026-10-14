import { handle, HttpError, requireAdmin } from "@/lib/server";
import { sectionLabel } from "@/lib/format";
import { fetchAll } from "@/lib/fetchAll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** CSV of every section in a quarter (active or archived): driven or not, who checked it off
 *  and when, and when the subdivision was scanned to TurboScan. */
export const GET = handle(async (req) => {
  const { db } = await requireAdmin(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "Missing quarter.");
  const { data: q } = await db.from("quarters").select("label").eq("id", id).single();
  const { data: people } = await db.from("profiles").select("id,full_name");
  const nameOf = new Map((people || []).map(p => [p.id, p.full_name]));
  const subs = await fetchAll<any>((f, t) => db.from("subdivisions")
    .select("id,driver_id,county,city,market,submarket,name,lat,lng,scanned_at,sections(label,kinds,completed_at,completed_by)")
    .eq("quarter_id", id).order("driver_id").order("sort").order("id").range(f, t));
  const ct = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago" });
  const lines = [["Quarter", "Driver", "County", "City", "CBAS_Mkt", "CBAS_SubMkt", "Subdivision", "Subdivision status", "Section", "Type", "Latitude", "Longitude", "Section driven", "Driven at", "Checked off by", "Scanned to TurboScan at"].join(",")];
  for (const s of subs) {
    const secs = s.sections || [];
    const driven = secs.length > 0 && secs.every((x: any) => x.completed_at);
    const status = driven ? (s.scanned_at ? "Complete" : "Driven, not scanned") : "Not driven";
    for (const x of secs) lines.push([q?.label, nameOf.get(s.driver_id), s.county, s.city, s.market, s.submarket, s.name, status, sectionLabel(x.label),
      (x.kinds || []).join("/").toUpperCase(), s.lat, s.lng, x.completed_at ? "Yes" : "No",
      x.completed_at ? ct(x.completed_at) : "",
      x.completed_by ? nameOf.get(x.completed_by) : "",
      s.scanned_at ? ct(s.scanned_at) : ""].map(csvCell).join(","));
  }
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${q?.label || "quarter"}-drive-completion.csv"` },
  });
});

export const POST = handle(async (req) => {
  const { db } = await requireAdmin(req);
  const b = await req.json();
  switch (b.action) {
    case "start": {
      const label = String(b.label || "").trim().toUpperCase();
      if (!/^[1-4]Q\d{2}$/.test(label)) throw new HttpError(400, "Use a label like 1Q27.");
      const { data: existing } = await db.from("quarters").select("closed_at").eq("label", label).maybeSingle();
      if (existing?.closed_at) throw new HttpError(400, `${label} is already closed and in the archive.`);
      const { data: preset } = await db.from("quarter_presets").select("*").eq("label", label).maybeSingle();
      b.startDate = b.startDate || preset?.start_date || null;
      b.dueDate = b.dueDate || preset?.due_date || null;
      await db.from("quarters").update({ is_active: false }).eq("is_active", true);
      const { data, error } = await db.from("quarters").upsert({
        label, is_active: true, closed_at: null, start_date: b.startDate || null, due_date: b.dueDate || null,
      }, { onConflict: "label" }).select().single();
      if (error) throw error;
      return Response.json({ quarter: data });
    }
    case "close": {
      // End of quarter: lock it as a read-only archive. Nothing is deleted.
      const { data: q } = await db.from("quarters").select("*").eq("id", b.id).single();
      if (!q) throw new HttpError(404, "Quarter not found.");
      if (String(b.confirm || "").trim().toUpperCase() !== q.label) throw new HttpError(400, `Type ${q.label} to confirm.`);
      const subs = await fetchAll<any>((f, t) => db.from("subdivisions").select("id,driver_id,scanned_at,sections(completed_at)").eq("quarter_id", q.id).order("id").range(f, t));
      const per: Record<string, { subdivisions: number; driven: number; scanned: number; sections: number; done: number }> = {};
      for (const s of subs) {
        const p = (per[s.driver_id] ||= { subdivisions: 0, driven: 0, scanned: 0, sections: 0, done: 0 });
        const secs = s.sections || []; const done = secs.filter((x: any) => x.completed_at).length;
        p.subdivisions++; p.sections += secs.length; p.done += done;
        if (secs.length && done === secs.length) { p.driven++; if (s.scanned_at) p.scanned++; }
      }
      await db.from("route_plans").delete().eq("quarter_id", q.id);
      await db.from("quarters").update({ is_active: false, closed_at: new Date().toISOString(), summary: per }).eq("id", q.id);
      return Response.json({ ok: true });
    }
    case "purge": {
      // Optional clean-up: delete an archived quarter's detail for good. Its summary stays.
      const { data: q } = await db.from("quarters").select("*").eq("id", b.id).single();
      if (!q) throw new HttpError(404, "Quarter not found.");
      if (q.is_active) throw new HttpError(400, "Close the quarter before deleting its detail.");
      if (String(b.confirm || "").trim().toUpperCase() !== q.label) throw new HttpError(400, `Type ${q.label} to confirm.`);
      const ups = await fetchAll<any>((f, t) => db.from("uploads").select("storage_path").eq("quarter_id", q.id).range(f, t));
      const paths = ups.map(u => u.storage_path).filter(Boolean) as string[];
      for (let i = 0; i < paths.length; i += 100) await db.storage.from("assignment-files").remove(paths.slice(i, i + 100));
      await db.from("subdivisions").delete().eq("quarter_id", q.id);
      await db.from("uploads").delete().eq("quarter_id", q.id);
      await db.from("driver_deadlines").delete().eq("quarter_id", q.id);
      await db.from("quarters").update({ purged_at: new Date().toISOString() }).eq("id", q.id);
      return Response.json({ ok: true });
    }
    case "presets": {
      // Quarter calendar: [{label:"1Q27", startDate, dueDate}, ...]
      const rows = (b.rows || []).filter((r: any) => /^[1-4]Q\d{2}$/.test(r.label)).map((r: any) => ({
        label: r.label, start_date: r.startDate || null, due_date: r.dueDate || null,
      }));
      if (!rows.length) throw new HttpError(400, "Nothing to save.");
      const { error } = await db.from("quarter_presets").upsert(rows);
      if (error) throw error;
      return Response.json({ ok: true });
    }
    case "dates": {
      const { error } = await db.from("quarters").update({ start_date: b.startDate || null, due_date: b.dueDate || null }).eq("id", b.id);
      if (error) throw error;
      return Response.json({ ok: true });
    }
    case "driver-due": {
      if (!b.quarterId || !b.driverId) throw new HttpError(400, "Missing driver or quarter.");
      const q = db.from("driver_deadlines");
      const { error } = b.dueDate
        ? await q.upsert({ quarter_id: b.quarterId, driver_id: b.driverId, due_date: b.dueDate })
        : await q.delete().eq("quarter_id", b.quarterId).eq("driver_id", b.driverId);
      if (error) throw error;
      return Response.json({ ok: true });
    }
    case "delete-upload": {
      const { data: u } = await db.from("uploads").select("*").eq("id", b.id).single();
      if (!u) throw new HttpError(404, "Upload not found.");
      if (u.storage_path) await db.storage.from("assignment-files").remove([u.storage_path]);
      await db.from("subdivisions").delete().eq("upload_id", u.id);
      await db.from("uploads").delete().eq("id", u.id);
      return Response.json({ ok: true });
    }
    case "file-link": {
      const { data: u } = await db.from("uploads").select("storage_path").eq("id", b.id).single();
      if (!u?.storage_path) throw new HttpError(404, "The original file wasn't kept for this upload.");
      const { data, error } = await db.storage.from("assignment-files").createSignedUrl(u.storage_path, 600);
      if (error) throw error;
      return Response.json({ url: data.signedUrl });
    }
    case "settings": {
      const mps = Number(b.minutesPerSection), mpStop = Number(b.minutesPerStop);
      if (!(mps >= 0 && mps <= 60) || !(mpStop >= 0 && mpStop <= 60)) throw new HttpError(400, "Use minutes between 0 and 60.");
      const { error } = await db.from("app_settings").update({ minutes_per_section: mps, minutes_per_stop: mpStop }).eq("id", 1);
      if (error) throw error;
      return Response.json({ ok: true });
    }
  }
  throw new HttpError(400, "Unknown action.");
});
