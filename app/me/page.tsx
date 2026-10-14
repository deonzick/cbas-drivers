"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DriverShell, useToast } from "@/components/Shell";
import { useAuth, type Place } from "@/components/Auth";
import { AddressSearch, currentPosition } from "@/components/PlaceField";
import { getRemember, setRemember, supabase } from "@/lib/supabase";
import { readQueue } from "@/lib/offline";
import { InstallPrompt } from "@/components/PhoneBits";

function SavedPlace({ kind }: { kind: "home" | "work" }) {
  const { profile, reload } = useAuth();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, say] = useToast();
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
    <div className="card">
      <div className="row"><h3 className="grow">{title}</h3>
        {place && !editing && <><button className="btn sm" onClick={() => setEditing(true)}>Change</button><button className="btn sm ghost" onClick={() => save(null)}>Remove</button></>}</div>
      {place && !editing ? <div className="small">{place.address}</div> : (
        <div className="stack" style={{ gap: 8 }}>
          <AddressSearch onPick={p => save({ ...p, label: title })} />
          <div className="row"><button className="btn sm" onClick={useHere}>Use where I am now</button>
            {editing && <button className="btn sm ghost" onClick={() => setEditing(false)}>Cancel</button>}</div>
        </div>)}
      {err && <div className="alert err">{err}</div>}
      {toast}
    </div>
  );
}

function DefaultStart() {
  const { profile, reload } = useAuth();
  const [toast, say] = useToast();
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cur = profile?.default_start || "home";
  async function save(kind: string, place?: Place | null) {
    setErr(null);
    const patch: Record<string, unknown> = { default_start: kind };
    if (place !== undefined) patch.start_place = place;
    const { error } = await supabase().from("profiles").update(patch).eq("id", profile!.id);
    if (error) return setErr(error.message);
    await reload(); setPicking(false); say("Default start saved");
  }
  const opts: [string, string, boolean][] = [["home", "Home", !profile?.home], ["work", "Work", !profile?.work], ["current", "Where I am", false], ["custom", "Another place", false]];
  return (
    <section className="pane pad stack" style={{ gap: 10 }}>
      <h2>Where you start your day</h2>
      <p className="muted small" style={{ margin: 0 }}>Plan today starts from here unless you change it for that day.</p>
      <div className="chips">{opts.map(([k, label, dis]) => (
        <button key={k} className="chip" aria-pressed={cur === k} disabled={dis}
          onClick={() => k === "custom" ? (profile?.start_place ? save("custom") : setPicking(true)) : save(k)}>{label}</button>))}</div>
      {(!profile?.home || !profile?.work) && <span className="muted small">Save Home or Work above to choose them.</span>}
      {cur === "custom" && profile?.start_place && !picking && (
        <div className="row small"><span className="grow">{profile.start_place.address}</span><button className="btn sm ghost" onClick={() => setPicking(true)}>Change</button></div>)}
      {picking && <><AddressSearch onPick={p => save("custom", { ...p, label: "My start" })} /><div><button className="btn sm ghost" onClick={() => setPicking(false)}>Cancel</button></div></>}
      {err && <div className="alert err">{err}</div>}
      {toast}
    </section>
  );
}

function Me() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const [remember, setRem] = useState(getRemember());
  const [confirmOut, setConfirmOut] = useState(false);
  const pending = profile ? readQueue(profile.id).length : 0;

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div><div className="eyebrow">Signed in as {profile?.username || "driver"}</div><h1>{profile?.full_name || "Me"}</h1></div>
      <InstallPrompt />
      <section className="stack" style={{ gap: 10 }}>
        <h2>Saved places</h2>
        <p className="muted small" style={{ margin: 0 }}>Used as start and finish points when you plan a day. Only you can see these.</p>
        <div className="cards"><SavedPlace kind="home" /><SavedPlace kind="work" /></div>
      </section>
      <DefaultStart />
      <section className="pane pad stack">
        <h2>Sign-in</h2>
        <label className="remember">
          <input type="checkbox" className="check sm" checked={remember} onChange={e => { setRem(e.target.checked); setRemember(e.target.checked); }} />
          Keep me signed in on this phone
        </label>
        <p className="muted small" style={{ margin: 0 }}>Your manager sets your username and password. If you forget it, ask them to reset it.</p>
        {confirmOut ? (
          <div className="confirm-box">
            {pending > 0 && <b>{pending} check-off{pending === 1 ? " hasn't" : "s haven't"} synced yet. They stay on this phone and sync next time you sign in here.</b>}
            <div className="row"><button className="btn danger solid" onClick={async () => { await signOut(); router.replace("/login"); }}>Sign out</button>
              <button className="btn ghost" onClick={() => setConfirmOut(false)}>Stay signed in</button></div>
          </div>
        ) : <div><button className="btn danger" onClick={() => setConfirmOut(true)}>Sign out</button></div>}
      </section>
    </div>
  );
}

export default function Page() {
  return <DriverShell><Me /></DriverShell>;
}
