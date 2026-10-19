"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { RequireAuth, useAuth } from "./Auth";
import { SyncStatus } from "./PhoneBits";
import { Brand } from "./Brand";

const Icon = {
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>,
  route: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" /></svg>,
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
  const { quarter, signOut } = useAuth();
  const links = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/upload", label: "Upload drives" },
    { href: "/admin/drivers", label: "Drivers" },
    { href: "/admin/archive", label: "Archive" },
  ];
  return (
    <RequireAuth admin>
      <header className="topbar"><div className="wrap">
        <Link href="/admin" style={{ color: "inherit", textDecoration: "none" }} aria-label="Manager home"><Brand section="Drivers · Manager" /></Link>
        {quarter && <span className="quarter">{quarter.label}</span>}
        <nav>
          {links.map(l => <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>{l.label}</Link>)}
          <button type="button" className="signout" onClick={async () => { await signOut(); router.replace("/login"); }}>Sign out</button>
        </nav>
      </div></header>
      <main className="wrap">{children}</main>
    </RequireAuth>
  );
}

/** Small toast helper: const [toast, say] = useToast(); */
export function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t); }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}
