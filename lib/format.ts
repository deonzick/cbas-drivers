// Display and matching helpers for section labels.
// Drive sheets store phased sections as "P8S9A"; drivers read them as "Ph8 Sec 9A".

/** "P8S9A" -> "Ph8 Sec 9A", "4A" -> "Sec 4A", "ALL" -> "Whole subdivision". */
export function sectionLabel(raw: string): string {
  const v = (raw || "").trim().toUpperCase();
  if (v === "ALL") return "Whole subdivision";
  const m = v.match(/^P(?:H)?\s*(\d+[A-Z]?)\s*S(?:EC)?\s*(\w+)$/);
  if (m) return `Ph${m[1]} Sec ${m[2]}`;
  return `Sec ${v}`;
}

/** Short form for tight spaces: "Ph8 · 9A" / "4A". */
export function sectionShort(raw: string): { phase: string | null; sec: string } {
  const v = (raw || "").trim().toUpperCase();
  const m = v.match(/^P(?:H)?\s*(\d+[A-Z]?)\s*S(?:EC)?\s*(\w+)$/);
  return m ? { phase: `Ph${m[1]}`, sec: m[2] } : { phase: null, sec: v === "ALL" ? "All" : v };
}

/** Canonical key so "P8S9A", "Ph8 Sec 9A", "Phase 8 Section 9A" all match. */
export function sectionKey(raw: string): string {
  let v = (raw || "").toUpperCase().replace(/[\s._\-]+/g, "");
  v = v.replace(/^PHASE/, "P").replace(/^PH/, "P").replace(/SECTION/g, "S").replace(/SEC/g, "S");
  const m = v.match(/^P(\d+[A-Z]?)S(\w+)$/);
  if (m) return `P${m[1]}S${m[2].replace(/^0+(?=\d)/, "")}`;
  return v.replace(/^S(?=\w)/, "").replace(/^0+(?=\d)/, "");
}

/** Canonical subdivision key: case/spacing/punctuation-insensitive. */
export function subdivisionKey(name: string): string {
  return (name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** Whole days from today (local) until an ISO date (YYYY-MM-DD). Negative = overdue. */
export function daysUntil(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}
export function fmtDate(isoDate: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], opts);
}
export function dueText(isoDate: string): { text: string; tone: "ok" | "soon" | "late" } {
  const n = daysUntil(isoDate);
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} overdue`, tone: "late" };
  if (n === 0) return { text: "Due today", tone: "late" };
  return { text: `${n} day${n === 1 ? "" : "s"} left`, tone: n <= 7 ? "soon" : "ok" };
}

export const isToday = (iso?: string) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
