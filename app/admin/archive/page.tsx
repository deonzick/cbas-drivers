"use client";
import { useEffect, useState } from "react";
import { AdminShell, useToast } from "@/components/Shell";
import type { Quarter } from "@/components/Auth";
import { DriverRow } from "@/components/admin/DriverRow";
import { useAdminData } from "@/lib/useAdminData";
import { api, supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
type Summary = Record<string, { subdivisions: number; driven?: number; scanned?: number; sections: number; done: number }>;

function Archive() {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [sel, setSel] = useState<Quarter | null>(null);
  const [toast, say] = useToast();
  const [purging, setPurging] = useState(false);
  const [confirm, setConfirm] = useState("");

  const loadQuarters = () => supabase().from("quarters").select("*").not("closed_at", "is", null).order("closed_at", { ascending: false })
    .then(({ data }) => { const q = (data as Quarter[]) || []; setQuarters(q); setSel(cur => q.find(x => x.id === cur?.id) || q[0] || null); });
  useEffect(() => { loadQuarters(); }, []);

  const { people, stats, uploads, loading } = useAdminData(sel);
  const purged = !!sel?.purged_at;
  const summary = ((sel?.summary || {}) as Summary);
  const ids = purged ? Object.keys(summary) : Object.keys(stats);
  const rows = people.filter(p => ids.includes(p.id));
  const t = purged
    ? Object.values(summary).reduce((a, s) => ({ subs: a.subs + s.subdivisions, driven: a.driven + (s.driven || 0), scanned: a.scanned + (s.scanned || 0) }), { subs: 0, driven: 0, scanned: 0 })
    : Object.values(stats).reduce((a, s) => ({ subs: a.subs + s.subs, driven: a.driven + s.subsDone, scanned: a.scanned + s.scanned }), { subs: 0, driven: 0, scanned: 0 });

  async function downloadCsv() {
    if (!sel) return;
    const { data } = await supabase().auth.getSession();
    const res = await fetch(`/api/admin/quarter?id=${sel.id}`, { headers: { Authorization: `Bearer ${data.session?.access_token}` } });
    if (!res.ok) return say("Couldn't build the report.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `${sel.label}-drive-completion.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function purge() {
    if (!sel) return;
    try { await api("/api/admin/quarter", { method: "POST", body: JSON.stringify({ action: "purge", id: sel.id, confirm }) }); say(`${sel.label} detail deleted`); setPurging(false); setConfirm(""); loadQuarters(); }
    catch (e: any) { say(e.message); }
  }

  if (!quarters.length) return (
    <div className="stack"><header className="page-h"><div className="eyebrow">Read-only</div><h1>Archive</h1></header>
      <div className="notice">Closed quarters appear here, read-only. Close the active quarter from the Overview page at quarter end.</div></div>
  );

  return (
    <div className="stack">
      <header className="page-h"><div className="eyebrow">Past quarters · read-only</div><h1>Archive</h1></header>
      <div className="seg" role="group" aria-label="Quarter">
        {quarters.map(q => <button key={q.id} aria-pressed={sel?.id === q.id} onClick={() => { setSel(q); setPurging(false); }}>{q.label}</button>)}
      </div>
      {sel && (<>
        <div className="row"><span className="grow muted small">Closed {new Date(sel.closed_at!).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}{sel.due_date ? ` · was due ${fmtDate(sel.due_date)}` : ""}</span>
          {!purged && <button className="btn sm" onClick={downloadCsv}>Download CSV</button>}</div>
        <div className="tiles compact" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="tile"><span className="tile-k">Driven</span><span className="tile-v">{t.driven}<small>/{t.subs}</small></span><div className="bar"><i style={{ width: `${pct(t.driven, t.subs)}%` }} /></div></div>
          <div className="tile"><span className="tile-k">Scanned</span><span className="tile-v">{t.scanned}<small>/{t.subs}</small></span><div className="bar"><i style={{ width: `${pct(t.scanned, t.subs)}%`, background: "var(--scan)" }} /></div></div>
          <div className="tile"><span className="tile-k">Complete</span><span className="tile-v">{pct(t.scanned, t.subs)}<small>%</small></span><div className="bar"><i style={{ width: `${pct(t.scanned, t.subs)}%`, background: "var(--scan)" }} /></div></div>
        </div>

        <div className="group-label" style={{ marginBottom: -9 }}>Drivers</div>
        <section className="pane list">
          {loading && <div className="pad muted">Loading…</div>}
          {purged ? (
            <div className="tablewrap"><table><thead><tr><th>Driver</th><th className="num">Subdivisions</th><th className="num">Driven</th><th className="num">Scanned</th></tr></thead>
              <tbody>{Object.entries(summary).map(([id, s]) => (
                <tr key={id}><td>{people.find(p => p.id === id)?.full_name || "Former driver"}</td><td className="num">{s.subdivisions}</td><td className="num">{s.driven ?? "—"}</td><td className="num">{s.scanned ?? "—"}</td></tr>))}</tbody></table></div>
          ) : rows.map(d => (
            <DriverRow key={d.id} d={d} s={stats[d.id]} quarter={sel}
              uploads={uploads.filter(u => u.driver_id === d.id)} drivers={[]} onChanged={() => {}} say={say} readOnly />))}
        </section>

        {!purged && (
          <section className="pane pad stack">
            <h3>Free up space (optional)</h3>
            <p className="muted small" style={{ margin: 0 }}>Deletes {sel.label}'s subdivision detail and uploaded PDFs for good. The totals above are kept. Download the CSV first. You won't need this for a long time: ~800 subdivisions a quarter is very little data.</p>
            {!purging ? <div><button className="btn danger" onClick={() => setPurging(true)}>Delete {sel.label} detail…</button></div> : (
              <div className="confirm-box">
                <b>This can't be undone.</b>
                <div className="field" style={{ maxWidth: 260 }}><label htmlFor="pc">Type {sel.label} to confirm</label><input id="pc" type="text" value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())} /></div>
                <div className="row"><button className="btn danger solid" disabled={confirm !== sel.label} onClick={purge}>Delete for good</button><button className="btn ghost" onClick={() => { setPurging(false); setConfirm(""); }}>Cancel</button></div>
              </div>)}
          </section>)}
      </>)}
      {toast}
    </div>
  );
}

export default function Page() {
  return <AdminShell><Archive /></AdminShell>;
}
