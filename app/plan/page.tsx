"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DriverShell } from "@/components/Shell";
import { useAuth, type Place } from "@/components/Auth";
import SubdivisionMap, { type MapSub } from "@/components/SubdivisionMap";
import { AddressSearch, currentPosition } from "@/components/PlaceField";
import { api, supabase } from "@/lib/supabase";
import { cache } from "@/lib/offline";
import { fmtMin, fmtTime, hasPin, mapsLink } from "@/lib/geo";
import { dueText, isToday } from "@/lib/format";
import { isSubDone, openCount, useDrive, type Subdivision } from "@/lib/useDrive";
import type { PlanResult } from "@/lib/route";

type StartKind = "current" | "home" | "work" | "other";
type EndKind = "last" | "home" | "work" | "start" | "other";
const PREFS = "cbas-plan-prefs";

function Planner() {
  const { profile, quarter, dueDate } = useAuth();
  const { subs, loading } = useDrive(profile?.id, quarter?.id);

  const [startKind, setStartKind] = useState<StartKind>("current");
  const [endKind, setEndKind] = useState<EndKind>("last");
  const [startOther, setStartOther] = useState<Place | null>(null);
  const [endOther, setEndOther] = useState<Place | null>(null);
  const [leave, setLeave] = useState<"now" | "later">("now");
  const [leaveAt, setLeaveAt] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [times, setTimes] = useState({ perSection: 5, perStop: 3 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [editing, setEditing] = useState(true);

  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem(PREFS) || "{}"); if (p.endKind) setEndKind(p.endKind); } catch {}
    supabase().from("app_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      if (data) setTimes({ perSection: Number(data.minutes_per_section), perStop: Number(data.minutes_per_stop) });
    }, () => {});
  }, []);
  useEffect(() => {
    if (!profile || !quarter) return;
    const k = `plan-${profile.id}`;
    const use = (p: PlanResult) => { setPlan(p); if (isToday(p.createdAt)) { setChosen(new Set(p.stops.map(s => s.id))); setEditing(false); } };
    const c = cache.get<{ plan: PlanResult; quarter_id: string }>(k);
    if (c && c.quarter_id === quarter.id) use(c.plan);
    supabase().from("route_plans").select("plan,quarter_id").eq("driver_id", profile.id).maybeSingle()
      .then(({ data }) => { if (data && data.quarter_id === quarter.id) { use(data.plan as PlanResult); cache.set(k, data); } }, () => {});
  }, [profile, quarter]);
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ endKind })); } catch {} }, [endKind]);
  // Start from the driver's saved default (Home unless they changed it on the Me tab).
  useEffect(() => {
    if (!profile) return;
    const d = profile.default_start || "home";
    if (d === "home") setStartKind(profile.home ? "home" : "current");
    else if (d === "work") setStartKind(profile.work ? "work" : "current");
    else if (d === "custom" && profile.start_place) { setStartKind("other"); setStartOther(profile.start_place); }
    else setStartKind("current");
  }, [profile]);

  const open = subs.filter(s => !isSubDone(s));
  const doneIds = useMemo(() => new Set(subs.filter(isSubDone).map(s => s.id)), [subs]);
  const home = profile?.home || null, work = profile?.work || null;
  const todayPlan = plan && isToday(plan.createdAt) ? plan : null;

  const groups = useMemo(() => {
    const g = new Map<string, Subdivision[]>();
    for (const s of open) { const k = s.submarket || s.city || "Other"; (g.get(k) || g.set(k, []).get(k)!).push(s); }
    return [...g.entries()];
  }, [open]);
  const picked = open.filter(s => chosen.has(s.id));
  const pickedSecs = picked.reduce((n, s) => n + openCount(s), 0);
  const onSite = pickedSecs * times.perSection + picked.length * times.perStop;

  // Everything this driver has, for the map: what's left to drive, what needs a scan, what's done.
  const mapSubs = useMemo<MapSub[]>(() => subs.filter(hasPin).map(s => ({
    id: s.id, name: s.name, lat: s.lat as number, lng: s.lng as number, total: s.sections.length, open: openCount(s),
    state: !isSubDone(s) ? "todrive" : s.scanned_at ? "complete" : "toscan",
  })), [subs]);
  const planOrder = useMemo(() => todayPlan && !editing ? new Map(todayPlan.stops.map((s, i) => [s.id, i + 1])) : undefined, [todayPlan, editing]);
  const mapPicked = useMemo(() => planOrder ? new Set(planOrder.keys()) : chosen, [planOrder, chosen]);

  const toggle = (ids: string[], on: boolean) => setChosen(prev => { const n = new Set(prev); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n; });

  async function resolveStart(): Promise<Place> {
    if (startKind === "home") { if (!home) throw new Error("Save your home address on the Me tab first."); return { ...home, label: "Home" }; }
    if (startKind === "work") { if (!work) throw new Error("Save your work address on the Me tab first."); return { ...work, label: "Work" }; }
    if (startKind === "other") { if (!startOther) throw new Error("Find a start address first."); return startOther; }
    return currentPosition();
  }
  async function build() {
    setErr(null); setBusy(true);
    try {
      if (!picked.length) throw new Error("Pick at least one subdivision for today.");
      if (!navigator.onLine) throw new Error("Building a route needs signal. Your list and check-offs still work offline.");
      const origin = await resolveStart();
      let destination: Place | null = null;
      if (endKind === "home") { if (!home) throw new Error("Save your home address on the Me tab first."); destination = { ...home, label: "Home" }; }
      if (endKind === "work") { if (!work) throw new Error("Save your work address on the Me tab first."); destination = { ...work, label: "Work" }; }
      if (endKind === "start") destination = { ...origin, label: origin.label || "Start" };
      if (endKind === "other") { if (!endOther) throw new Error("Find an end address first."); destination = endOther; }
      const r = await api<{ plan: PlanResult }>("/api/plan", {
        method: "POST",
        body: JSON.stringify({
          origin, destination, subdivisionIds: picked.map(s => s.id),
          departAt: leave === "later" && leaveAt ? new Date(leaveAt).toISOString() : null,
        }),
      });
      setPlan(r.plan); setEditing(false);
      if (profile && quarter) cache.set(`plan-${profile.id}`, { plan: r.plan, quarter_id: quarter.id });
      setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const legLinks = useMemo(() => {
    // Phones accept 3 waypoints per Google Maps link, so remaining stops go in groups of 4.
    const out: { from: number; to: number; url: string }[] = [];
    if (!todayPlan) return out;
    const idx = todayPlan.stops.map((s, i) => ({ s, i })).filter(x => !doneIds.has(x.s.id));
    for (let k = 0; k < idx.length; k += 4) {
      const g = idx.slice(k, k + 4);
      out.push({ from: g[0].i + 1, to: g[g.length - 1].i + 1, url: mapsLink(g[g.length - 1].s, g.slice(0, -1).map(x => x.s)) });
    }
    if (todayPlan.destination && todayPlan.stops.length)
      out.push({ from: -1, to: -1, url: mapsLink(todayPlan.destination) });
    return out;
  }, [todayPlan, doneIds]);

  if (!quarter) return <div className="notice"><h2>No drive assigned yet</h2><p className="muted">Planning opens once your manager uploads this quarter's list.</p></div>;

  const chips = (kind: string, setKind: (k: any) => void, opts: [string, string, boolean][]) => (
    <div className="chips">{opts.map(([k, label, disabled]) => (
      <button key={k} type="button" className="chip" aria-pressed={kind === k} disabled={disabled} onClick={() => setKind(k)}>{label}</button>))}</div>
  );
  const due = dueDate ? dueText(dueDate) : null;
  const remaining = todayPlan ? todayPlan.stops.filter(s => !doneIds.has(s.id)) : [];

  return (
    <>
      <div className="summary">
        <div><div className="eyebrow">{quarter.label} · {open.length} to drive{due ? ` · ${due.text}` : ""}</div><h1>Plan today</h1></div>
      </div>
      <div className="plan-grid">
        <section className="pane">
          {todayPlan && !editing ? (
            <div className="pad stack">
              <div><div className="eyebrow">Today's route</div><h2>{todayPlan.stops.length} stops · finish ≈ {fmtTime(todayPlan.totals.finishAt)}</h2>
                <p className="muted small" style={{ margin: "4px 0 0" }}>From {todayPlan.origin.label || "your start"}{todayPlan.destination ? ` to ${todayPlan.destination.label || "your end point"}` : ""}. Planned {fmtTime(todayPlan.createdAt)}.</p></div>
              <button className="btn block" onClick={() => setEditing(true)}>Change today's stops or start point</button>
            </div>
          ) : (
            <>
              <div className="pane-h"><h2 className="grow">1 · Pick today's subdivisions</h2>{chosen.size > 0 && <button className="btn sm ghost" onClick={() => setChosen(new Set())}>Clear</button>}</div>
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {loading && !subs.length && <div className="pad muted">Loading…</div>}
                {!loading && !open.length && <div className="pad"><div className="alert ok">Every subdivision assigned to you is driven.</div></div>}
                {groups.map(([g, list]) => {
                  const all = list.every(s => chosen.has(s.id));
                  return (
                    <div key={g}>
                      <div className="group-h" style={{ alignItems: "center" }}><span className="eyebrow">{g}</span>
                        <button className="btn sm ghost" style={{ minHeight: 26 }} onClick={() => toggle(list.map(s => s.id), !all)}>{all ? "Unselect all" : `Select all ${list.length}`}</button></div>
                      {list.map(s => (
                        <label key={s.id} className="row" style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", flexWrap: "nowrap", cursor: "pointer" }}>
                          <input type="checkbox" className="check sm" checked={chosen.has(s.id)} onChange={e => toggle([s.id], e.target.checked)} />
                          <span className="grow"><b>{s.name}</b><span className="muted small"> · {s.city}</span></span>
                          <span className="muted small" style={{ whiteSpace: "nowrap" }}>{openCount(s)} sec</span>
                        </label>))}
                    </div>);
                })}
              </div>
              <div className="pad small" style={{ borderTop: "1px solid var(--line)" }}>
                {picked.length ? <><b>{picked.length} stop{picked.length === 1 ? "" : "s"} · {pickedSecs} sections</b> · about {fmtMin(onSite)} on site plus driving</> : <span className="muted">Choose what you'll drive today. You can plan again tomorrow.</span>}
              </div>

              <div className="pane-h" style={{ borderTop: "1px solid var(--line)" }}><h2>2 · Start and finish</h2></div>
              <div className="pad stack">
                <div className="place-opt">
                  <span className="label">Start from</span>
                  {chips(startKind, setStartKind, [["current", "Current location", false], ["home", "Home", !home], ["work", "Work", !work], ["other", "Other address", false]])}
                  {startKind === "other" && (startOther
                    ? <div className="row small"><span className="grow">{startOther.address}</span><button className="btn sm ghost" onClick={() => setStartOther(null)}>Change</button></div>
                    : <AddressSearch onPick={setStartOther} />)}
                  {(!home || !work) && <span className="muted small">Save Home and Work on the <Link href="/me">Me</Link> tab to use them here.</span>}
                </div>
                <div className="place-opt">
                  <span className="label">Finish at (optional)</span>
                  {chips(endKind, setEndKind, [["last", "Last stop", false], ["home", "Home", !home], ["work", "Work", !work], ["start", "Back to start", false], ["other", "Other address", false]])}
                  {endKind === "other" && (endOther
                    ? <div className="row small"><span className="grow">{endOther.address}</span><button className="btn sm ghost" onClick={() => setEndOther(null)}>Change</button></div>
                    : <AddressSearch onPick={setEndOther} />)}
                </div>
                <div className="place-opt">
                  <span className="label">Leaving</span>
                  <div className="chips">
                    <button type="button" className="chip" aria-pressed={leave === "now"} onClick={() => setLeave("now")}>Now</button>
                    <button type="button" className="chip" aria-pressed={leave === "later"} onClick={() => setLeave("later")}>Later today</button>
                  </div>
                  {leave === "later" && <input type="datetime-local" value={leaveAt} onChange={e => setLeaveAt(e.target.value)} aria-label="Leave at" />}
                </div>
                {err && <div className="alert err" role="alert">{err}</div>}
                <button className="btn primary big block" onClick={build} disabled={busy || !picked.length}>{busy ? "Building route…" : `Build today's route${picked.length ? ` (${picked.length})` : ""}`}</button>
                {todayPlan && <button className="btn ghost block" onClick={() => setEditing(false)}>Keep current route</button>}
              </div>
            </>
          )}
        </section>

        <section className="pane" id="result">
          <SubdivisionMap subs={mapSubs} picked={mapPicked} order={planOrder}
            origin={planOrder ? todayPlan?.origin : null} destination={planOrder ? todayPlan?.destination : null}
            polylines={planOrder ? todayPlan?.polylines : undefined}
            onToggle={planOrder ? undefined : (id => toggle([id], !chosen.has(id)))} />
          {!todayPlan ? (
            <div className="pad muted">{plan ? `Your last route was for ${new Date(plan.createdAt).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}. Pick today's subdivisions to plan a new one.` : "Pick today's subdivisions and a start point. Stops are put in the quickest order using live drive times and each subdivision's section count."}</div>
          ) : (
            <>
              <div className="totals">
                <div><span className="eyebrow">Stops</span><b>{todayPlan.stops.length}</b></div>
                <div><span className="eyebrow">Driving</span><b>{fmtMin(todayPlan.totals.driveMin)}</b></div>
                <div><span className="eyebrow">On site</span><b>{fmtMin(todayPlan.totals.workMin)}</b></div>
                <div><span className="eyebrow">Finish ≈</span><b>{fmtTime(todayPlan.totals.finishAt)}</b></div>
              </div>
              <div className="pad stack" style={{ gap: 10 }}>
                <div className="muted small">{todayPlan.totals.miles.toFixed(0)} mi · {todayPlan.minutesPerSection} min per section · {todayPlan.source === "google" ? "live Google drive times" : "estimated drive times"}</div>
                {todayPlan.note && <div className="alert">{todayPlan.note}</div>}
                {remaining.length > 0 ? <div className="row">
                  {legLinks.map((l, i) => <a key={i} className={`btn ${i === 0 ? "primary" : ""}`} href={l.url} target="_blank" rel="noopener">
                    {l.from === -1 ? "Drive to finish" : l.from === l.to ? `Go to stop ${l.from}` : `Stops ${l.from}–${l.to} in Google Maps`}</a>)}
                </div> : <div className="alert ok">Every stop on today's route is complete.</div>}
              </div>
              <ol className="timeline">
                <li className="tl"><span className="num" style={{ background: "var(--sign)" }}>S</span><div><b>{todayPlan.origin.label || "Start"}</b>
                  <div className="leg">Leave {fmtTime(new Date(new Date(todayPlan.stops[0]?.arriveAt || todayPlan.createdAt).getTime() - (todayPlan.stops[0]?.driveMin || 0) * 60000))}</div></div><span /></li>
                {todayPlan.stops.map((s, i) => {
                  const done = doneIds.has(s.id);
                  return (
                    <li key={s.id} className={`tl ${done ? "is-done" : ""}`}>
                      <span className="num">{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <b>{s.name}</b>{done && <span className="pill done" style={{ marginLeft: 6 }}>Done</span>}
                        <div className="leg">{fmtMin(s.driveMin)} drive · {s.driveMiles.toFixed(1)} mi · arrive ≈ {fmtTime(s.arriveAt)}</div>
                        <div className="leg">{s.sections} section{s.sections === 1 ? "" : "s"} · about {fmtMin(s.workMin)} there</div>
                      </div>
                      {!done && <a className="btn sm" href={mapsLink(s)} target="_blank" rel="noopener">Navigate</a>}
                    </li>);
                })}
                {todayPlan.destination && todayPlan.finalLeg && (
                  <li className="tl"><span className="num end">E</span><div><b>{todayPlan.destination.label || todayPlan.destination.address || "Finish"}</b>
                    <div className="leg">{fmtMin(todayPlan.finalLeg.driveMin)} drive · arrive ≈ {fmtTime(todayPlan.totals.finishAt)}</div></div><span /></li>)}
              </ol>
            </>
          )}
        </section>
      </div>
    </>
  );
}

export default function Page() {
  return <DriverShell><Planner /></DriverShell>;
}
