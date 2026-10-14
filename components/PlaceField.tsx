"use client";
import { useState } from "react";
import { api } from "@/lib/supabase";
import type { Place } from "./Auth";

export function currentPosition(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device can't share its location."));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ label: "Current location", lat: p.coords.latitude, lng: p.coords.longitude }),
      e => reject(new Error(e.code === 1 ? "Location is blocked. Allow location for this app in your phone's settings." : "Couldn't get your location. Try again outside or with better signal.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/** Address search box that resolves to coordinates. */
export function AddressSearch({ onPick, placeholder = "Street address, city" }: { onPick: (p: Place) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Place[]>([]);
  async function search(e?: React.FormEvent) {
    e?.preventDefault(); setErr(null); setBusy(true);
    try { const r = await api<{ results: Place[] }>(`/api/geocode?q=${encodeURIComponent(q)}`); setResults(r.results); }
    catch (x: any) { setErr(x.message); setResults([]); }
    setBusy(false);
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label="Address"
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
        <button type="button" className="btn" onClick={() => search()} disabled={busy || !q.trim()}>{busy ? "…" : "Find"}</button>
      </div>
      {err && <div className="alert err">{err}</div>}
      {results.map(r => (
        <button type="button" key={`${r.lat},${r.lng}`} className="btn" style={{ justifyContent: "flex-start", textAlign: "left" }}
          onClick={() => { onPick(r); setResults([]); setQ(""); }}>{r.address}</button>
      ))}
    </div>
  );
}
