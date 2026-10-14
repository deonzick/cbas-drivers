import "server-only";
import { estMinutes, miles, orderStops, type LatLng } from "./geo";

export type StopIn = LatLng & { id: string; name: string; sections: number };
export type PlanRequest = {
  origin: LatLng & { label?: string; address?: string };
  destination?: (LatLng & { label?: string; address?: string }) | null;
  stops: StopIn[];
  minutesPerSection: number;
  minutesPerStop: number;
  budgetMinutes?: number | null;
  departAt?: string | null;
};
export type PlannedStop = StopIn & { driveMin: number; driveMiles: number; arriveAt: string; leaveAt: string; workMin: number };
export type PlanResult = {
  createdAt: string; source: "google" | "estimate";
  origin: PlanRequest["origin"]; destination: PlanRequest["destination"];
  stops: PlannedStop[]; skipped: string[];
  finalLeg: { driveMin: number; driveMiles: number } | null;
  totals: { driveMin: number; workMin: number; miles: number; finishAt: string };
  polylines: string[];
  minutesPerSection: number; minutesPerStop: number; budgetMinutes: number | null;
  note?: string;
};

const MAX_INTERMEDIATES = 25;

async function computeRoutes(key: string, origin: LatLng, destination: LatLng, inter: LatLng[], optimize: boolean) {
  const wp = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.legs.duration,routes.legs.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: wp(origin), destination: wp(destination), intermediates: inter.map(wp),
      travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", optimizeWaypointOrder: optimize && inter.length > 1,
    }),
  });
  const json: any = await res.json();
  if (!res.ok || !json.routes?.length) throw new Error(json.error?.message || "Google couldn't build that route.");
  const r = json.routes[0];
  return {
    order: (r.optimizedIntermediateWaypointIndex as number[] | undefined) ?? inter.map((_, i) => i),
    legs: ((r.legs || []) as any[]).map((l: any): { sec: number; meters: number } => ({ sec: parseInt(String(l.duration || "0").replace("s", ""), 10) || 0, meters: l.distanceMeters || 0 })),
    polyline: r.polyline?.encodedPolyline as string | undefined,
  };
}

export async function planRoute(req: PlanRequest): Promise<PlanResult> {
  const mps = Math.max(0, req.minutesPerSection), mpStop = Math.max(0, req.minutesPerStop);
  const work = (s: StopIn) => mpStop + s.sections * mps;
  const start = req.origin, end = req.destination || null;

  // 1. Choose which stops fit the time available (rough estimate), nearest first.
  let chosen = [...req.stops];
  const skipped: string[] = [];
  if (req.budgetMinutes && req.budgetMinutes > 0) {
    const pool = [...req.stops]; chosen = []; let cur: LatLng = start; let used = 0;
    while (pool.length) {
      let bi = 0, bd = Infinity;
      pool.forEach((s, i) => { const d = miles(cur, s); if (d < bd) { bd = d; bi = i; } });
      const s = pool[bi];
      const back = end ? estMinutes(s, end) : 0;
      const add = estMinutes(cur, s) + work(s);
      if (chosen.length && used + add + back > req.budgetMinutes) break;
      chosen.push(s); used += add; cur = s; pool.splice(bi, 1);
    }
    skipped.push(...pool.map(p => p.id));
  }

  // 2. Order them (local heuristic), then let Google optimise with live traffic when available.
  let ordered = orderStops(start, chosen, end);
  let legs: { min: number; mi: number }[] = [];
  const polylines: string[] = [];
  let source: PlanResult["source"] = "estimate";
  let note: string | undefined;
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;

  if (key && ordered.length) {
    try {
      if (ordered.length <= MAX_INTERMEDIATES + (end ? 0 : 1)) {
        const dest: LatLng = end || ordered[ordered.length - 1];
        const inter = end ? ordered : ordered.slice(0, -1);
        const r = await computeRoutes(key, start, dest, inter, true);
        const reordered = r.order.map(i => inter[i]);
        ordered = end ? reordered : [...reordered, ordered[ordered.length - 1]];
        legs = r.legs.map(l => ({ min: l.sec / 60, mi: l.meters / 1609.34 }));
        if (r.polyline) polylines.push(r.polyline);
      } else {
        // Long day: keep our order and ask Google for times in chunks.
        const pts: LatLng[] = [start, ...ordered, ...(end ? [end] : [])];
        for (let i = 0; i < pts.length - 1; i += MAX_INTERMEDIATES + 1) {
          const seg = pts.slice(i, Math.min(pts.length, i + MAX_INTERMEDIATES + 2));
          const r = await computeRoutes(key, seg[0], seg[seg.length - 1], seg.slice(1, -1), false);
          legs.push(...r.legs.map(l => ({ min: l.sec / 60, mi: l.meters / 1609.34 })));
          if (r.polyline) polylines.push(r.polyline);
        }
        note = "Over 25 stops, so the order comes from the app's own optimizer; drive times are from Google.";
      }
      source = "google";
    } catch (e: any) {
      note = `Google routing unavailable (${e.message}). Times are estimates.`;
      legs = [];
    }
  }
  if (!legs.length) {
    const pts: LatLng[] = [start, ...ordered, ...(end ? [end] : [])];
    for (let i = 1; i < pts.length; i++) legs.push({ min: estMinutes(pts[i - 1], pts[i]), mi: miles(pts[i - 1], pts[i]) * 1.35 });
    if (!key) note = "Drive times are estimates. Add a Google Maps key for live traffic times.";
  }

  // 3. Build the timeline.
  let t = req.departAt ? new Date(req.departAt) : new Date();
  const createdAt = new Date().toISOString();
  let driveMin = 0, workMin = 0, totalMi = 0;
  const stops: PlannedStop[] = ordered.map((s, i) => {
    const leg = legs[i] || { min: 0, mi: 0 };
    t = new Date(t.getTime() + leg.min * 60000);
    const arriveAt = t.toISOString();
    const w = work(s);
    t = new Date(t.getTime() + w * 60000);
    driveMin += leg.min; workMin += w; totalMi += leg.mi;
    return { ...s, driveMin: leg.min, driveMiles: leg.mi, arriveAt, leaveAt: t.toISOString(), workMin: w };
  });
  let finalLeg: PlanResult["finalLeg"] = null;
  if (end && legs[ordered.length]) {
    const l = legs[ordered.length];
    finalLeg = { driveMin: l.min, driveMiles: l.mi };
    t = new Date(t.getTime() + l.min * 60000); driveMin += l.min; totalMi += l.mi;
  }
  return {
    createdAt, source, origin: start, destination: end, stops, skipped, finalLeg,
    totals: { driveMin, workMin, miles: totalMi, finishAt: t.toISOString() },
    polylines, minutesPerSection: mps, minutesPerStop: mpStop, budgetMinutes: req.budgetMinutes ?? null, note,
  };
}
