import { handle, HttpError, requireUser } from "@/lib/server";
import { planRoute, type StopIn } from "@/lib/route";
import { hasPin } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Builds a route for the signed-in driver from their own open subdivisions. */
export const POST = handle(async (req) => {
  const { db, profile } = await requireUser(req);
  const body = await req.json();
  if (!hasPin(body.origin)) throw new HttpError(400, "Choose where you're starting from.");

  const { data: q } = await db.from("quarters").select("id").eq("is_active", true).maybeSingle();
  if (!q) throw new HttpError(400, "No active quarter yet.");
  const driverId = profile.role === "admin" && body.driverId ? body.driverId : profile.id;

  const { data: subs, error } = await db.from("subdivisions")
    .select("id,name,lat,lng,sections(id,completed_at)")
    .eq("quarter_id", q.id).eq("driver_id", driverId);
  if (error) throw error;

  // Routes are planned one day at a time: the driver picks today's subdivisions.
  const wanted: string[] = Array.isArray(body.subdivisionIds) ? body.subdivisionIds : [];
  if (!wanted.length) throw new HttpError(400, "Pick at least one subdivision for today.");
  const stops: StopIn[] = (subs || [])
    .filter((s: any) => hasPin(s) && wanted.includes(s.id))
    .map((s: any) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, open: (s.sections || []).filter((x: any) => !x.completed_at).length, total: (s.sections || []).length }))
    .filter((s: any) => s.open > 0 || s.total === 0)
    .map((s: any) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, sections: s.open }));
  if (!stops.length) throw new HttpError(400, "Every subdivision you picked is already complete, or has no map pin yet.");

  const { data: settings } = await db.from("app_settings").select("*").eq("id", 1).maybeSingle();
  const plan = await planRoute({
    origin: body.origin, destination: hasPin(body.destination) ? body.destination : null, stops,
    minutesPerSection: Number(settings?.minutes_per_section ?? 5),
    minutesPerStop: Number(settings?.minutes_per_stop ?? 3),
    budgetMinutes: null,
    departAt: body.departAt || null,
  });
  if (driverId === profile.id) {
    await db.from("route_plans").upsert({ driver_id: profile.id, quarter_id: q.id, plan, updated_at: new Date().toISOString() });
  }
  return Response.json({ plan });
});
