"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell, useToast } from "@/components/Shell";
import { useAuth, type Profile, type Quarter } from "@/components/Auth";
import { useAdminData } from "@/lib/useAdminData";
import { DriverRow } from "@/components/admin/DriverRow";
import { isDriver } from "@/lib/roles";
import { api, supabase } from "@/lib/supabase";
import { dueText, fmtDate, sectionLabel } from "@/lib/format";

function suggestLabel(after?: string) {
  if (after) {
    const m = after.match(/^([1-4])Q(\d{2})$/);
    if (m) { const q = +m[1], y = +m[2]; return q === 4 ? `1Q${String(y + 1).padStart(2, "0")}` : `${q + 1}Q${m[2]}`; }
  }
  const d = new Date();
  return `${Math.floor(d.getMonth() / 3) + 1}Q${String(d.getFullYear()).slice(-2)}`;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
    <section className="pane pad stack">
      <div className="row"><h2 className="grow">Quarter calendar</h2>
        <div className="seg" role="group" aria-label="Year">{[thisYear, thisYear + 1, thisYear + 2].map(y => <button key={y} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}</div></div>
      <p className="muted small" style={{ margin: 0 }}>Set each quarter's drive dates once. When you start a quarter, its dates fill in from here.</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Quarter</th><th>Drives start</th><th>Drives due</th></tr></thead>
        <tbody>{labels.map(l => (
          <tr key={l}><td><b className="mono">{l}</b></td>
            <td><input type="date" aria-label={`${l} start`} value={rows[l]?.start || ""} onChange={e => setRows({ ...rows, [l]: { ...rows[l], start: e.target.value } })} /></td>
            <td><input type="date" aria-label={`${l} due`} value={rows[l]?.due || ""} onChange={e => setRows({ ...rows, [l]: { ...rows[l], due: e.target.value } })} /></td></tr>))}</tbody>
      </table></div>
      <div><button className="btn" onClick={save}>Save {year} dates</button></div>
    </section>
  );
}

function Overview() {
  const { quarter, reload: reloadAuth } = useAuth();
  const { people, uploads, stats, deadlines, quarters, loading, reload } = useAdminData(quarter);
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
      <div><div className="eyebrow">No active quarter</div><h1>Start the next drive cycle</h1></div>
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
      <QuarterCalendar presets={presets} onSaved={loadPresets} say={say} />
      {toast}
    </div>
  );

  const teamDue = quarter.due_date ? dueText(quarter.due_date) : null;
  const driversDone = drivers.filter(d => stats[d.id] && stats[d.id].subs > 0 && stats[d.id].scanned === stats[d.id].subs).length;

  return (
    <div className="stack">
      <section className="summary">
        <div><div className="eyebrow">Active quarter{teamDue ? ` · ${teamDue.text}` : ""}</div><h1>{quarter.label} drives</h1></div>
        <div><div className="stat">{all.subsDone}<small> / {all.subs}</small></div><div className="eyebrow">Driven</div></div>
        <div><div className="stat">{all.scanned}<small> / {all.subs}</small></div><div className="eyebrow">Scanned</div></div>
        <div><div className="stat">{driversDone}<small> / {drivers.length}</small></div><div className="eyebrow">Drivers complete</div></div>
        <div><div className="stat">{all.today}</div><div className="eyebrow">Sections today</div></div>
        <div className="meter">
          <div className="dual" style={{ gridTemplateColumns: "60px minmax(0,1fr) 44px" }}><span className="eyebrow">Driven</span><div className="bar"><i style={{ width: `${pct(all.subsDone, all.subs)}%` }} /></div><span className="mono">{pct(all.subsDone, all.subs)}%</span></div>
          <div className="dual" style={{ gridTemplateColumns: "60px minmax(0,1fr) 44px" }}><span className="eyebrow">Scanned</span><div className="bar"><i style={{ width: `${pct(all.scanned, all.subs)}%`, background: "var(--scan)" }} /></div><span className="mono">{pct(all.scanned, all.subs)}%</span></div>
        </div>
      </section>

      <section className="pane">
        <div className="pane-h"><h2 className="grow">Drivers</h2><Link className="btn sm primary" href="/admin/upload">Upload drive sheets</Link><button className="btn sm" onClick={reload}>Refresh</button></div>
        {!drivers.length && <div className="pad">No drivers yet. <Link href="/admin/drivers">Add your drivers</Link>, then upload each one's drive sheet.</div>}
        {drivers.map(d => (
          <DriverRow key={d.id} d={d} s={stats[d.id]} quarter={quarter} due={deadlines[d.id] || quarter.due_date} isOverride={!!deadlines[d.id]}
            uploads={uploads.filter(u => u.driver_id === d.id)} drivers={drivers} onChanged={reload} say={say} />))}
      </section>

      <section className="pane pad stack">
        <h2>Quarter dates</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ width: 190 }}><label htmlFor="ds">Drives start</label><input id="ds" type="date" value={dates.start} onChange={e => setDates({ ...dates, start: e.target.value })} /></div>
          <div className="field" style={{ width: 190 }}><label htmlFor="dd">Drives due</label><input id="dd" type="date" value={dates.due} onChange={e => setDates({ ...dates, due: e.target.value })} /></div>
          <button className="btn" disabled={busy} onClick={() => act({ action: "dates", id: quarter.id, startDate: dates.start || null, dueDate: dates.due || null }, "Dates saved")}>Save dates</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Drivers see a countdown to their due date. Open a driver above to give them a different date.</p>
        {presets.find(p => p.label === quarter.label) && <div><button className="btn sm ghost" onClick={() => { const p = presets.find(x => x.label === quarter.label)!; setDates({ start: p.start_date || "", due: p.due_date || "" }); }}>Fill from quarter calendar</button></div>}
      </section>

      <QuarterCalendar presets={presets} onSaved={loadPresets} say={say} />

      <section className="pane pad stack">
        <h2>Planning times</h2>
        <p className="muted small" style={{ margin: 0 }}>Used to estimate time on site when drivers plan their day.</p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ width: 170 }}><label htmlFor="mps">Minutes per section</label><input id="mps" type="number" min={0} max={60} value={settings.minutesPerSection} onChange={e => setSettings({ ...settings, minutesPerSection: Number(e.target.value) })} /></div>
          <div className="field" style={{ width: 170 }}><label htmlFor="mpst">Minutes per stop</label><input id="mpst" type="number" min={0} max={60} value={settings.minutesPerStop} onChange={e => setSettings({ ...settings, minutesPerStop: Number(e.target.value) })} /></div>
          <button className="btn" disabled={busy} onClick={() => act({ action: "settings", ...settings }, "Planning times saved")}>Save</button>
        </div>
      </section>

      <section className="pane pad stack">
        <h2>End of quarter</h2>
        <p className="muted small" style={{ margin: 0 }}>Closing {quarter.label} locks it as a read-only archive: drivers stop seeing it, nothing more can be checked off, and you can still open it, see who drove and scanned what, and download the CSV under Archive. Then start the next quarter and upload its sheets.</p>
        <div className="row"><button className="btn" onClick={downloadCsv}>Download {quarter.label} completion (CSV)</button>
          {!clearing && <button className="btn danger" onClick={() => setClearing(true)}>Close {quarter.label}…</button>}</div>
        {clearing && (
          <div className="confirm-box">
            <b>Drivers lose access to {quarter.label} and it becomes read-only.</b>
            <div className="field" style={{ maxWidth: 260 }}><label htmlFor="cf">Type {quarter.label} to confirm</label><input id="cf" type="text" value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())} /></div>
            <div className="row">
              <button className="btn danger solid" disabled={busy || confirm !== quarter.label} onClick={async () => { if (await act({ action: "close", id: quarter.id, confirm }, `${quarter.label} closed and archived`)) { setClearing(false); setConfirm(""); } }}>Close and archive {quarter.label}</button>
              <button className="btn ghost" onClick={() => { setClearing(false); setConfirm(""); }}>Cancel</button>
            </div>
          </div>)}
        {err && <div className="alert err">{err}</div>}
      </section>

      {quarters.some(q => q.closed_at) && (
        <section className="pane pad row">
          <div className="grow"><b>Archive</b><div className="muted small">{quarters.filter(q => q.closed_at).map(q => q.label).join(", ")}</div></div>
          <Link className="btn" href="/admin/archive">Open archive</Link>
        </section>)}
      {toast}
    </div>
  );
}

export default function Page() {
  return <AdminShell><Overview /></AdminShell>;
}
