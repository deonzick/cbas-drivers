"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DriverShell, useToast } from "@/components/Shell";
import { useAuth, type Place } from "@/components/Auth";
import { AddressSearch, currentPosition } from "@/components/PlaceField";
import { getRemember, setRemember, supabase } from "@/lib/supabase";
import { readQueue } from "@/lib/offline";
import { InstallPrompt } from "@/components/PhoneBits";

const ICONS = {
  home: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2 2.8 11a1 1 0 0 0 1.3 1.5l.9-.8V20a1 1 0 0 0 1 1h4.5v-5.5h3V21H18a1 1 0 0 0 1-1v-8.3l.9.8a1 1 0 0 0 1.3-1.5z" /></svg>,
  work: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 4a2 2 0 0 0-2 2v1H4.5A1.5 1.5 0 0 0 3 8.5V12h18V8.5A1.5 1.5 0 0 0 19.5 7H17V6a2 2 0 0 0-2-2zm0 2h6v1H9zM3 13.5v5A1.5 1.5 0 0 0 4.5 20h15a1.5 1.5 0 0 0 1.5-1.5v-5h-7v1h-4v-1z" /></svg>,
  start: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.7 3.3a1 1 0 0 0-1.1-.2l-16 7a1 1 0 0 0 .1 1.9l6.6 1.7 1.7 6.6a1 1 0 0 0 1.9.1l7-16a1 1 0 0 0-.2-1.1z" /></svg>,
  key: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.5 3a6.5 6.5 0 0 0-6.2 8.5L3 16.8V21h4.2v-2h2v-2h2l1.3-1.3A6.5 6.5 0 1 0 14.5 3zm2 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" /></svg>,
};
const Chev = () => <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 6l6 6-6 6" /></svg>;

function SavedPlace({ kind, say }: { kind: "home" | "work"; say: (m: string) => void }) {
  const { profile, reload } = useAuth();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const place = profile?.[kind];
  const title = kind === "home" ? "Home" : "Work";

  async function save(p: Place | null) {
    setErr(null);
    const { error } = await supabase().from("profiles").update({ [kind]: p }).eq("id", profile!.id);
    if (error) { setErr(error.message); return; }
    await reload(); setEditing(false); say(p ? `${title} saved` : `${title} removed`);
  }
  async function useHere() {
    try { const p = await currentPosition(); await save({ ...p, label: title, address: `Pinned ${new Date().toLocaleDateString()} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})` }); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <>
      <button type="button" className="cell" style={{ ["--sep-inset" as any]: "58px" }} onClick={() => setEditing(!editing)} aria-expanded={editing}>
        <span className="icon-sq" style={{ background: kind === "home" ? "#007aff" : "#a2845e" }}>{ICONS[kind]}</span>
        <span className="cell-t"><span>{title}</span><span className="cell-sub">{place ? place.address : "Not set"}</span></span>
        {!place && <span className="cell-v" style={{ color: "var(--sign)" }}>Add</span>}
        <Chev />
      </button>
      {editing && (
        <div className="cell-body">
          <AddressSearch onPick={p => save({ ...p, label: title })} />
          <div className="row"><button className="btn sm" onClick={useHere}>Use Where I Am Now</button>
            {place && <button className="btn sm danger" onClick={() => save(null)}>Remove</button>}
            <button className="btn sm plain" onClick={() => setEditing(false)}>Cancel</button></div>
          {err && <div className="alert err">{err}</div>}
        </div>)}
    </>
  );
}

function Me() {
  const { profile, signOut, reload } = useAuth();
  const router = useRouter();
  const [toast, say] = useToast();
  const [remember, setRem] = useState(getRemember());
  const [confirmOut, setConfirmOut] = useState(false);
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = profile ? readQueue(profile.id).length : 0;
  const cur = profile?.default_start || "home";
  const initials = (profile?.full_name || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();

  async function saveStart(kind: string, place?: Place | null) {
    setErr(null);
    const patch: Record<string, unknown> = { default_start: kind };
    if (place !== undefined) patch.start_place = place;
    const { error } = await supabase().from("profiles").update(patch).eq("id", profile!.id);
    if (error) return setErr(error.message);
    await reload(); setPicking(false); say("Default start saved");
  }

  return (
    <div className="stack narrow">
      <header className="page-h"><h1>Me</h1></header>
      <div className="group">
        <div className="profile-card"><span className="avatar">{initials}</span>
          <div className="grow"><b>{profile?.full_name || "Driver"}</b><span className="muted small">{profile?.username || ""}{profile?.role === "admin" ? " · Manager" : " · Driver"}</span></div></div>
      </div>
      <InstallPrompt />

      <div>
        <div className="group-label">Saved places</div>
        <div className="group"><SavedPlace kind="home" say={say} /><SavedPlace kind="work" say={say} /></div>
        <p className="group-foot">Used as start and finish points when you plan a day. Only you can see these.</p>
      </div>

      <div>
        <div className="group-label">Planning</div>
        <div className="group">
          <label className="cell" style={{ ["--sep-inset" as any]: "58px" }}>
            <span className="icon-sq" style={{ background: "#34c759" }}>{ICONS.start}</span>
            <span className="cell-t">Start my day from</span>
            <select className="cell-select" value={cur} onChange={e => { const k = e.target.value; k === "custom" ? (profile?.start_place ? saveStart("custom") : setPicking(true)) : saveStart(k); }}>
              <option value="home" disabled={!profile?.home}>Home</option>
              <option value="work" disabled={!profile?.work}>Work</option>
              <option value="current">Where I Am</option>
              <option value="custom">Another Place</option>
            </select>
          </label>
          {cur === "custom" && profile?.start_place && !picking && (
            <div className="cell sep"><span className="cell-t"><span className="cell-sub">{profile.start_place.address}</span></span><button className="btn sm plain" onClick={() => setPicking(true)}>Change</button></div>)}
          {picking && <div className="cell-body sep" style={{ paddingTop: 10 }}><AddressSearch onPick={p => saveStart("custom", { ...p, label: "My start" })} /><div><button className="btn sm plain" onClick={() => setPicking(false)}>Cancel</button></div></div>}
        </div>
        {err && <div className="alert err" style={{ marginTop: 8 }}>{err}</div>}
        <p className="group-foot">Plan Today starts from here unless you change it for that day.{(!profile?.home || !profile?.work) ? " Save Home or Work above to choose them." : ""}</p>
      </div>

      <div>
        <div className="group-label">Account</div>
        <div className="group">
          <label className="cell" style={{ ["--sep-inset" as any]: "58px" }}>
            <span className="icon-sq" style={{ background: "#8e8e93" }}>{ICONS.key}</span>
            <span className="cell-t">Keep me signed in</span>
            <input type="checkbox" className="toggle" checked={remember} onChange={e => { setRem(e.target.checked); setRemember(e.target.checked); }} />
          </label>
          <button type="button" className="cell center danger" onClick={() => setConfirmOut(true)}>Sign Out</button>
        </div>
        <p className="group-foot">Your manager sets your username and password. If you forget it, ask them to reset it.</p>
      </div>

      {confirmOut && (
        <div className="confirm-box">
          <b>{pending > 0 ? `${pending} check-off${pending === 1 ? " hasn't" : "s haven't"} synced yet. They stay on this phone and sync next time you sign in here.` : "Sign out of CBAS Drivers on this phone?"}</b>
          <div className="row"><button className="btn danger solid" onClick={async () => { await signOut(); router.replace("/login"); }}>Sign Out</button>
            <button className="btn gray" onClick={() => setConfirmOut(false)}>Cancel</button></div>
        </div>)}
      {toast}
    </div>
  );
}

export default function Page() {
  return <DriverShell><Me /></DriverShell>;
}
