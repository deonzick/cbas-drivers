"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { DriverRow } from "@/components/admin/DriverRow";
import { isDriver } from "@/lib/roles";
import { AdminShell, useToast } from "@/components/Shell";
import { useAuth, type Profile } from "@/components/Auth";
import { useAdminData } from "@/lib/useAdminData";
import { api } from "@/lib/supabase";

const genPassword = () => {
  const words = ["Route", "Plat", "Lot", "Street", "Bayou", "Cedar", "Pecan", "Gulf", "Prairie", "Delta"];
  const w = () => words[Math.floor(Math.random() * words.length)];
  return `${w()}${w()}${Math.floor(100 + Math.random() * 900)}`;
};

function Row({ p, me, onDone }: { p: Profile; me: string; onDone: (m: string) => void }) {
  const [edit, setEdit] = useState<null | "key" | "pw" | "del" | "user" | "name">(null);
  const [uname, setUname] = useState(p.username || "");
  const [fname, setFname] = useState(p.full_name);
  const [key, setKey] = useState(p.driver_key || "");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const call = async (body: object, msg: string) => {
    setErr(null);
    try { await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ id: p.id, ...body }) }); setEdit(null); onDone(msg); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="login-row">
      <div className="lr-main">
        {edit === "name"
          ? <div className="row" style={{ flexWrap: "nowrap" }}><input type="text" value={fname} onChange={e => setFname(e.target.value)} style={{ width: 160 }} aria-label="Full name" />
              <button className="btn sm primary" onClick={() => call({ action: "update", fullName: fname }, "Name saved")}>Save</button></div>
          : <button className="btn sm plain" style={{ padding: 0, minHeight: 0, fontWeight: 600, fontSize: 17, color: "var(--fg)" }} onClick={() => setEdit("name")}>{p.full_name}</button>}
        {p.id === me && <span className="muted small"> (you)</span>}
        {!p.active && <span className="pill warn" style={{ marginLeft: 6 }}>Off</span>}
        {edit === "user"
          ? <div className="row" style={{ flexWrap: "nowrap", marginTop: 4 }}><input type="text" autoCapitalize="none" value={uname} onChange={e => setUname(e.target.value)} style={{ width: 160 }} aria-label="Username" />
              <button className="btn sm primary" onClick={() => call({ action: "username", username: uname }, "Username changed. Tell the driver their new sign-in.")}>Save</button>
              <button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          : <div><button className="btn sm plain" style={{ padding: 0, minHeight: 0, fontWeight: 400, fontSize: 14, color: "var(--muted)" }} onClick={() => setEdit("user")} title="Change username">{p.username || "set username"}</button></div>}
      </div>
      <div className="lr-meta"><span className="label">Name in sheets</span>{edit === "key"
        ? <div className="row" style={{ flexWrap: "nowrap" }}><input type="text" value={key} onChange={e => setKey(e.target.value)} style={{ width: 120 }} aria-label="Name in drive sheets" />
            <button className="btn sm primary" onClick={() => call({ action: "update", driverKey: key }, "Saved")}>Save</button></div>
        : <button className="btn sm gray" onClick={() => setEdit("key")}>{p.driver_key || "Set…"}</button>}</div>
      <div className="lr-meta"><span className="label">Access</span><select value={p.role} style={{ width: "auto", minHeight: 36 }} aria-label="Role" onChange={e => call({ action: "update", role: e.target.value }, "Access updated")}>
        <option value="driver">Driver</option><option value="admin">Manager</option></select>
        {p.role === "admin" && (
          <label className="remember small" style={{ marginTop: 6 }}>
            Also drives
            <input type="checkbox" className="toggle" checked={!!p.drives} onChange={e => call({ action: "update", drives: e.target.checked }, e.target.checked ? "Also drives: on" : "Also drives: off")} />
          </label>)}
      </div>
      <div className="lr-actions">
        <div className="row" style={{ gap: 6 }}>
          {edit === "pw" ? <>
            <input type="text" value={pw} onChange={e => setPw(e.target.value)} style={{ width: 170 }} aria-label="New password" />
            <button className="btn sm" onClick={() => setPw(genPassword())}>Generate</button>
            <button className="btn sm primary" disabled={pw.length < 8} onClick={() => call({ action: "password", password: pw }, `Password reset. Give ${p.full_name.split(" ")[0]} the new one.`)}>Set</button>
            <button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button>
          </> : edit === "del" ? <>
            <span className="small">Delete {p.full_name} and their drive data?</span>
            <button className="btn sm danger solid" onClick={() => call({ action: "delete" }, "Account deleted")}>Delete</button>
            <button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button>
          </> : <>
            <button className="btn sm" onClick={() => { setPw(genPassword()); setEdit("pw"); }}>Reset password</button>
            {p.id !== me && <button className="btn sm" onClick={() => call({ action: "update", active: !p.active }, p.active ? "Turned off" : "Turned on")}>{p.active ? "Turn off" : "Turn on"}</button>}
            {p.id !== me && <button className="btn sm ghost danger" onClick={() => setEdit("del")}>Delete</button>}
          </>}
        </div>
        {err && <div className="alert err" style={{ marginTop: 6 }}>{err}</div>}
      </div>
    </div>
  );
}

function Drivers() {
  const { profile, quarter } = useAuth();
  const { people, stats, uploads, reload } = useAdminData(quarter);
  const [tab, setTab] = useState<"progress" | "logins">("progress");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "least" | "most">("name");
  useEffect(() => { if (new URLSearchParams(location.search).get("tab") === "logins") setTab("logins"); }, []);
  const drivers = people.filter(isDriver);
  const score = (id: string) => { const s = stats[id]; return s && s.subs ? (s.subsDone + s.scanned) / (2 * s.subs) : -1; };
  const shown = drivers.filter(d => !q || d.full_name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === "name" ? a.full_name.localeCompare(b.full_name) : sort === "least" ? score(a.id) - score(b.id) : score(b.id) - score(a.id));
  const [toast, say] = useToast();
  const [f, setF] = useState({ fullName: "", username: "", driverKey: "", password: genPassword(), role: "driver", drives: false });
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ action: "create", ...f }) });
      setCreated({ username: f.username.trim().toLowerCase(), password: f.password });
      setF({ fullName: "", username: "", driverKey: "", password: genPassword(), role: "driver", drives: false });
      reload();
    } catch (x: any) { setErr(x.message); }
    setBusy(false);
  }

  return (
    <div className="stack">
      <header className="page-h"><div className="eyebrow">{quarter ? `${quarter.label} · ${drivers.length} drivers` : "Team"}</div><h1>Drivers</h1></header>
      <div className="seg wide" role="tablist" aria-label="Drivers view">
        <button role="tab" aria-pressed={tab === "progress"} aria-selected={tab === "progress"} onClick={() => setTab("progress")}>Progress</button>
        <button role="tab" aria-pressed={tab === "logins"} aria-selected={tab === "logins"} onClick={() => setTab("logins")}>Logins</button>
      </div>

      {tab === "progress" && (!quarter
        ? <div className="pane pad">No active quarter. <Link href="/admin">Start one on the Overview</Link> to see each driver's progress.</div>
        : <>
          <div className="row">
            <input type="search" className="grow" placeholder="Search drivers" value={q} onChange={e => setQ(e.target.value)} aria-label="Search drivers" style={{ flex: "1 1 200px" }} />
            <select value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Sort" style={{ width: "auto" }}>
              <option value="name">Name A–Z</option><option value="least">Least complete first</option><option value="most">Most complete first</option>
            </select>
          </div>
          <section className="pane list">
            {!drivers.length && <div className="pad">No drivers yet. Add them under <button className="btn sm plain" onClick={() => setTab("logins")}>Logins</button>.</div>}
            {drivers.length > 0 && !shown.length && <div className="pad muted">No driver matches “{q}”.</div>}
            {shown.map(d => (
              <DriverRow key={d.id} d={d} s={stats[d.id]} quarter={quarter} uploads={uploads.filter(u => u.driver_id === d.id)} drivers={drivers} onChanged={reload} say={say} />))}
          </section>
          <p className="muted small" style={{ margin: 0 }}>Tap a driver to see every subdivision they've driven and scanned, recent check-offs, and their drive sheet.</p>
        </>)}

      {tab === "logins" && <>
      <div className="group-label" style={{ marginBottom: -9 }}>Everyone · {people.length}</div>
      <section className="pane list">
        {people.map(p => <Row key={p.id} p={p} me={profile!.id} onDone={m => { say(m); reload(); }} />)}
      </section>
      <p className="group-foot" style={{ marginTop: -8 }}>Tap a name or username to change it.</p>
      <div className="group-label" style={{ marginBottom: -9 }}>Add a driver</div>
      <section className="pane">
        <form className="pad stack" onSubmit={create}>
          <div className="form-grid">
            <div className="field"><label htmlFor="fn">Full name</label><input id="fn" type="text" required value={f.fullName}
              onChange={e => { const v = e.target.value; setF(s => ({ ...s, fullName: v, driverKey: s.driverKey || "", username: s.username || "" })); }}
              onBlur={() => setF(s => ({ ...s, username: s.username || s.fullName.trim().toLowerCase().replace(/\s+/g, "."), driverKey: s.driverKey || s.fullName.trim().split(" ")[0] }))} /></div>
            <div className="field"><label htmlFor="un">Username</label><input id="un" type="text" required autoCapitalize="none" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></div>
            <div className="field"><label htmlFor="dk">Name in drive sheets</label><input id="dk" type="text" placeholder="e.g. Nate" value={f.driverKey} onChange={e => setF({ ...f, driverKey: e.target.value })} /></div>
            <div className="field"><label htmlFor="pw">Temporary password</label>
              <div className="row" style={{ flexWrap: "nowrap" }}><input id="pw" type="text" required minLength={8} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
                <button type="button" className="btn sm" onClick={() => setF({ ...f, password: genPassword() })}>New</button></div></div>
            <div className="field"><label htmlFor="rl">Access</label><select id="rl" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="driver">Driver</option><option value="admin">Manager</option></select>
              {f.role === "admin" && <label className="remember small" style={{ marginTop: 6, justifyContent: "space-between" }}>Also drives (gets drive sheets and driver screens)<input type="checkbox" className="toggle" checked={f.drives} onChange={e => setF({ ...f, drives: e.target.checked })} /></label>}</div>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Drivers sign in with this username and password; no email is needed. “Name in drive sheets” must match the Driver column in the PDFs so uploads find the right person.</p>
          {err && <div className="alert err">{err}</div>}
          {created && <div className="alert ok">Login created. Send this to the driver: username <b className="mono">{created.username}</b> · password <b className="mono">{created.password}</b>. Only managers can change or reset it.</div>}
          <div><button className="btn primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create Login"}</button></div>
        </form>
      </section>

      </>}
      {toast}
    </div>
  );
}

export default function Page() {
  return <AdminShell><Drivers /></AdminShell>;
}
