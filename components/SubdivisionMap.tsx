"use client";
// Street map of a driver's subdivisions, labeled by name, for planning the day.
// Map tiles: OpenFreeMap (free, no key, OpenStreetMap data). Tap a pin to add it to today.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, GeoJSONSource, Popup } from "maplibre-gl";
import { hasPin, mapsLink, type LatLng } from "@/lib/geo";

export type MapSub = LatLng & { id: string; name: string; state: "todrive" | "toscan" | "complete"; open: number; total: number };
type Pt = LatLng & { label?: string };
type Props = {
  subs: MapSub[];
  picked: Set<string>;              // today's selection
  order?: Map<string, number>;      // stop numbers once a route is built
  origin?: Pt | null;
  destination?: Pt | null;
  polylines?: string[];             // road geometry from Google (when its key is set)
  onToggle?: (id: string) => void;  // tap-to-pick; omit for read-only
};

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
const COLORS = { todrive: "#004572", toscan: "#c15527", complete: "#8a959c", picked: "#f37021" };
const HOUSTON: [number, number] = [-95.37, 29.76];

/** Google encoded polyline -> [lng, lat][] */
function decode(str: string): [number, number][] {
  const out: [number, number][] = []; let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

export default function SubdivisionMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const popup = useRef<Popup | null>(null);
  const markers = useRef<any[]>([]);
  const latest = useRef(props);
  const fitKey = useRef("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  latest.current = props;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ml = (await import("maplibre-gl")).default;
        if (cancelled || !el.current) return;
        const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        const m = new ml.Map({
          container: el.current, style: dark ? STYLE_DARK : STYLE_LIGHT, center: HOUSTON, zoom: 8.5,
          attributionControl: { compact: true }, cooperativeGestures: false,
        });
        m.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
        m.addControl(new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "top-right");
        let fellBack = false;
        m.on("error", (e: any) => {
          // If the dark style isn't available, fall back to the light one once.
          if (dark && !fellBack && /style/i.test(String(e?.error?.message || ""))) { fellBack = true; m.setStyle(STYLE_LIGHT); }
        });
        m.on("load", () => {
          // Use a font the basemap already provides for our labels.
          const fonts = (m.getStyle().layers || []).map((l: any) => l.layout?.["text-font"]).filter((f: any) => Array.isArray(f) && typeof f[0] === "string");
          const bold = fonts.find((f: string[]) => /bold/i.test(f[0]));
          const font = bold || fonts.find((f: string[]) => /regular/i.test(f[0])) || fonts[0] || ["Noto Sans Regular"];
          const empty = { type: "FeatureCollection", features: [] } as any;
          m.addSource("route", { type: "geojson", data: empty });
          m.addSource("subs", { type: "geojson", data: empty });
          m.addLayer({ id: "route-road", type: "line", source: "route", filter: ["==", ["get", "road"], true], layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": COLORS.picked, "line-width": 4, "line-opacity": 0.85 } });
          m.addLayer({ id: "route-est", type: "line", source: "route", filter: ["==", ["get", "road"], false], layout: { "line-join": "round" },
            paint: { "line-color": COLORS.picked, "line-width": 3, "line-opacity": 0.8, "line-dasharray": [2, 1.5] } });
          m.addLayer({ id: "subs-dot", type: "circle", source: "subs",
            paint: {
              "circle-radius": ["case", ["get", "picked"], 12, 7],
              "circle-color": ["case", ["get", "picked"], COLORS.picked, ["match", ["get", "state"], "toscan", COLORS.toscan, "complete", COLORS.complete, COLORS.todrive]],
              "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
              "circle-opacity": ["case", ["==", ["get", "state"], "complete"], 0.6, 1],
            } });
          m.addLayer({ id: "subs-num", type: "symbol", source: "subs", filter: ["!=", ["get", "num"], ""],
            layout: { "text-field": ["get", "num"], "text-font": font, "text-size": 12, "text-allow-overlap": true, "text-ignore-placement": true },
            paint: { "text-color": "#ffffff" } });
          m.addLayer({ id: "subs-label", type: "symbol", source: "subs",
            layout: {
              "text-field": ["get", "name"], "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 13, 13],
              "text-anchor": "top", "text-offset": [0, 1.1], "text-max-width": 9, "text-optional": true,
              "symbol-sort-key": ["case", ["get", "picked"], 0, ["==", ["get", "state"], "todrive"], 1, 2],
            },
            paint: { "text-color": dark ? "#e5eef3" : "#0e2230", "text-halo-color": dark ? "#0f2230" : "#ffffff", "text-halo-width": 1.6 } });

          const ml2 = ml;
          m.on("mouseenter", "subs-dot", () => { m.getCanvas().style.cursor = "pointer"; });
          m.on("mouseleave", "subs-dot", () => { m.getCanvas().style.cursor = ""; });
          m.on("click", "subs-dot", (ev: any) => {
            const f = ev.features?.[0]; if (!f) return;
            const s = latest.current.subs.find(x => x.id === f.properties.id); if (!s) return;
            showPopup(ml2, m, s);
          });
          setReady(true);
        });
        map.current = m;
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; popup.current?.remove(); markers.current.forEach(x => x.remove()); map.current?.remove(); map.current = null; };
  }, []);

  function showPopup(ml: any, m: MLMap, s: MapSub) {
    const p = latest.current;
    const picked = p.picked.has(s.id);
    const box = document.createElement("div"); box.className = "mpop";
    const h = document.createElement("b"); h.textContent = s.name; box.appendChild(h);
    const meta = document.createElement("div"); meta.className = "mpop-meta";
    meta.textContent = s.state === "complete" ? "Complete" : s.state === "toscan" ? "Driven · needs scan" : `${s.open} of ${s.total} section${s.total === 1 ? "" : "s"} left`;
    box.appendChild(meta);
    const row = document.createElement("div"); row.className = "mpop-row";
    if (p.onToggle && s.state === "todrive") {
      const b = document.createElement("button"); b.type = "button"; b.className = `btn sm ${picked ? "" : "primary"}`;
      b.textContent = picked ? "Remove from today" : "Add to today";
      b.onclick = () => { latest.current.onToggle?.(s.id); popup.current?.remove(); };
      row.appendChild(b);
    }
    const a = document.createElement("a"); a.className = "btn sm"; a.href = mapsLink(s); a.target = "_blank"; a.rel = "noopener"; a.textContent = "Navigate";
    row.appendChild(a); box.appendChild(row);
    popup.current?.remove();
    popup.current = new ml.Popup({ offset: 14, closeButton: true, maxWidth: "260px" }).setLngLat([s.lng, s.lat]).setDOMContent(box).addTo(m);
  }

  // Push data to the map whenever it changes.
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const { subs, picked, order, origin, destination, polylines } = props;
    const pins = subs.filter(hasPin);
    (m.getSource("subs") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: pins.map(s => ({
        type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { id: s.id, name: s.name, state: s.state, picked: picked.has(s.id) && s.state === "todrive", num: order?.get(s.id) ? String(order.get(s.id)) : "" },
      })),
    } as any);

    // Route line: Google's road geometry when available, otherwise a dashed line in stop order.
    let lines: any[] = [];
    if (polylines?.length) lines = polylines.map(p => ({ type: "Feature", properties: { road: true }, geometry: { type: "LineString", coordinates: decode(p) } }));
    else if (order && order.size) {
      const seq = pins.filter(s => order.has(s.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      const pts = [origin, ...seq, destination].filter(hasPin) as LatLng[];
      if (pts.length > 1) lines = [{ type: "Feature", properties: { road: false }, geometry: { type: "LineString", coordinates: pts.map(p => [p.lng, p.lat]) } }];
    }
    (m.getSource("route") as GeoJSONSource)?.setData({ type: "FeatureCollection", features: lines } as any);

    // Start / finish markers.
    (async () => {
      const ml = (await import("maplibre-gl")).default;
      markers.current.forEach(x => x.remove()); markers.current = [];
      const add = (p: Pt | null | undefined, text: string, cls: string) => {
        if (!p || !hasPin(p)) return;
        const d = document.createElement("div"); d.className = `mpin ${cls}`; d.textContent = text; d.title = p.label || text;
        markers.current.push(new ml.Marker({ element: d }).setLngLat([p.lng, p.lat]).addTo(m));
      };
      add(origin, "S", "start"); add(destination, "E", "end");
    })();

    // Fit the view when the set of pins or the planned route changes (not on every check-off).
    const key = `${pins.length}|${order ? [...order.keys()].join(",") : ""}|${origin?.lat ?? ""}`;
    if (key !== fitKey.current && pins.length) {
      fitKey.current = key;
      const focus = order && order.size ? pins.filter(s => order.has(s.id)) : pins.filter(s => s.state !== "complete");
      const pts = [...(focus.length ? focus : pins), ...(order && order.size && origin && hasPin(origin) ? [origin] : [])] as LatLng[];
      const lngs = pts.map(p => p.lng), lats = pts.map(p => p.lat);
      m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 14, duration: 0 });
    }
  }, [props, ready]);

  return (
    <div>
      <div className="map mlmap" ref={el} role="region" aria-label="Map of your subdivisions">
        {failed && <div className="pad muted">The map couldn't load. Check your signal and reopen this page.</div>}
      </div>
      <div className="legend pad" style={{ paddingBlock: 8 }}>
        <span><i style={{ background: COLORS.todrive }} />To drive</span>
        <span><i style={{ background: COLORS.picked }} />Today</span>
        <span><i style={{ background: COLORS.toscan }} />Needs scan</span>
        <span><i style={{ background: COLORS.complete }} />Complete</span>
        {props.onToggle && <span>Tap a pin to add or remove it</span>}
      </div>
    </div>
  );
}
