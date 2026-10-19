"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getRemember, loginEmail, setRemember, supabase } from "@/lib/supabase";
import { useAuth } from "@/components/Auth";
import { InstallPrompt } from "@/components/PhoneBits";
import { Brand } from "@/components/Brand";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const { ready, profile } = useAuth();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [remember, setRem] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setRem(getRemember()); try { setUser(localStorage.getItem("cbas-last-user") || ""); } catch {} }, []);
  useEffect(() => {
    if (!ready || !profile) return;
    const home = profile.role === "admin" ? "/admin" : "/";
    const want = next.startsWith("/") ? next : home;
    router.replace(profile.role === "admin" ? (want.startsWith("/admin") ? want : "/admin") : (want.startsWith("/admin") ? "/" : want));
  }, [ready, profile, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    setRemember(remember);
    const { error } = await supabase().auth.signInWithPassword({ email: loginEmail(user), password: pass });
    setBusy(false);
    if (error) { setErr(/invalid/i.test(error.message) ? "That username and password don't match. Check both and try again." : error.message); return; }
    try { remember ? localStorage.setItem("cbas-last-user", user.trim()) : localStorage.removeItem("cbas-last-user"); } catch {}
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-sign">
          <Brand />
          <div className="tagline">Sign in with the username and password your manager gave you.</div>
        </div>
        <div className="pane pad stack">
          <div className="field">
            <label htmlFor="user">Username</label>
            <input id="user" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={user} onChange={e => setUser(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pass">Password</label>
            <input id="pass" type="password" autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} required />
          </div>
          <label className="remember" style={{ justifyContent: "space-between" }}>
            Keep me signed in
            <input type="checkbox" className="toggle" checked={remember} onChange={e => setRem(e.target.checked)} />
          </label>
          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn primary big block" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <p className="muted small" style={{ margin: 0, textAlign: "center" }}>Forgot your password? Ask your manager to reset it.</p>
        </div>
        <InstallPrompt />
      </form>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
