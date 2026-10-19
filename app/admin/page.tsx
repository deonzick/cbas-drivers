"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell, useToast } from "@/components/Shell";
import { useAuth } from "@/components/Auth";
import { useAdminData } from "@/lib/useAdminData";
import { StatusPie } from "@/components/admin/StatusPie";
import { Disclosure } from "@/components/Disclosure";
import { isDriver } from "@/lib/roles";
import { api, supabase } from "@/lib/supabase";
import { dueText, fmtDate } from "@/lib/format";

function suggestLabel(after?: string) {
  if (after) {
    const m = after.match(/^([1-4])Q(\d{2})$/);
    if (m) { const q = +m[1], y = +m[2]; return q === 4 ? `1Q${String(y + 1).padStart(2, "0")}` : `${q + 1}Q${m[2]}`; }
  }
  const d = new Date();
  return `${Math.floor(d.getMonth() / 3) + 1}Q${String(d.getFullYear()).slice(-2)}`;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
type Preset = { label: string; start_date: string | null; due_date: string | null };

/** Saved quarter dates per year (1Q–4Q), used to prefill each quarter when it starts. */
function QuarterCalendar({ presets, onSaved, say }: { presets: Preset[]; onSaved: () => void; say: (m: string) => void }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear + (new Date().getMonth() >= 9 ? 1 : 0));
  const yy = String(year).slice(-2);
  const labels = [1, 2, 3, 4].map(q => `${q}Q${yy}`);
  const [rows, setRows] = useState<Record<string, { start: string; due: string }>>({});
  useEffect(() => {
    const r: Record<string, { start: string; due: string }> = {};
    for (const l of labels) { const p = presets.find(x => x.label === l); r[l] = { start: p?.start_date || "", due: p?.due_date || "" }; }
    setRows(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, presets]);
  async function save() {
    try {
      await api("/api/admin/quarter", { method: "POST", body: JSON.stringify({ action: "presets", rows: labels.map(l => ({ label: l, startDate: rows[l]?.start, dueDate: rows[l]?.due })) }) });
      say(`${year} quarter dates saved`); onSaved();
    } catch (e: any) { say(e.message); }
  }
  return (
    <div className="stack">
      <div className="row"><span className="grow muted small">Set each quarter's drive dates once. When you start a quarter, its dates fill in from here.</span>
        <div className="seg" role="group" aria-label="Year">{[thisYear, thisYear + 1, thisYear + 2].map(y => <button key={y} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}</div></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Quarter</th><th>Drives start</th><th>Drives due</th></tr></thead>
        <tbody>{labels.map(l => (
          <tr key={l}><td><b className="mono">{l}</b></td>
            <td><input type="date" aria-label={`${l} start`} value={rows[l]?.start || ""} onChange={e => setRows({ ...rows, [l]: { ...rows[l], start: e.target.value } })} /></td>
            <td><input type="date" aria-label={`${l} due`} value={rows[l]?.due || ""} onChange={e => setRows({ ...rows, [l]: { ...rows[l], due: e.target.value } })} /></td></tr>))}</tbody>
      </table></div>
      <div><button className="btn" onClick={save}>Save {year} dates</button></div>
    </div>
  );
}

function Overview() {
  const { quarter, reload: reloadAuth } = useAuth();
  const { people, stats, quarters, loading, reload } = useAdminData(quarter);
  const [toast, say] = useToast();
  const [label, setLabel] = useState("");
  const [newStart, setNewStart] = useState(""); const [newDue, setNewDue] = useState("");
  const [dates, setDates] = useState({ start: "", due: "" });
  const [confirm, setConfirm] = useState("");
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [settings, setSettings] = useState({ minutesPerSection: 5, minutesPerStop: 3 });
  const [presets, setPresets] = useState<Preset[]>([]);
  const loadPresets = () => { supabase().from("quarter_presets").select("*").then(({ data }) => setPresets((data as Preset[]) || [])); };
  useEffect(loadPresets, []);
  useEffect(() => {
    const p = presets.find(x => x.label === label);
    if (p) { setNewStart(p.start_date || ""); setNewDue(p.due_date || ""); }
  }, [label, presets]);

  const lastClosed = quarters.find(q => q.closed_at);
  useEffect(() => { setLabel(suggestLabel(lastClosed?.label)); }, [lastClosed?.label]);
  useEffect(() => { if (quarter) setDates({ start: quarter.start_date || "", due: quarter.due_date || "" }); }, [quarter]);
  useEffect(() => {
    supabase().from("app_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      if (data) setSettings({ minutesPerSection: Number(data.minutes_per_section), minutesPerStop: Number(data.minutes_per_stop) });
    });
  }, []);

  const drivers = people.filter(isDriver);
  const all = Object.values(stats).reduce((a, s) => ({ secs: a.secs + s.secs, done: a.done + s.secsDone, subs: a.subs + s.subs, subsDone: a.subsDone + s.subsDone, scanned: a.scanned + s.scanned, today: a.today + s.doneToday }), { secs: 0, done: 0, subs: 0, subsDone: 0, scanned: 0, today: 0 });

  async function act(body: object, okMsg: string) {
    setErr(null); setBusy(true);
    try { await api("/api/admin/quarter", { method: "POST", body: JSON.stringify(body) }); say(okMsg); await reloadAuth(); await reload(); return true; }
    catch (e: any) { setErr(e.message); return false; }
    finally { setBusy(false); }
  }
  async function downloadCsv() {
    if (!quarter) return;
    const { data } = await supabase().auth.getSession();
    const res = await fetch(`/api/admin/quarter?id=${quarter.id}`, { headers: { Authorization: `Bearer ${data.session?.access_token}` } });
    if (!res.ok) return say("Couldn't build the report.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `${quarter.label}-drive-completion.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  if (loading) return <p className="muted">Loading…</p>;

  if (!quarter) return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <header className="page-h"><div className="eyebrow">No active quarter</div><h1>Start the next drive cycle</h1></header>
      <div className="pane pad stack">
        <p className="muted" style={{ margin: 0 }}>Drivers see nothing until a quarter is active and their drive sheet is uploaded.</p>
        <div className="form-grid">
          <div className="field"><label htmlFor="ql">Quarter label</label><input id="ql" type="text" value={label} onChange={e => setLabel(e.target.value.toUpperCase())} placeholder="1Q27" /></div>
          <div className="field"><label htmlFor="qs">Drives start</label><input id="qs" type="date" value={newStart} onChange={e => setNewStart(e.target.value)} /></div>
          <div className="field"><label htmlFor="qd">Drives due</label><input id="qd" type="date" value={newDue} onChange={e => setNewDue(e.target.value)} /></div>
        </div>
        {err && <div className="alert err">{err}</div>}
        {presets.find(p => p.label === label) && <span className="muted small">Dates filled from your quarter calendar.</span>}
        <div><button className="btn primary" disabled={busy} onClick={() => act({ action: "start", label, startDate: newStart || null, dueDate: newDue || null }, `${label} started`)}>Start {label || "quarter"}</button></div>
      </div>
      <div className="group">
        <Disclosure title="Quarter calendar" value={`${presets.length} saved`}><QuarterCalendar presets={presets} onSaved={loadPresets} say={say} /></Disclosure>
      </div>
      {toast}
    </div>
  );

  const teamDue = quarter.due_date ? dueText(quarter.due_date) : null;
  const driversDone = drivers.filter(d => stats[d.id] && stats[d.id].subs > 0 && stats[d.id].scanned === stats[d.id].subs).length;
  const driversStarted = drivers.filter(d => stats[d.id] && stats[d.id].secsDone > 0).length - driversDone;
  const noSheet = drivers.filter(d => !stats[d.id]).length;
  const st = { complete: 0, toscan: 0, partial: 0, none: 0 };
  for (const ds of Object.values(stats)) for (const x of ds.list) {
    if (x.secs > 0 && x.done === x.secs) st[x.scanned ? "complete" : "toscan"]++;
    else st[x.done > 0 ? "partial" : "none"]++;
  }
  const preset = presets.find(p => p.label === quarter.label);
  const range = quarter.start_date || quarter.due_date
    ? `${quarter.start_date ? fmtDate(quarter.start_date, { month: "short", day: "numeric" }) : "?"} – ${quarter.due_date ? fmtDate(quarter.due_date, { month: "short", day: "numeric" }) : "?"}`
    : "Not set";

  return (
    <div className="stack">
      <header className="page-h">
        <div className="eyebrow">{quarter.start_date ? `Active quarter · ${range}` : "Active quarter"}</div>
        <div className="row" style={{ alignItems: "baseline" }}>
          <h1 className="grow">{quarter.label} Overview</h1>
          {teamDue && <span className={`pill lg ${teamDue.tone}`}>{teamDue.text}</span>}
        </div>
      </header>

      {!drivers.length || !all.subs ? (
        <div className="pane pad stack">
          <b>{drivers.length ? "No drive sheets uploaded yet." : "No drivers yet."}</b>
          <span className="muted small">{drivers.length ? "Upload each driver's sheet and their progress shows up here." : "Add your drivers, then upload each one's drive sheet."}</span>
          <div className="row">
            {!drivers.length && <Link className="btn primary" href="/admin/drivers?tab=logins">Add drivers</Link>}
            <Link className={`btn ${drivers.length ? "primary" : ""}`} href="/admin/upload">Upload drive sheets</Link>
          </div>
        </div>
      ) : (<>
        <div className="tiles">
          <div className="tile"><span className="tile-k">Driven</span><span className="tile-v">{all.subsDone}<small>/{all.subs}</small></span><div className="bar"><i style={{ width: `${pct(all.subsDone, all.subs)}%` }} /></div><span className="tile-s">{pct(all.subsDone, all.subs)}% of subdivisions</span></div>
          <div className="tile"><span className="tile-k">Scanned</span><span className="tile-v">{all.scanned}<small>/{all.subs}</small></span><div className="bar"><i style={{ width: `${pct(all.scanned, all.subs)}%`, background: "var(--scan)" }} /></div><span className="tile-s">{pct(all.scanned, all.subs)}% in TurboScan</span></div>
          <div className="tile"><span className="tile-k">Sections</span><span className="tile-v">{all.done.toLocaleString()}<small>/{all.secs.toLocaleString()}</small></span><div className="bar"><i style={{ width: `${pct(all.done, all.secs)}%` }} /></div><span className="tile-s">{all.today ? `${all.today} checked off today` : "None checked off today"}</span></div>
          <div className="tile"><span className="tile-k">Drivers complete</span><span className="tile-v">{driversDone}<small>/{drivers.length}</small></span><div className="bar"><i style={{ width: `${pct(driversDone, drivers.length)}%`, background: "var(--scan)" }} /></div><span className="tile-s">{driversStarted} driving{noSheet ? ` · ${noSheet} without a sheet` : ""}</span></div>
        </div>

        <section className="pane pad stack">
          <div className="row"><h2 className="grow">Status of every subdivision</h2><button className="btn sm gray" onClick={reload}>Refresh</button></div>
          <StatusPie center={`${pct(st.complete, all.subs)}%`} centerLabel="Complete" slices={[
            { key: "complete", label: "Complete", note: "Driven and scanned", value: st.complete, color: "var(--c-complete)" },
            { key: "toscan", label: "Needs scan", note: "Driven, not in TurboScan yet", value: st.toscan, color: "var(--c-toscan)" },
            { key: "partial", label: "In progress", note: "Some sections checked", value: st.partial, color: "var(--c-partial)" },
            { key: "none", label: "Not started", note: "No sections checked", value: st.none, color: "var(--c-none)" },
          ]} />
          <Link className="link-row" href="/admin/drivers">See each driver's progress<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 6l6 6-6 6" /></svg></Link>
        </section>
      </>)}

      <div>
        <div className="group-label">Quarter settings</div>
        <div className="group">
          <Disclosure title="Quarter dates" value={range}>
            <div className="stack">
              <div className="row" style={{ alignItems: "flex-end" }}>
                <div className="field" style={{ width: 190 }}><label htmlFor="ds">Drives start</label><input id="ds" type="date" value={dates.start} onChange={e => setDates({ ...dates, start: e.target.value })} /></div>
                <div className="field" style={{ width: 190 }}><label htmlFor="dd">Drives due</label><input id="dd" type="date" value={dates.due} onChange={e => setDates({ ...dates, due: e.target.value })} /></div>
                <button className="btn" disabled={busy} onClick={() => act({ action: "dates", id: quarter.id, startDate: dates.start || null, dueDate: dates.due || null }, "Dates saved")}>Save dates</button>
              </div>
              <span className="muted small">Every driver counts down to this due date.</span>
              {preset && <div><button className="btn sm gray" onClick={() => setDates({ start: preset.start_date || "", due: preset.due_date || "" })}>Fill from quarter calendar</button></div>}
            </div>
          </Disclosure>
          <Disclosure title="Quarter calendar" value={`${presets.filter(p => p.start_date || p.due_date).length} quarters saved`}>
            <QuarterCalendar presets={presets} onSaved={loadPresets} say={say} />
          </Disclosure>
          <Disclosure title="Planning times" value={`${settings.minutesPerSection} min per section`}>
            <div className="stack">
              <span className="muted small">Used to estimate time on site when drivers plan their day.</span>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <div className="field" style={{ width: 170 }}><label htmlFor="mps">Minutes per section</label><input id="mps" type="number" min={0} max={60} value={settings.minutesPerSection} onChange={e => setSettings({ ...settings, minutesPerSection: Number(e.target.value) })} /></div>
                <div className="field" style={{ width: 170 }}><label htmlFor="mpst">Minutes per stop</label><input id="mpst" type="number" min={0} max={60} value={settings.minutesPerStop} onChange={e => setSettings({ ...settings, minutesPerStop: Number(e.target.value) })} /></div>
                <button className="btn" disabled={busy} onClick={() => act({ action: "settings", ...settings }, "Planning times saved")}>Save</button>
              </div>
            </div>
          </Disclosure>
          <Disclosure title="Completion report" value="CSV">
            <div className="stack">
              <span className="muted small">Every subdivision with who drove it, when, and when it was scanned.</span>
              <div><button className="btn" onClick={downloadCsv}>Download {quarter.label} completion</button></div>
            </div>
          </Disclosure>
          <Disclosure title={`Close ${quarter.label}`} value="End of quarter" danger>
            <div className="stack">
              <span className="muted small">Closing {quarter.label} locks it as a read-only archive: drivers stop seeing it and nothing more can be checked off. You can still open it under Archive. Then start the next quarter and upload its sheets.</span>
              {!clearing && <div><button className="btn danger" onClick={() => setClearing(true)}>Close {quarter.label}…</button></div>}
              {clearing && (
                <div className="confirm-box">
                  <b>Drivers lose access to {quarter.label} and it becomes read-only.</b>
                  <div className="field" style={{ maxWidth: 260 }}><label htmlFor="cf">Type {quarter.label} to confirm</label><input id="cf" type="text" value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())} /></div>
                  <div className="row">
                    <button className="btn danger solid" disabled={busy || confirm !== quarter.label} onClick={async () => { if (await act({ action: "close", id: quarter.id, confirm }, `${quarter.label} closed and archived`)) { setClearing(false); setConfirm(""); } }}>Close and archive {quarter.label}</button>
                    <button className="btn gray" onClick={() => { setClearing(false); setConfirm(""); }}>Cancel</button>
                  </div>
                </div>)}
            </div>
          </Disclosure>
          {quarters.some(q => q.closed_at) && (
            <Link className="disc-link" href="/admin/archive"><span className="grow">Archive</span><span className="disc-value">{quarters.filter(q => q.closed_at).map(q => q.label).join(", ")}</span>
              <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 6l6 6-6 6" /></svg></Link>)}
        </div>
        {err && <div className="alert err" style={{ marginTop: 12 }}>{err}</div>}
      </div>
      {toast}
    </div>
  );
}

export default function Page() {
  return <AdminShell><Overview /></AdminShell>;
}
