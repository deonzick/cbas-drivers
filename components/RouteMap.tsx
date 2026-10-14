"use client";
import { useEffect, useRef, useState } from "react";
import { hasPin, type LatLng } from "@/lib/geo";

type Pt = LatLng & { id?: string; name?: string };
type Props = { origin?: Pt | null; destination?: Pt | null; stops: Pt[]; others?: Pt[]; polylines?: string[] };

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
let loader: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (typeof window === "undefined" || !KEY) return Promise.reject(new Error("no key"));
  if ((window as any).google?.maps?.importLibrary) return Promise.resolve();
  if (!loader) loader = new Promise((resolve, reject) => {
    (window as any).__cbasMapsReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&v=weekly&loading=async&callback=__cbasMapsReady`;
    s.async = true; s.onerror = () => reject(new Error("Maps failed to load"));
    document.head.appendChild(s);
  });
  return loader;
}

export default function RouteMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(!KEY);

  useEffect(() => {
    if (!KEY || !el.current) return;
    let cancelled = false;
    const cleanup: (() => void)[] = [];
    (async () => {
      try {
        await loadMaps();
        const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
        const { AdvancedMarkerElement, PinElement } = (await google.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
        const { encoding } = (await google.maps.importLibrary("geometry")) as google.maps.GeometryLibrary;
        if (cancelled || !el.current) return;
        const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        const map = new Map(el.current, {
          mapId: MAP_ID, disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy",
          colorScheme: dark ? "DARK" : "LIGHT",
        } as google.maps.MapOptions);
        const bounds = new google.maps.LatLngBounds();
        const add = (p: Pt, pin: google.maps.marker.PinElement, title?: string, z = 1) => {
          const m = new AdvancedMarkerElement({ map, position: p, content: pin.element, title, zIndex: z });
          bounds.extend(p); cleanup.push(() => (m.map = null));
        };
        (props.others || []).filter(hasPin).forEach(p => add(p, new PinElement({ background: "#9aa59e", borderColor: "#6f7a72", glyphColor: "#fff", scale: 0.7 }), p.name, 1));
        props.stops.filter(hasPin).forEach((p, i) => add(p, new PinElement({ background: "#b8740a", borderColor: "#7a4d06", glyphColor: "#fff", glyph: String(i + 1) }), p.name, 10 + i));
        if (props.origin && hasPin(props.origin)) add(props.origin, new PinElement({ background: "#0a6b4c", borderColor: "#064532", glyphColor: "#fff", glyph: "S" }), "Start", 100);
        if (props.destination && hasPin(props.destination)) add(props.destination, new PinElement({ background: "#1c211d", borderColor: "#000", glyphColor: "#fff", glyph: "E" }), "End", 99);
        for (const enc of props.polylines || []) {
          const line = new google.maps.Polyline({ map, path: encoding.decodePath(enc), strokeColor: "#b8740a", strokeWeight: 5, strokeOpacity: 0.9 });
          cleanup.push(() => line.setMap(null));
        }
        if (!bounds.isEmpty()) map.fitBounds(bounds, 40);
        else map.setOptions({ center: { lat: 29.76, lng: -95.37 }, zoom: 9 });
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; cleanup.forEach(f => f()); };
  }, [props.origin, props.destination, props.stops, props.others, props.polylines]);

  if (failed) return <div className="map"><Sketch {...props} /></div>;
  return <div className="map" ref={el} role="region" aria-label="Route map" />;
}

/** Schematic fallback when no Maps key is set: relative positions, not road geometry. */
function Sketch({ origin, destination, stops, others = [] }: Props) {
  const W = 600, H = 450, P = 30;
  const all = [...stops, ...others, ...(origin ? [origin] : []), ...(destination ? [destination] : [])].filter(hasPin);
  if (!all.length) return <svg viewBox={`0 0 ${W} ${H}`}><text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--muted)" fontSize="15">Your route will appear here</text></svg>;
  const lats = all.map(p => p.lat), lngs = all.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const sx = (maxLng - minLng) * k || 0.01, sy = maxLat - minLat || 0.01;
  const sc = Math.min((W - 2 * P) / sx, (H - 2 * P) / sy), ox = (W - sx * sc) / 2, oy = (H - sy * sc) / 2;
  const X = (p: LatLng) => ox + (p.lng - minLng) * k * sc, Y = (p: LatLng) => H - (oy + (p.lat - minLat) * sc);
  const path = [origin, ...stops, destination].filter(hasPin) as LatLng[];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Route sketch">
      {[1, 2, 3].map(i => <g key={i}><line x1={0} x2={W} y1={(H * i) / 4} y2={(H * i) / 4} stroke="var(--line)" /><line y1={0} y2={H} x1={(W * i) / 4} x2={(W * i) / 4} stroke="var(--line)" /></g>)}
      {path.length > 1 && <polyline points={path.map(p => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(" ")} fill="none" stroke="var(--amber)" strokeWidth="3" strokeDasharray="7 6" strokeLinejoin="round" />}
      {others.filter(hasPin).map((p, i) => <circle key={`o${i}`} cx={X(p)} cy={Y(p)} r={5} fill="var(--done)" opacity=".6" />)}
      {stops.filter(hasPin).map((p, i) => (
        <g key={i}><circle cx={X(p)} cy={Y(p)} r={12} fill="var(--amber)" /><text x={X(p)} y={Y(p) + 5} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="700" fontFamily="var(--f-display)">{i + 1}</text></g>
      ))}
      {origin && hasPin(origin) && <g><rect x={X(origin) - 11} y={Y(origin) - 11} width={22} height={22} rx={5} fill="var(--sign)" /><text x={X(origin)} y={Y(origin) + 5} textAnchor="middle" fill="var(--sign-ink)" fontSize="13" fontWeight="700">S</text></g>}
      {destination && hasPin(destination) && <g><rect x={X(destination) - 11} y={Y(destination) - 11} width={22} height={22} rx={5} fill="var(--fg)" /><text x={X(destination)} y={Y(destination) + 5} textAnchor="middle" fill="var(--bg)" fontSize="13" fontWeight="700">E</text></g>}
      <text x={W - 10} y={20} textAnchor="end" fontSize="12" fill="var(--muted)">N ↑ · sketch, not to road scale</text>
    </svg>
  );
}
