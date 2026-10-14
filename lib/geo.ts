export type LatLng = { lat: number; lng: number };

export function hasPin<T>(p: T): p is T & LatLng {
  const q = p as any;
  return !!q && Number.isFinite(q.lat) && Number.isFinite(q.lng);
}

export function miles(a: LatLng, b: LatLng) {
  const R = 3958.8, r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough drive time when Google isn't available: road distance ≈ 1.35× straight line at 35 mph. */
export const estMinutes = (a: LatLng, b: LatLng) => (miles(a, b) * 1.35 / 35) * 60;

/** Order stops: nearest-neighbour from the start, then 2-opt clean-up. End point optional. */
export function orderStops<T extends LatLng>(start: LatLng, stops: T[], end?: LatLng | null): T[] {
  const rest = [...stops], out: T[] = [];
  let cur: LatLng = start;
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((s, i) => { const d = miles(cur, s); if (d < bd) { bd = d; bi = i; } });
    cur = rest.splice(bi, 1)[0]; out.push(cur as T);
  }
  const pts = (arr: T[]) => [start as LatLng, ...arr, ...(end ? [end] : [])];
  const len = (arr: T[]) => { const p = pts(arr); let s = 0; for (let i = 1; i < p.length; i++) s += miles(p[i - 1], p[i]); return s; };
  let improved = true, guard = 0, bestLen = len(out);
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < out.length - 1; i++) for (let k = i + 1; k < out.length; k++) {
      const cand = [...out.slice(0, i), ...out.slice(i, k + 1).reverse(), ...out.slice(k + 1)];
      const l = len(cand);
      if (l < bestLen - 1e-9) { out.splice(0, out.length, ...cand); bestLen = l; improved = true; }
    }
  }
  return out;
}

/** Google Maps directions link. Phones accept up to 3 waypoints in a link, so callers pass short legs. */
export function mapsLink(dest: LatLng, waypoints: LatLng[] = [], origin?: LatLng | null) {
  const f = (p: LatLng) => `${p.lat},${p.lng}`;
  let u = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(f(dest))}`;
  if (origin) u += `&origin=${encodeURIComponent(f(origin))}`;
  if (waypoints.length) u += `&waypoints=${encodeURIComponent(waypoints.map(f).join("|"))}`;
  return u;
}

export function fmtMin(m: number) {
  const t = Math.round(m);
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60), r = t % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}
export function fmtTime(iso: string | Date) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
