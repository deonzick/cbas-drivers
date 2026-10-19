"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { RequireAuth, useAuth } from "./Auth";
import { SyncStatus } from "./PhoneBits";
import { Brand } from "./Brand";
import { isDriver } from "@/lib/roles";

const Icon = {
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>,
  route: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" /></svg>,
  chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></svg>,
  people: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1-3.6 3.6-5.5 6.5-5.5s5.5 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.5 4.6 4" /></svg>,
  upload: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 14v4a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4" /></svg>,
  archive: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></svg>,
  me: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
};

export function DriverShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { profile, quarter } = useAuth();
  const tabs = [
    { href: "/", label: "My list", icon: Icon.list },
    { href: "/plan", label: "Plan today", icon: Icon.route },
    { href: "/me", label: "Me", icon: Icon.me },
  ];
  return (
    <RequireAuth driver>
      <div className="has-tabbar">
        <header className="topbar"><div className="wrap">
          <Link href="/" style={{ color: "inherit", textDecoration: "none" }} aria-label="CBAS Drivers home"><Brand /></Link>
          {quarter && <span className="quarter">{quarter.label}</span>}
          <nav>
            <span className="desk-only" style={{ gap: 4 }}>
              {tabs.map(t => <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>{t.label}</Link>)}
            </span>
            {profile?.role === "admin" && <Link href="/admin" className="switch">Manager view</Link>}
          </nav>
        </div></header>
        <SyncStatus />
        <main className="wrap">{children}</main>
        <nav className="tabbar" aria-label="Driver">
          {tabs.map(t => <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>{t.icon}{t.label}</Link>)}
        </nav>
      </div>
    </RequireAuth>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { quarter, signOut, profile } = useAuth();
  const links = [
    { href: "/admin", label: "Overview", icon: Icon.chart },
    { href: "/admin/drivers", label: "Drivers", icon: Icon.people },
    { href: "/admin/upload", label: "Upload", icon: Icon.upload },
    { href: "/admin/archive", label: "Archive", icon: Icon.archive },
  ];
  return (
    <RequireAuth admin>
      <div className="has-tabbar">
      <header className="topbar"><div className="wrap">
        <Link href="/admin" style={{ color: "inherit", textDecoration: "none" }} aria-label="Manager home"><Brand section="Manager" /></Link>
        {quarter && <span className="quarter">{quarter.label}</span>}
        <nav>
          <span className="nav-links">{links.map(l => <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>{l.label}</Link>)}</span>
          {profile && isDriver(profile) && <Link href="/" className="switch">My drives</Link>}
          <button type="button" className="signout" onClick={async () => { await signOut(); router.replace("/login"); }}>Sign out</button>
        </nav>
      </div></header>
      <main className="wrap">{children}</main>
      <nav className="tabbar" aria-label="Manager" style={{ ["--tabs" as any]: links.length }}>
        {links.map(l => <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>{l.icon}{l.label}</Link>)}
      </nav>
      </div>
    </RequireAuth>
  );
}

/** Small toast helper: const [toast, say] = useToast(); */
export function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t); }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}
