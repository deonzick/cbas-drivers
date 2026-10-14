// Turns raw table rows (header -> cell text) into assignment records.
// Shared by the PDF and spreadsheet importers.

export type SectionKind = "new" | "active" | "btr";

export interface ParsedSection {
  label: string;
  kinds: SectionKind[];
}

export interface ParsedSubdivision {
  county: string;
  city: string;
  market: string;
  submarket: string;
  name: string;
  lat: number | null;
  lng: number | null;
  driver: string;
  sections: ParsedSection[];
  warnings: string[];
}

export interface ParseResult {
  rows: ParsedSubdivision[];
  drivers: string[];
  warnings: string[];
  quarterHint: string | null;
}

/** Canonical column keys and the header words that identify them. */
export const COLUMN_MATCHERS: { key: ColumnKey; test: (h: string) => boolean }[] = [
  { key: "county", test: h => /county/.test(h) },
  { key: "submarket", test: h => /sub\s*_?\s*mkt|submarket|sub\s*market/.test(h) },
  { key: "market", test: h => /(^|[^b])mkt|market/.test(h) && !/sub/.test(h) },
  { key: "city", test: h => /^city|\bcity\b/.test(h) },
  { key: "subdivision", test: h => /subdivision|community/.test(h) },
  { key: "new", test: h => /\bnew\b/.test(h) },
  { key: "btr", test: h => /\bbtr\b|build.to.rent/.test(h) },
  // A single-section column (used by the optional section-pins file), e.g. "Section", "Section #".
  { key: "section", test: h => /^(phase\s*\/\s*)?(section|sec)\.?\s*(name|#|no\.?|label)?$/.test(h) },
  { key: "active", test: h => /active|section/.test(h) },
  { key: "lat", test: h => /^lat|latitude/.test(h) },
  { key: "lng", test: h => /^lon|^lng|longitude/.test(h) },
  { key: "driver", test: h => /driver|assigned/.test(h) },
];

export type ColumnKey =
  | "county" | "city" | "market" | "submarket" | "subdivision"
  | "new" | "active" | "btr" | "section" | "lat" | "lng" | "driver";

export function columnKeyFor(header: string): ColumnKey | null {
  const h = header.toLowerCase().replace(/\s+/g, " ").trim();
  if (!h) return null;
  for (const m of COLUMN_MATCHERS) if (m.test(h)) return m.key;
  return null;
}

/** "8, 10, 11" / ", 1,2,3 4" / "P8S9A,P8S9B" -> ["8","10","11"] etc. */
export function splitSections(cell: string): string[] {
  return (cell || "")
    .split(/[,;\n\r\t ]+/)
    .map(s => s.trim().replace(/^sec(tion)?\.?/i, "").trim())
    .filter(s => s.length > 0 && s !== "-");
}

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
function toNum(s: unknown): number | null {
  const t = clean(s).replace(/[^0-9.\-]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function normalizeRows(raw: Partial<Record<ColumnKey, string>>[], fileName = ""): ParseResult {
  const out: ParsedSubdivision[] = [];
  const warnings: string[] = [];
  const drivers = new Set<string>();

  for (const r of raw) {
    const name = clean(r.subdivision);
    if (!name) continue;
    const w: string[] = [];
    let lat = toNum(r.lat), lng = toNum(r.lng);
    // Houston-area sanity: latitude ~ 25..37, longitude ~ -107..-93. Swap if reversed.
    if (lat !== null && lng !== null && lat < 0 && lng > 0) { const t = lat; lat = lng; lng = t; }
    if (lat === null || lng === null) w.push("No latitude/longitude");
    else if (lat < 24 || lat > 37 || lng > -93 || lng < -107) w.push("Coordinates look outside Texas");

    const byLabel = new Map<string, ParsedSection>();
    (["new", "active", "btr"] as SectionKind[]).forEach(kind => {
      for (const label of splitSections(r[kind] || "")) {
        const key = label.toUpperCase();
        const cur = byLabel.get(key);
        if (cur) { if (!cur.kinds.includes(kind)) cur.kinds.push(kind); }
        else byLabel.set(key, { label: key, kinds: [kind] });
      }
    });
    const sections = [...byLabel.values()];
    if (!sections.length) w.push("No sections listed");

    const driver = clean(r.driver);
    if (driver) drivers.add(driver);
    out.push({
      county: clean(r.county), city: clean(r.city), market: clean(r.market), submarket: clean(r.submarket),
      name, lat, lng, driver, sections, warnings: w,
    });
  }
  if (!out.length) warnings.push("No subdivision rows were found. Check that the file has a Subdivision column.");
  const q = fileName.match(/\b([1-4])\s*Q\s*(\d{2,4})\b/i) || fileName.match(/\bQ\s*([1-4])\s*[- ]?\s*(\d{2,4})\b/i);
  const quarterHint = q ? `${q[1]}Q${q[2].slice(-2)}` : null;
  return { rows: out, drivers: [...drivers], warnings, quarterHint };
}

export interface ParsedPin { subdivision: string; section: string; lat: number; lng: number }

/** Rows from the optional section-pins file: Subdivision, Section, Latitude, Longitude. */
export function normalizePins(raw: Partial<Record<ColumnKey, string>>[]) {
  const pins: ParsedPin[] = []; const skipped: string[] = [];
  for (const r of raw) {
    const subdivision = clean(r.subdivision), section = clean(r.section);
    let lat = toNum(r.lat), lng = toNum(r.lng);
    if (lat !== null && lng !== null && lat < 0 && lng > 0) { const t = lat; lat = lng; lng = t; }
    if (!subdivision || !section) continue;
    if (lat === null || lng === null) { skipped.push(`${subdivision} ${section}`); continue; }
    pins.push({ subdivision, section, lat, lng });
  }
  return { pins, skipped };
}

/** True when a table looks like the section-pins file rather than a drive sheet. */
export const isPinsTable = (raw: Partial<Record<ColumnKey, string>>[]) =>
  raw.length > 0 && raw.some(r => r.section) && !raw.some(r => r.new || r.active || r.btr);
