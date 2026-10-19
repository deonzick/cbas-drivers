"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { fetchAll } from "./fetchAll";
import type { Profile, Quarter } from "@/components/Auth";

export type Upload = { id: string; driver_id: string; file_name: string; storage_path: string | null; subdivision_count: number; section_count: number; uploaded_at: string };
/** One subdivision's state. driven = every section checked; complete = driven + scanned. */
export type SubProgress = { id: string; name: string; submarket: string; city: string; secs: number; done: number; scanned: string | null; drivenAt: string | null };
export type DriverStats = { subs: number; subsDone: number; scanned: number; secs: number; secsDone: number; last: string | null; doneToday: number; list: SubProgress[] };

/** Everything the manager screens need for the active quarter. */
export function useAdminData(quarter: Quarter | null) {
  const [people, setPeople] = useState<Profile[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [stats, setStats] = useState<Record<string, DriverStats>>({});
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const sb = supabase();
    const [p, q] = await Promise.all([
      sb.from("profiles").select("*").order("full_name"),
      sb.from("quarters").select("*").order("created_at", { ascending: false }),
    ]);
    setPeople((p.data as Profile[]) || []); setQuarters((q.data as Quarter[]) || []);
    if (quarter) {
      const [u, subRows] = await Promise.all([
        sb.from("uploads").select("*").eq("quarter_id", quarter.id).order("uploaded_at", { ascending: false }),
        fetchAll<any>((from, to) => sb.from("subdivisions").select("id,driver_id,name,submarket,city,sort,scanned_at,sections(completed_at)")
          .eq("quarter_id", quarter.id).order("driver_id").order("sort").order("id").range(from, to)),
      ]);
      setUploads((u.data as Upload[]) || []);
      const today = new Date().toDateString();
      const st: Record<string, DriverStats> = {};
      for (const row of subRows) {
        const ds = (st[row.driver_id] ||= { subs: 0, subsDone: 0, scanned: 0, secs: 0, secsDone: 0, last: null, doneToday: 0, list: [] });
        const secs = row.sections || [];
        const done = secs.filter((x: any) => x.completed_at);
        ds.subs++; ds.secs += secs.length; ds.secsDone += done.length;
        const driven = secs.length > 0 && done.length === secs.length;
        if (driven) { ds.subsDone++; if (row.scanned_at) ds.scanned++; }
        const drivenAt = driven ? done.reduce((m: string, x: any) => x.completed_at > m ? x.completed_at : m, "") : null;
        for (const x of done) {
          if (!ds.last || x.completed_at > ds.last) ds.last = x.completed_at;
          if (new Date(x.completed_at).toDateString() === today) ds.doneToday++;
        }
        ds.list.push({ id: row.id, name: row.name, submarket: row.submarket || row.city || "Other", city: row.city, secs: secs.length, done: done.length, scanned: driven ? row.scanned_at : null, drivenAt });
      }
      setStats(st);
    } else { setUploads([]); setStats({}); }
    setLoading(false);
  }, [quarter]);

  useEffect(() => { load(); }, [load]);
  return { people, uploads, stats, quarters, loading, reload: load };
}
