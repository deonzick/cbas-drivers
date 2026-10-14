"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { cache, enqueue, flushQueue, onQueueChange, readQueue, type QueuedOp } from "./offline";

export type Section = { id: string; label: string; kinds: string[]; sort: number; completed_at: string | null; lat: number | null; lng: number | null };
export type Subdivision = {
  id: string; name: string; county: string; city: string; market: string; submarket: string;
  lat: number | null; lng: number | null; sort: number; sections: Section[];
  scanned_at: string | null;
};

/** Driven: every section checked off. */
export const isSubDone = (s: Subdivision) => s.sections.length > 0 && s.sections.every(x => x.completed_at);
/** Complete: driven AND scanned into TurboScan. */
export const isComplete = (s: Subdivision) => isSubDone(s) && !!s.scanned_at;
export const openCount = (s: Subdivision) => s.sections.filter(x => !x.completed_at).length;

const applyOps = (subs: Subdivision[], ops: QueuedOp[]) => {
  if (!ops.length) return subs;
  const sec = new Map(ops.filter(o => o.kind === "section").map(o => [o.id, o]));
  const scan = new Map(ops.filter(o => o.kind === "scan").map(o => [o.id, o]));
  return subs.map(s => {
    const sections = s.sections.map(x => sec.has(x.id) ? { ...x, completed_at: sec.get(x.id)!.done ? sec.get(x.id)!.at : null } : x);
    let scanned_at = scan.has(s.id) ? (scan.get(s.id)!.done ? scan.get(s.id)!.at : null) : s.scanned_at;
    if (sections.some(x => !x.completed_at)) scanned_at = null; // only complete subdivisions can be scanned
    return { ...s, sections, scanned_at };
  });
};

/** The driver's subdivisions for the active quarter. Works offline from the last copy, and
 *  check-offs made offline are queued and synced with their original time. */
export function useDrive(driverId: string | undefined, quarterId: string | undefined) {
  const key = driverId && quarterId ? `drive-${driverId}-${quarterId}` : "";
  const [subs, setSubs] = useState<Subdivision[]>(() => (key && cache.get<Subdivision[]>(key)) || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    if (!driverId || !quarterId) { setSubs([]); setLoading(false); return; }
    const cached = cache.get<Subdivision[]>(key);
    if (cached) setSubs(applyOps(cached, readQueue(driverId)));
    try {
      if (readQueue(driverId).length) await flushQueue(driverId);
      const { data, error } = await supabase().from("subdivisions")
        .select("id,name,county,city,market,submarket,lat,lng,sort,scanned_at,sections(id,label,kinds,sort,completed_at,lat,lng)")
        .eq("driver_id", driverId).eq("quarter_id", quarterId).order("sort");
      if (error) throw error;
      const fresh = (data as any[]).map(s => ({ ...s, sections: (s.sections || []).sort((a: Section, b: Section) => a.sort - b.sort) }));
      cache.set(key, fresh);
      setSubs(applyOps(fresh, readQueue(driverId)));
      setError(null); setOffline(false);
    } catch (e: any) {
      setOffline(true);
      if (!cached) setError("No signal, and this phone hasn't loaded your list yet. Connect once to download it.");
    }
    setLoading(false);
  }, [driverId, quarterId, key]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!driverId) return;
    const upd = () => setPending(readQueue(driverId).length);
    upd();
    const off = onQueueChange(upd);
    const back = () => { setOffline(false); load(); };
    const vis = () => { if (document.visibilityState === "visible") load(); };
    const gone = () => setOffline(true);
    window.addEventListener("online", back); window.addEventListener("offline", gone);
    document.addEventListener("visibilitychange", vis);
    const timer = setInterval(() => { if (readQueue(driverId).length && navigator.onLine) flushQueue(driverId).then(upd); }, 30000);
    return () => { off(); window.removeEventListener("online", back); window.removeEventListener("offline", gone); document.removeEventListener("visibilitychange", vis); clearInterval(timer); };
  }, [driverId, load]);

  /** Check or uncheck sections. Saved on the phone first, then synced. */
  const setSections = useCallback(async (ids: string[], done: boolean) => {
    if (!driverId) return;
    const at = new Date().toISOString();
    const ops = ids.map(id => ({ kind: "section" as const, id, done, at }));
    enqueue(driverId, ops);
    setSubs(prev => {
      const next = applyOps(prev, ops);
      if (key) cache.set(key, next);
      return next;
    });
    const r = await flushQueue(driverId);
    if (readQueue(driverId).length) setOffline(true);
    if (r.failed) load();
  }, [driverId, load, key]);

  /** Mark a complete subdivision as scanned into TurboScan (or undo it). */
  const setScanned = useCallback(async (subId: string, done: boolean) => {
    if (!driverId) return;
    const ops = [{ kind: "scan" as const, id: subId, done, at: new Date().toISOString() }];
    enqueue(driverId, ops);
    setSubs(prev => { const next = applyOps(prev, ops); if (key) cache.set(key, next); return next; });
    const r = await flushQueue(driverId);
    if (readQueue(driverId).length) setOffline(true);
    if (r.failed) load();
  }, [driverId, load, key]);

  return { subs, loading, error, pending, offline, reload: load, setSections, setScanned };
}
