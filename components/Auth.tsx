"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cache } from "@/lib/offline";
import { isDriver } from "@/lib/roles";

export type Place = { label?: string; address?: string; lat: number; lng: number };
export type Profile = {
  id: string; full_name: string; username: string | null; role: "driver" | "admin";
  driver_key: string | null; active: boolean; home: Place | null; work: Place | null;
  default_start: "home" | "work" | "current" | "custom"; start_place: Place | null;
  drives: boolean;
};
export type Quarter = {
  id: string; label: string; is_active: boolean; closed_at: string | null; summary: any;
  start_date: string | null; due_date: string | null; created_at: string; purged_at?: string | null;
};
type Ctx = {
  ready: boolean; profile: Profile | null; quarter: Quarter | null;
  /** This driver's due date: their own override, else the quarter's. */
  dueDate: string | null;
  reload: () => Promise<void>; signOut: () => Promise<void>;
};
const AuthCtx = createContext<Ctx>({ ready: false, profile: null, quarter: null, dueDate: null, reload: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [quarter, setQuarter] = useState<Quarter | null>(null);
  const [dueDate, setDue] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const sb = supabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { setProfile(null); setQuarter(null); setReady(true); return; }
    const uid = session.user.id;
    try {
      const [p, q] = await Promise.all([
        sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
        sb.from("quarters").select("*").eq("is_active", true).maybeSingle(),
      ]);
      if (p.error || q.error) throw p.error || q.error;
      let due: string | null = (q.data as Quarter | null)?.due_date || null;
      if (q.data) {
        const { data: dl } = await sb.from("driver_deadlines").select("due_date").eq("quarter_id", q.data.id).eq("driver_id", uid).maybeSingle();
        if (dl?.due_date) due = dl.due_date;
      }
      setProfile((p.data as Profile) || null); setQuarter((q.data as Quarter) || null); setDue(due);
      cache.set(`auth-${uid}`, { profile: p.data, quarter: q.data, due });
    } catch {
      // No signal: use what this phone saw last time.
      const c = cache.get<{ profile: Profile; quarter: Quarter; due: string | null }>(`auth-${uid}`);
      if (c) { setProfile(c.profile); setQuarter(c.quarter); setDue(c.due); }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    reload();
    const { data } = supabase().auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_IN" || ev === "SIGNED_OUT" || ev === "USER_UPDATED") reload();
    });
    return () => data.subscription.unsubscribe();
  }, [reload]);

  const signOut = useCallback(async () => { await supabase().auth.signOut(); setProfile(null); }, []);
  return <AuthCtx.Provider value={{ ready, profile, quarter, dueDate, reload, signOut }}>{children}</AuthCtx.Provider>;
}

/** Sends signed-out visitors to /login, drivers away from manager pages, and managers away
 *  from driver pages (a manager who also drives gets a separate driver login). */
export function RequireAuth({ admin = false, driver = false, children }: { admin?: boolean; driver?: boolean; children: ReactNode }) {
  const { ready, profile } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!ready) return;
    if (!profile) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (admin && profile.role !== "admin") router.replace("/");
    else if (driver && !isDriver(profile)) router.replace("/admin");
  }, [ready, profile, admin, driver, router, path]);
  if (!ready || !profile || (admin && profile.role !== "admin") || (driver && !isDriver(profile))) {
    return <div className="wrap" style={{ paddingTop: 40 }}><p className="muted">Loading…</p></div>;
  }
  if (!profile.active) {
    return <div className="wrap" style={{ paddingTop: 40 }}><div className="notice"><h2>This account is turned off</h2><p className="muted">Ask your manager to turn it back on.</p></div></div>;
  }
  return <>{children}</>;
}
