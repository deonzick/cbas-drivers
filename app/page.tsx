"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DriverShell, useToast } from "@/components/Shell";
import { useAuth } from "@/components/Auth";
import { isComplete, isSubDone, openCount, useDrive, type Subdivision } from "@/lib/useDrive";
import { supabase } from "@/lib/supabase";
import { cache } from "@/lib/offline";
import { hasPin, mapsLink } from "@/lib/geo";
import { isToday, sectionShort } from "@/lib/format";
import { DueBanner } from "@/components/DueBanner";
import type { PlanResult } from "@/lib/route";

const stamp = (iso: string) => new Date(iso).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

function Ring({ done, total }: { done: number; total: number }) {
  const r = 18, c = 2 * Math.PI * r, p = total ? done / total : 0;
  return (
    <svg className="ring" viewBox="0 0 44 44" aria-label={`${done} of ${total} sections done`}>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--sunk)" strokeWidth="5" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--sign)" strokeWidth="5" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 22 22)" strokeLinecap="round" />
      <text x="22" y="26" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--fg)" fontFamily="var(--f-display)">{done}/{total}</text>
    </svg>
  );
}

function SubRow({ s, open, onToggle, stopNo, onSections, onScanned }: {
  s: Subdivision; open: boolean; onToggle: () => void; stopNo?: number;
  onSections: (ids: string[], done: boolean) => void; onScanned: (done: boolean) => void;
}) {
  const done = s.sections.filter(x => x.completed_at).length;
  const complete = isSubDone(s);
  const [confirmAll, setConfirmAll] = useState(false);
  const hasNew = s.sections.some(x => x.kinds.includes("new"));
  const hasBtr = s.sections.some(x => x.kinds.includes("btr"));
  return (
    <li id={`s-${s.id}`} className={`sub ${complete && s.scanned_at ? "is-done" : ""}`}>
      <div className="sub-row" onClick={onToggle} role="button" aria-expanded={open} tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="sub-name">{s.name}</span>
            {complete && (s.scanned_at
              ? <span className="pill scan">Complete</span>
              : <><span className="pill done">Driven</span><span className="pill plan">Needs scan</span></>)}
            {!complete && stopNo && <span className="pill plan">Today #{stopNo}</span>}
            {hasNew && <span className="pill new">New</span>}
            {hasBtr && <span className="pill btr">BTR</span>}
          </div>
          <div className="meta">
            <span>{s.city || s.county}</span>
            <span>{s.sections.length} section{s.sections.length === 1 ? "" : "s"}{!complete && done ? ` · ${s.sections.length - done} left` : ""}</span>
            {!hasPin(s) && <span className="pill warn">No pin</span>}
          </div>
        </div>
        <Ring done={done} total={s.sections.length} />
      </div>
      {open && (
        <div className="secs">
          <div className="sec-grid">
            {s.sections.map(x => {
              const l = sectionShort(x.label);
              return (
                <label key={x.id} className={`sec ${x.completed_at ? "is-done" : ""}`}>
                  <input type="checkbox" className="check sm" checked={!!x.completed_at} onChange={e => onSections([x.id], e.target.checked)}
                    aria-label={`${l.phase ? l.phase + " " : ""}Section ${l.sec}`} />
                  <span className="sec-txt">
                    {l.phase && <span className="ph">{l.phase}</span>}
                    <span className="sec-label">{l.phase ? `Sec ${l.sec}` : l.sec === "All" ? "Whole sub" : `Sec ${l.sec}`}</span>
                    {x.completed_at && <span className="stamp">✓ {stamp(x.completed_at)}</span>}
                  </span>
                  <span className="kinds">{x.kinds.filter(k => k !== "active").map(k => <i key={k} className={`k-${k}`} title={k.toUpperCase()} />)}</span>
                  {hasPin(x) && <a className="go" href={mapsLink(x)} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>Go</a>}
                </label>);
            })}
          </div>
          <div className="row">
            {hasPin(s) && <a className="btn primary" href={mapsLink(s)} target="_blank" rel="noopener">Navigate</a>}
            {!complete && (confirmAll
              ? <span className="row"><span className="small">Check all {s.sections.length - done} remaining?</span>
                  <button className="btn sm primary" onClick={() => { onSections(s.sections.filter(x => !x.completed_at).map(x => x.id), true); setConfirmAll(false); }}>Check all</button>
                  <button className="btn sm ghost" onClick={() => setConfirmAll(false)}>Cancel</button></span>
              : <button className="btn sm ghost" onClick={() => setConfirmAll(true)}>Check all sections</button>)}
          </div>
          {complete && (
            <label className={`scanbox ${s.scanned_at ? "is-done" : ""}`}>
              <input type="checkbox" className="check" checked={!!s.scanned_at} onChange={e => onScanned(e.target.checked)} />
              <span className="grow"><b>Scanned into TurboScan</b>
                <span className="small muted" style={{ display: "block" }}>{s.scanned_at ? `✓ ${stamp(s.scanned_at)}` : "Check once this subdivision's plat is scanned."}</span></span>
            </label>)}
          <p className="muted small" style={{ margin: 0 }}>Tap a checked section again to uncheck it. Each change is time-stamped.{complete && s.scanned_at ? " Unchecking a section also clears Scanned." : ""}</p>
        </div>
      )}
    </li>
  );
}

function Home() {
  const { profile, quarter, dueDate } = useAuth();
  const { subs, loading, error, setSections, setScanned } = useDrive(profile?.id, quarter?.id);
  const [filter, setFilter] = useState<"open" | "scan" | "done" | "all">("open");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [toast, say] = useToast();

  useEffect(() => {
    if (!profile || !quarter) return;
    const k = `plan-${profile.id}`;
    const c = cache.get<{ plan: PlanResult; quarter_id: string }>(k);
    if (c && c.quarter_id === quarter.id) setPlan(c.plan);
    supabase().from("route_plans").select("plan,quarter_id").eq("driver_id", profile.id).maybeSingle()
      .then(({ data }) => { if (data && data.quarter_id === quarter.id) { setPlan(data.plan as PlanResult); cache.set(k, data); } }, () => {});
  }, [profile, quarter]);

  const todayPlan = plan && isToday(plan.createdAt) ? plan : null;
  const stopNo = useMemo(() => {
    const m = new Map<string, number>(); todayPlan?.stops.forEach((s, i) => m.set(s.id, i + 1)); return m;
  }, [todayPlan]);

  const totalSecs = subs.reduce((n, s) => n + s.sections.length, 0);
  const doneSecs = subs.reduce((n, s) => n + s.sections.filter(x => x.completed_at).length, 0);
  const doneSubs = subs.filter(isSubDone).length;            // driven
  const scanned = subs.filter(isComplete).length;              // driven + scanned = complete
  const pct = subs.length ? Math.round((scanned / subs.length) * 100) : 0;
  const nextStop = todayPlan?.stops.map(p => subs.find(s => s.id === p.id)).find(s => s && !isSubDone(s));

  const shown = subs
    .filter(s => filter === "all" ? true : filter === "done" ? isComplete(s) : filter === "scan" ? isSubDone(s) && !s.scanned_at : !isSubDone(s))
    .filter(s => !q || `${s.name} ${s.city} ${s.submarket}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (stopNo.get(a.id) ?? 999) - (stopNo.get(b.id) ?? 999) || a.sort - b.sort);
  const groups = new Map<string, Subdivision[]>();
  for (const s of shown) {
    const k = stopNo.has(s.id) && filter === "open" ? "Today's route" : (s.submarket || s.city || "Other");
    (groups.get(k) || groups.set(k, []).get(k)!).push(s);
  }

  function onSections(ids: string[], done: boolean) {
    const sub = subs.find(s => s.sections.some(x => ids.includes(x.id)));
    setSections(ids, done);
    if (done && sub && sub.sections.filter(x => !x.completed_at && !ids.includes(x.id)).length === 0) say(`${sub.name} driven. Check Scanned once it's in TurboScan.`);
    if (!done && sub && isSubDone(sub)) say(`${sub.name} reopened`);
  }

  const needScan = doneSubs - scanned;
  if (!quarter) return <div className="notice"><h2>No drive assigned yet</h2><p className="muted">Your manager hasn't started this quarter's drives. Check back once they upload your list.</p></div>;
  if (loading && !subs.length) return <p className="muted">Loading your subdivisions…</p>;

  return (
    <>
      <DueBanner dueDate={dueDate} />
      <section className="summary">
        <div><div className="eyebrow">{quarter.label} drive</div><h1>{profile?.full_name?.split(" ")[0] || "Your"}’s list</h1></div>
        <div><div className="stat">{doneSubs}<small> / {subs.length}</small></div><div className="eyebrow">Driven</div></div>
        <div><div className="stat">{scanned}<small> / {subs.length}</small></div><div className="eyebrow">Scanned</div></div>
        <div><div className="stat">{doneSecs}<small> / {totalSecs}</small></div><div className="eyebrow">Sections</div></div>
        <div className="meter"><div className="row" style={{ justifyContent: "space-between" }}><span className="eyebrow">Complete (driven + scanned)</span><span className="mono">{pct}%</span></div><div className="bar"><i style={{ width: `${pct}%` }} /></div></div>
      </section>

      {error && <div className="alert err" style={{ marginBottom: 12 }}>{error}</div>}

      {nextStop ? (
        <div className="pane pad row" style={{ marginBottom: 16, borderColor: "var(--amber)" }}>
          <div className="grow"><div className="eyebrow">Next stop today</div>
            <div className="sub-name">{nextStop.name}</div>
            <div className="meta">{openCount(nextStop)} section{openCount(nextStop) === 1 ? "" : "s"} left · {nextStop.city}</div></div>
          <button className="btn" onClick={() => { setFilter("open"); setOpenId(nextStop.id); setTimeout(() => document.getElementById(`s-${nextStop.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>Sections</button>
          {hasPin(nextStop) && <a className="btn primary" href={mapsLink(nextStop)} target="_blank" rel="noopener">Navigate</a>}
        </div>
      ) : subs.length > doneSubs && (
        <div className="pane pad row" style={{ marginBottom: 16 }}>
          <div className="grow"><b>{todayPlan ? "Today's route is done." : "No route planned for today."}</b>
            <div className="muted small">Pick the subdivisions you'll drive today and get them in the best order.</div></div>
          <Link className="btn primary" href="/plan">Plan today</Link>
        </div>
      )}

      {subs.length === 0 ? (
        <div className="notice"><h2>Nothing assigned to you yet</h2><p className="muted">When your manager uploads your {quarter.label} drive sheet, your subdivisions show up here.</p></div>
      ) : (
        <section className="pane">
          <div className="pane-h">
            <div className="seg" role="group" aria-label="Show">
              {(["open", "scan", "done", "all"] as const).map(f => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "open" ? `To drive (${subs.length - doneSubs})` : f === "scan" ? `To scan (${needScan})` : f === "done" ? `Complete (${scanned})` : "All"}
                </button>))}
            </div>
            <input type="search" placeholder="Search subdivisions" value={q} onChange={e => setQ(e.target.value)} style={{ flex: "1 1 180px", minHeight: 38 }} aria-label="Search subdivisions" />
          </div>
          <div className="pad legend" style={{ paddingBlock: 8 }}><span><i className="k-new" />New section</span><span><i className="k-btr" />BTR section</span><span>Tap a subdivision to check off sections</span></div>
          {shown.length === 0 && <div className="pad muted">{filter === "done" ? "Nothing complete yet. A subdivision is complete once it's driven and scanned." : filter === "scan" ? "Nothing waiting to be scanned." : filter === "open" ? "Every subdivision is driven." : "No matches."}</div>}
          {[...groups.entries()].map(([g, list]) => (
            <div key={g}>
              <div className="group-h"><span className="eyebrow">{g}</span><span className="eyebrow">{list.length}</span></div>
              <ul className="subs">
                {list.map(s => <SubRow key={s.id} s={s} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} stopNo={stopNo.get(s.id)} onSections={onSections}
                  onScanned={done => { setScanned(s.id, done); say(done ? `${s.name} complete` : `${s.name} marked not scanned`); }} />)}
              </ul>
            </div>
          ))}
        </section>
      )}
      {toast}
    </>
  );
}

export default function Page() {
  return <DriverShell><Home /></DriverShell>;
}
