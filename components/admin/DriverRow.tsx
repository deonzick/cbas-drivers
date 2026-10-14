"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Profile, Quarter } from "@/components/Auth";
import type { DriverStats, SubProgress, Upload } from "@/lib/useAdminData";
import { api, supabase } from "@/lib/supabase";
import { dueText, fmtDate, sectionLabel } from "@/lib/format";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

type Event = { happened_at: string; done: boolean; sections: { label: string; subdivisions: { name: string } } };
type View = "all" | "todrive" | "toscan" | "complete";
const stateOf = (x: SubProgress): Exclude<View, "all"> =>
  x.secs > 0 && x.done === x.secs ? (x.scanned ? "complete" : "toscan") : "todrive";

export function AddSubdivision({ driverId, quarter, onDone }: { driverId: string; quarter: Quarter; onDone: () => void }) {
  const blank = { name: "", city: "", county: "", submarket: "", lat: "", lng: "", activeSections: "", newSections: "", btrSections: "" };
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setErr(null); setBusy(true);
    try { await api("/api/admin/subdivision", { method: "POST", body: JSON.stringify({ ...f, driverId, quarterId: quarter.id }) }); setF(blank); setOpen(false); onDone(); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  if (!open) return <div className="card" style={{ alignContent: "start" }}><b>Add a subdivision</b><span className="muted small">For the occasional addition mid-drive. Bigger changes: re-upload the sheet.</span><div><button className="btn sm" onClick={() => setOpen(true)}>Add subdivision</button></div></div>;
  return (
    <div className="card" style={{ alignContent: "start" }}>
      <b>Add a subdivision</b>
      <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        <div className="field"><label>Subdivision</label><input type="text" value={f.name} onChange={set("name")} /></div>
        <div className="field"><label>City</label><input type="text" value={f.city} onChange={set("city")} /></div>
        <div className="field"><label>County</label><input type="text" value={f.county} onChange={set("county")} /></div>
        <div className="field"><label>CBAS_SubMkt</label><input type="text" value={f.submarket} onChange={set("submarket")} /></div>
        <div className="field"><label>Latitude</label><input type="text" inputMode="decimal" value={f.lat} onChange={set("lat")} /></div>
        <div className="field"><label>Longitude</label><input type="text" inputMode="decimal" value={f.lng} onChange={set("lng")} /></div>
      </div>
      <div className="field"><label>Active section(s)</label><input type="text" placeholder="1, 2, 3 or P8S9A, P8S9B" value={f.activeSections} onChange={set("activeSections")} /></div>
      <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        <div className="field"><label>New section(s)</label><input type="text" value={f.newSections} onChange={set("newSections")} /></div>
        <div className="field"><label>BTR section(s)</label><input type="text" value={f.btrSections} onChange={set("btrSections")} /></div>
      </div>
      {err && <div className="alert err">{err}</div>}
      <div className="row"><button className="btn sm primary" disabled={busy} onClick={save}>{busy ? "Adding…" : "Add to this driver"}</button><button className="btn sm ghost" onClick={() => { setOpen(false); setErr(null); }}>Cancel</button></div>
    </div>
  );
}

/** One driver on the manager dashboard (or the read-only archive): a summary line that
 *  opens into what they've driven and what they've scanned, subdivision by subdivision. */
export function DriverRow({ d, s, quarter, due, isOverride, uploads, drivers, onChanged, say, readOnly = false }: {
  d: Profile; s?: DriverStats; quarter: Quarter; due: string | null; isOverride: boolean; uploads: Upload[];
  drivers: Profile[]; onChanged: () => void; say: (m: string) => void; readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [dueInput, setDueInput] = useState(isOverride ? due || "" : "");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("all");
  const dt = !readOnly && due ? dueText(due) : null;
  const complete = !!s && s.subs > 0 && s.scanned === s.subs;

  useEffect(() => {
    if (!open || events) return;
    const ids = (s?.list || []).map(x => x.id);
    if (!ids.length) { setEvents([]); return; }
    supabase().from("section_events").select("happened_at,done,sections!inner(label,subdivision_id,subdivisions(name))")
      .eq("driver_id", d.id).in("sections.subdivision_id", ids.slice(0, 300)).order("happened_at", { ascending: false }).limit(12)
      .then(({ data }) => setEvents((data as any) || []), () => setEvents([]));
  }, [open, events, d.id, s]);

  async function call(path: string, body: object, msg: string) {
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); say(msg); onChanged(); }
    catch (e: any) { say(e.message); }
  }
  async function viewFile(id: string) {
    try { const r = await api<{ url: string }>("/api/admin/quarter", { method: "POST", body: JSON.stringify({ action: "file-link", id }) }); window.open(r.url, "_blank"); }
    catch (e: any) { say(e.message); }
  }

  const counts = { todrive: 0, toscan: 0, complete: 0 };
  for (const x of s?.list || []) counts[stateOf(x)]++;
  const list = (s?.list || []).filter(x => view === "all" || stateOf(x) === view);
  const others = drivers.filter(o => o.id !== d.id && o.active);

  return (
    <details className="acc" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}><b>{d.full_name}</b>
            {complete && <span className="pill scan">Complete</span>}
            {!d.active && <span className="pill warn">Off</span>}
            {dt && !complete && <span className={`pill ${dt.tone === "ok" ? "" : dt.tone}`} style={dt.tone === "ok" ? { background: "var(--sunk)" } : undefined}>{dt.text}</span>}</div>
          <div className="muted small">{s
            ? `Driven ${s.subsDone}/${s.subs} · Scanned ${s.scanned}/${s.subs} · ${s.secsDone}/${s.secs} sections${!readOnly && s.doneToday ? ` · ${s.doneToday} today` : ""}`
            : `No ${quarter.label} drive sheet${readOnly ? "" : " yet"}`}</div>
        </div>
        <div className="acc-bar">{s && <>
          <div className="dual"><span className="muted small">Driven</span><div className="bar"><i style={{ width: `${pct(s.subsDone, s.subs)}%` }} /></div><span className="mono">{pct(s.subsDone, s.subs)}%</span></div>
          <div className="dual"><span className="muted small">Scanned</span><div className="bar"><i style={{ width: `${pct(s.scanned, s.subs)}%`, background: "var(--scan)" }} /></div><span className="mono">{pct(s.scanned, s.subs)}%</span></div>
        </>}</div>
        <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 6l6 6-6 6" /></svg>
      </summary>
      {open && (
        <div className="acc-body">
          {!readOnly && (
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ width: 190 }}><label htmlFor={`due-${d.id}`}>Due date for {d.full_name.split(" ")[0]}</label>
                <input id={`due-${d.id}`} type="date" value={dueInput} onChange={e => setDueInput(e.target.value)} /></div>
              <button className="btn sm" onClick={() => call("/api/admin/quarter", { action: "driver-due", quarterId: quarter.id, driverId: d.id, dueDate: dueInput || null }, "Due date saved")}>Save</button>
              {isOverride && <button className="btn sm ghost" onClick={() => { setDueInput(""); call("/api/admin/quarter", { action: "driver-due", quarterId: quarter.id, driverId: d.id, dueDate: null }, "Using the quarter due date"); }}>Use quarter date</button>}
              <span className="muted small">{isOverride ? "Custom date for this driver." : quarter.due_date ? `Using the quarter date (${fmtDate(quarter.due_date)}).` : "No due date set."}</span>
            </div>)}

          {s ? (<>
            <div className="seg" role="group" aria-label="Show">
              <button aria-pressed={view === "all"} onClick={() => setView("all")}>All ({s.subs})</button>
              <button aria-pressed={view === "todrive"} onClick={() => setView("todrive")}>Not driven ({counts.todrive})</button>
              <button aria-pressed={view === "toscan"} onClick={() => setView("toscan")}>Driven, not scanned ({counts.toscan})</button>
              <button aria-pressed={view === "complete"} onClick={() => setView("complete")}>Complete ({counts.complete})</button>
            </div>
            <div className="tablewrap pane"><table>
              <thead><tr><th>Subdivision</th><th>Driven</th><th>Scanned</th>{!readOnly && <th></th>}</tr></thead>
              <tbody>
                {!list.length && <tr><td colSpan={4} className="muted">Nothing here.</td></tr>}
                {list.map(x => {
                  const st = stateOf(x);
                  return (
                    <tr key={x.id}>
                      <td><b>{x.name}</b><div className="muted small">{x.submarket}</div></td>
                      <td style={{ minWidth: 150 }}>
                        {st === "todrive"
                          ? <div className="dual" style={{ gridTemplateColumns: "minmax(60px,1fr) auto" }}><div className="bar"><i style={{ width: `${pct(x.done, x.secs)}%`, background: "var(--amber)" }} /></div><span className="mono">{x.done}/{x.secs} sec</span></div>
                          : <span className="pill done">✓ {x.drivenAt ? day(x.drivenAt) : "Driven"}</span>}
                      </td>
                      <td>{x.scanned ? <span className="pill scan">✓ {day(x.scanned)}</span> : st === "toscan" ? <span className="pill plan">Needs scan</span> : <span className="muted">—</span>}</td>
                      {!readOnly && (
                        <td style={{ whiteSpace: "nowrap" }}>
                          {confirm === `move-${x.id}` ? (
                            <span className="row" style={{ flexWrap: "nowrap" }}>
                              <select aria-label="Move to driver" value={moveTo[x.id] || ""} onChange={e => setMoveTo({ ...moveTo, [x.id]: e.target.value })} style={{ minHeight: 34, width: "auto" }}>
                                <option value="">Move to…</option>
                                {others.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                              </select>
                              <button className="btn sm primary" disabled={!moveTo[x.id]}
                                onClick={() => { const to = moveTo[x.id]; setConfirm(null); call("/api/admin/subdivision", { action: "reassign", id: x.id, toDriverId: to }, `${x.name} moved to ${others.find(o => o.id === to)?.full_name}`); }}>Move</button>
                              <button className="btn sm ghost" onClick={() => setConfirm(null)}>Cancel</button>
                            </span>
                          ) : confirm === `del-${x.id}` ? (
                            <span className="row" style={{ flexWrap: "nowrap" }}>
                              <button className="btn sm danger solid" onClick={() => { setConfirm(null); call("/api/admin/subdivision", { action: "delete", id: x.id }, `${x.name} removed`); }}>Remove</button>
                              <button className="btn sm ghost" onClick={() => setConfirm(null)}>Keep</button>
                            </span>
                          ) : (
                            <span className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
                              <button className="btn sm" onClick={() => setConfirm(`move-${x.id}`)}>Reassign</button>
                              <button className="btn sm ghost" aria-label={`Remove ${x.name}`} onClick={() => setConfirm(`del-${x.id}`)}>✕</button>
                            </span>
                          )}
                        </td>)}
                    </tr>);
                })}
              </tbody>
            </table></div>

            <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
              <div className="card" style={{ alignContent: "start" }}>
                <b>Recent check-offs</b>
                {!events && <span className="muted small">Loading…</span>}
                {events && !events.length && <span className="muted small">Nothing yet.</span>}
                {events?.map((e, i) => (
                  <div key={i} className="mini" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                    <span style={{ minWidth: 0 }}>{e.done ? "✓" : "↺ Unchecked"} {e.sections?.subdivisions?.name} · {sectionLabel(e.sections?.label || "")}</span>
                    <span className="muted small" style={{ whiteSpace: "nowrap" }}>{when(e.happened_at)}</span>
                  </div>))}
              </div>
              <div className="card" style={{ alignContent: "start" }}>
                <b>Drive sheet</b>
                {!uploads.length && <span className="muted small">Added by hand or reassigned from another driver.</span>}
                {uploads.map(u => (
                  <div key={u.id} className="row small">
                    <span className="grow" style={{ overflowWrap: "anywhere" }}>{u.file_name}</span>
                    {u.storage_path && <button className="btn sm ghost" onClick={() => viewFile(u.id)}>View</button>}
                    {!readOnly && (confirm === u.id
                      ? <><button className="btn sm danger solid" onClick={() => { setConfirm(null); call("/api/admin/quarter", { action: "delete-upload", id: u.id }, "Drive sheet removed"); }}>Delete</button><button className="btn sm ghost" onClick={() => setConfirm(null)}>Keep</button></>
                      : <button className="btn sm ghost" onClick={() => setConfirm(u.id)}>Remove</button>)}
                  </div>))}
                {!readOnly && <Link className="btn sm" href={`/admin/upload?driver=${d.id}`}>Replace drive sheet</Link>}
              </div>
              {!readOnly && <AddSubdivision driverId={d.id} quarter={quarter} onDone={() => { onChanged(); say("Subdivision added"); }} />}
            </div>
          </>) : !readOnly && <div><Link className="btn sm primary" href={`/admin/upload?driver=${d.id}`}>Upload {d.full_name.split(" ")[0]}'s drive sheet</Link></div>}
        </div>
      )}
    </details>
  );
}
