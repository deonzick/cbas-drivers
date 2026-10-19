"use client";
import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/Shell";
import { useAuth, type Profile } from "@/components/Auth";
import { useAdminData } from "@/lib/useAdminData";
import { api } from "@/lib/supabase";
import type { ParseResult, ParsedPin, ParsedSubdivision } from "@/lib/parse/normalize";
import { sectionLabel } from "@/lib/format";
import { isDriver } from "@/lib/roles";

type Group = { key: string; rows: ParsedSubdivision[]; target: string };
type Job = {
  id: string; file: File; status: "reading" | "ready" | "saving" | "saved" | "error";
  result?: ParseResult; pins?: { pins: ParsedPin[]; skipped: string[] };
  groups: Group[]; error?: string; saved?: string; open: boolean;
};

const matchDriver = (people: Profile[], key: string) => {
  const k = key.trim().toLowerCase();
  if (!k) return undefined;
  return people.find(p => (p.driver_key || "").toLowerCase() === k)
    || people.find(p => p.full_name.toLowerCase() === k)
    || people.find(p => p.full_name.toLowerCase().split(" ")[0] === k);
};

function Upload() {
  const { quarter } = useAuth();
  const { people, uploads, reload } = useAdminData(quarter);
  const preset = useSearchParams().get("driver");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const drivers = people.filter(p => p.active && isDriver(p));

  const patch = (id: string, f: (j: Job) => Partial<Job>) => setJobs(js => js.map(j => j.id === id ? { ...j, ...f(j) } : j));

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const id = `${Date.now()}-${Math.random()}`;
      setJobs(js => [...js, { id, file, status: "reading", groups: [], open: true }]);
      try {
        const fd = new FormData(); fd.append("file", file);
        const res = await api<({ kind: "drive" } & ParseResult) | { kind: "pins"; pins: ParsedPin[]; skipped: string[] }>("/api/admin/parse", { method: "POST", body: fd });
        if (res.kind === "pins") { patch(id, () => ({ status: "ready", pins: { pins: res.pins, skipped: res.skipped } })); continue; }
        const result = res;
        const byKey = new Map<string, ParsedSubdivision[]>();
        for (const r of result.rows) (byKey.get(r.driver) || byKey.set(r.driver, []).get(r.driver)!).push(r);
        const groups: Group[] = [...byKey.entries()].map(([key, rows]) => ({
          key, rows, target: (byKey.size === 1 && preset) ? preset : (matchDriver(drivers, key)?.id || ""),
        }));
        patch(id, () => ({ status: "ready", result, groups }));
      } catch (e: any) { patch(id, () => ({ status: "error", error: e.message })); }
    }
  }

  async function savePins(job: Job) {
    patch(job.id, () => ({ status: "saving", error: undefined }));
    try {
      const r = await api<{ saved: number; applied: number; total: number }>("/api/admin/pins", { method: "POST", body: JSON.stringify({ pins: job.pins!.pins }) });
      patch(job.id, () => ({ status: "saved", open: false, saved: `${r.saved} section pins saved (${r.total} on file). ${r.applied} matched this quarter's sections; the rest apply when those subdivisions are uploaded.` }));
    } catch (e: any) { patch(job.id, () => ({ status: "ready", error: e.message })); }
  }

  async function save(job: Job) {
    if (!quarter) return;
    if (job.groups.some(g => !g.target)) { patch(job.id, () => ({ error: "Pick a driver for every group first." })); return; }
    patch(job.id, () => ({ status: "saving", error: undefined }));
    try {
      const notes: string[] = [];
      for (const g of job.groups) {
        const fd = new FormData();
        fd.append("file", job.file);
        fd.append("payload", JSON.stringify({ driverId: g.target, quarterId: quarter.id, mode, rows: g.rows }));
        const r = await api<{ subdivisions: number; sections: number; kept: number }>("/api/admin/import", { method: "POST", body: fd });
        const who = people.find(p => p.id === g.target)?.full_name || "driver";
        notes.push(`${who}: ${r.subdivisions} subdivisions, ${r.sections} sections${r.kept ? ` (${r.kept} check-offs kept)` : ""}`);
      }
      patch(job.id, () => ({ status: "saved", saved: notes.join(" · "), open: false }));
      reload();
    } catch (e: any) { patch(job.id, () => ({ status: "ready", error: e.message })); }
  }

  if (!quarter) return <div className="notice"><h2>Start a quarter first</h2><p className="muted">Uploads attach to the active quarter. <Link href="/admin">Start one on the Overview page.</Link></p></div>;

  return (
    <div className="stack">
      <header className="page-h"><div className="eyebrow">{quarter.label} drive sheets</div><h1>Upload</h1></header>

      <div className={`drop ${over ? "over" : ""}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === "Enter") input.current?.click(); }}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
        <span className="drop-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 14v4a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4" /></svg></span>
        <b style={{ fontSize: 17, fontWeight: 600 }}>Choose Files</b>
        <span className="muted small">or drop them here · PDF, XLSX or CSV</span>
        <input ref={input} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,application/pdf" hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      <p className="group-foot" style={{ marginTop: -8 }}>One PDF per driver (the assignment sheet printed from Excel), or the Excel file itself. A file listing several drivers in its Driver column is split automatically. You'll see a preview before anything is saved.</p>

      <div>
        <div className="group-label">If a driver already has a {quarter.label} list</div>
        <div className="seg wide" role="group">
          <button aria-pressed={mode === "replace"} onClick={() => setMode("replace")}>Replace It</button>
          <button aria-pressed={mode === "add"} onClick={() => setMode("add")}>Add to It</button>
        </div>
        <p className="group-foot">{mode === "replace" ? "Check-offs on sections that appear in both are kept." : "New rows are added alongside the current list."}</p>
      </div>

      {jobs.map(job => {
        const rows = job.result?.rows || [];
        const warnCount = rows.filter(r => r.warnings.length).length;
        const secCount = rows.reduce((n, r) => n + r.sections.length, 0);
        return (
          <section className="pane" key={job.id}>
            <div className="pane-h">
              <span className={`file-ic ${/\.(xlsx?|csv)$/i.test(job.file.name) ? "xls" : ""}`}>{(job.file.name.split(".").pop() || "").toUpperCase().slice(0, 4)}</span>
              <div className="grow" style={{ minWidth: 0 }}><b style={{ overflowWrap: "anywhere", fontWeight: 600 }}>{job.file.name}</b>
                <div className="muted small">
                  {job.status === "reading" && "Reading…"}
                  {job.status === "error" && <span style={{ color: "var(--danger)" }}>{job.error}</span>}
                  {(job.status === "ready" || job.status === "saving") && `${rows.length} subdivisions · ${secCount} sections${warnCount ? ` · ${warnCount} need a look` : ""}`}
                  {job.status === "saved" && <span style={{ color: "var(--scan)" }}>✓ Saved — {job.saved}</span>}
                </div></div>
              {job.result && <button className="btn sm ghost" onClick={() => patch(job.id, j => ({ open: !j.open }))}>{job.open ? "Hide" : "Show"} preview</button>}
              {job.status !== "saved" && <button className="btn sm ghost" onClick={() => setJobs(js => js.filter(j => j.id !== job.id))}>Discard</button>}
            </div>
            {job.pins && job.status !== "saved" && (
              <div className="pad stack" style={{ gap: 10 }}>
                <div className="alert ok">This is a section-pins file: {job.pins.pins.length} section coordinates{job.pins.skipped.length ? `, ${job.pins.skipped.length} rows skipped for missing coordinates` : ""}. Pins are kept across quarters and added to matching sections automatically.</div>
                {job.error && <div className="alert err">{job.error}</div>}
                <div><button className="btn primary" disabled={job.status === "saving"} onClick={() => savePins(job)}>{job.status === "saving" ? "Saving…" : "Save section pins"}</button></div>
                <div className="tablewrap" style={{ maxHeight: 320, overflowY: "auto" }}><table>
                  <thead><tr><th>Subdivision</th><th>Section</th><th className="num">Lat, Long</th></tr></thead>
                  <tbody>{job.pins.pins.slice(0, 200).map((p, i) => <tr key={i}><td>{p.subdivision}</td><td>{sectionLabel(p.section)}</td><td className="num mono">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</td></tr>)}</tbody>
                </table></div>
              </div>)}
            {job.result && job.status !== "saved" && (
              <div className="pad stack" style={{ gap: 10 }}>
                {job.groups.map((g, gi) => {
                  const existing = uploads.filter(u => u.driver_id === g.target);
                  return (
                    <div key={gi} className="row">
                      <span className="small">Driver column “<b>{g.key || "blank"}</b>” · {g.rows.length} rows →</span>
                      <select value={g.target} style={{ width: "auto", minWidth: 200 }} aria-label="Assign to driver"
                        onChange={e => patch(job.id, j => ({ groups: j.groups.map((x, i) => i === gi ? { ...x, target: e.target.value } : x) }))}>
                        <option value="">Choose driver…</option>
                        {drivers.map(p => <option key={p.id} value={p.id}>{p.full_name}{p.driver_key ? ` (${p.driver_key})` : ""}</option>)}
                      </select>
                      {!g.target && <span className="pill warn">No matching driver</span>}
                      {existing.length > 0 && <span className="pill plan">{mode === "replace" ? "Replaces current list" : "Adds to current list"}</span>}
                    </div>);
                })}
                {job.result.warnings.map(w => <div key={w} className="alert">{w}</div>)}
                {job.error && <div className="alert err">{job.error}</div>}
                <div className="row">
                  <button className="btn primary" disabled={job.status === "saving" || !rows.length} onClick={() => save(job)}>{job.status === "saving" ? "Saving…" : `Save to ${quarter.label}`}</button>
                  {!drivers.length && <span className="small">No drivers yet. <Link href="/admin/drivers">Add drivers</Link> first.</span>}
                </div>
              </div>)}
            {job.result && job.open && (
              <div className="tablewrap"><table>
                <thead><tr><th>Subdivision</th><th>City</th><th>SubMkt</th><th>Sections</th><th className="num">Lat, Long</th><th>Check</th></tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={i}>
                    <td><b>{r.name}</b></td><td>{r.city}</td><td className="small">{r.submarket}</td>
                    <td style={{ maxWidth: 360 }}><div className="row" style={{ gap: 4 }}>{r.sections.map(s => (
                      <span key={s.label} className={`pill ${s.kinds.includes("new") ? "new" : s.kinds.includes("btr") ? "btr" : ""}`} style={!s.kinds.some(k => k !== "active") ? { background: "var(--sunk)" } : undefined}
                        title={s.kinds.join(" + ").toUpperCase()}>{sectionLabel(s.label)}</span>))}</div></td>
                    <td className="num mono">{r.lat !== null ? `${r.lat.toFixed(5)}, ${r.lng!.toFixed(5)}` : "—"}</td>
                    <td>{r.warnings.length ? r.warnings.map(w => <span key={w} className="pill warn">{w}</span>) : <span className="pill done">OK</span>}</td>
                  </tr>))}</tbody>
              </table></div>)}
          </section>);
      })}
      {jobs.length > 0 && <div className="legend" style={{ padding: "0 16px" }}><span><i className="k-new" />New section</span><span><i className="k-btr" />BTR section</span><span>Grey = active section</span></div>}

      <div>
        <div className="group-label">Section pins (optional)</div>
        <section className="pane pad">
        <p className="muted small" style={{ margin: 0 }}>When you're ready to add section coordinates, drop a file here with the columns <span className="mono">Subdivision, Section, Latitude, Longitude</span> (one row per section, e.g. “Lago Mar, P8S9A, 29.41, -95.04”). Sections with a pin get their own Go button for drivers. Pins are remembered across quarters, so you only upload them once.</p>
        </section>
      </div>
      <p className="group-foot">Columns: County, City, CBAS_Mkt, CBAS_SubMkt, Subdivision, New / Active / BTR Section(s), Latitude, Longitude, Driver.</p>
    </div>
  );
}

export default function Page() {
  return <AdminShell><Suspense><Upload /></Suspense></AdminShell>;
}
