// Reads an assignment table printed to PDF from Excel (e.g. "Microsoft Print to PDF").
// Rows come from the table's horizontal borders; columns come from where text lines up
// under each header. Multi-line cells (long section lists) are joined back together.
import { columnKeyFor, type ColumnKey } from "./normalize";

type Txt = { x: number; y: number; s: string };
type PageData = { texts: Txt[]; hlines: number[] };

async function loadPages(buf: Buffer): Promise<PageData[]> {
  // pdf2json is CommonJS; import lazily so it only loads on the server.
  const mod: any = await import("pdf2json");
  const PDFParser = mod.default || mod;
  const parser = new PDFParser(null, true);
  const data: any = await new Promise((resolve, reject) => {
    parser.on("pdfParser_dataError", (e: any) => reject(e?.parserError || e));
    parser.on("pdfParser_dataReady", resolve);
    parser.parseBuffer(buf);
  });
  return (data.Pages || []).map((pg: any) => {
    const texts: Txt[] = [];
    for (const t of pg.Texts || []) {
      const s = (t.R || []).map((r: any) => { try { return decodeURIComponent(r.T); } catch { return r.T; } }).join("");
      if (s.trim()) texts.push({ x: t.x, y: t.y, s });
    }
    const ys: number[] = [];
    for (const f of pg.Fills || []) if (f.h < 0.12 && f.w > 1) ys.push(f.y);
    for (const l of pg.HLines || []) ys.push(l.y);
    return { texts, hlines: dedupe(ys.sort((a, b) => a - b), 0.08) };
  });
}

function dedupe(sorted: number[], tol: number) {
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
  return out;
}

/** Group text items that share a baseline. */
function lines(texts: Txt[], tol = 0.18) {
  const sorted = [...texts].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Txt[][] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].y - t.y) <= tol) last.push(t); else out.push([t]);
  }
  return out;
}

type Header = { key: ColumnKey; x: number; yBottom: number };

function findHeader(texts: Txt[]): Header[] | null {
  const ls = lines(texts);
  for (let i = 0; i < ls.length; i++) {
    const joined = ls[i].map(t => t.s.toLowerCase()).join(" ");
    if (!/subdivision/.test(joined) || !/lat/.test(joined)) continue;
    // Headers can wrap ("New / Section(s)"): include neighbouring lines within ~0.8 units.
    const y0 = ls[i][0].y;
    const band = texts.filter(t => Math.abs(t.y - y0) <= 0.8);
    // Merge pieces of the same header that sit above each other.
    const cols: { x: number; parts: Txt[] }[] = [];
    for (const t of band.sort((a, b) => a.x - b.x)) {
      const near = cols.find(c => Math.abs(c.x - t.x) < 1.2 && !c.parts.some(p => Math.abs(p.y - t.y) < 0.18));
      if (near) { near.parts.push(t); near.x = Math.min(near.x, t.x); } else cols.push({ x: t.x, parts: [t] });
    }
    const headers: Header[] = [];
    for (const c of cols) {
      const label = c.parts.sort((a, b) => a.y - b.y).map(p => p.s).join(" ");
      const key = columnKeyFor(label);
      if (key && !headers.some(h => h.key === key)) {
        headers.push({ key, x: c.parts.reduce((m, p) => m + p.x, 0) / c.parts.length, yBottom: Math.max(...c.parts.map(p => p.y)) });
      }
    }
    if (headers.some(h => h.key === "subdivision")) return headers.sort((a, b) => a.x - b.x);
  }
  return null;
}

/** Cluster the left edges of data text into columns, then match each cluster to the nearest header. */
function columnOf(headers: Header[], data: Txt[]) {
  const xs = [...new Set(data.map(t => +t.x.toFixed(2)))].sort((a, b) => a - b);
  const clusters: { lo: number; hi: number }[] = [];
  for (const x of xs) {
    const c = clusters[clusters.length - 1];
    if (c && x - c.hi < 0.9) c.hi = x; else clusters.push({ lo: x, hi: x });
  }
  const map = clusters.map(c => {
    const mid = (c.lo + c.hi) / 2;
    let best = headers[0], bd = Infinity;
    for (const h of headers) { const d = Math.abs(h.x - mid); if (d < bd) { bd = d; best = h; } }
    return { ...c, key: best.key };
  });
  return (x: number): ColumnKey => {
    for (const c of map) if (x >= c.lo - 0.01 && x <= c.hi + 0.01) return c.key;
    let best = map[0];
    for (const c of map) if (Math.abs((c.lo + c.hi) / 2 - x) < Math.abs((best.lo + best.hi) / 2 - x)) best = c;
    return best.key;
  };
}

export async function parseAssignmentPdf(buf: Buffer) {
  const pages = await loadPages(buf);
  const rows: Partial<Record<ColumnKey, string>>[] = [];
  let headers: Header[] | null = null;

  for (const pg of pages) {
    const h = findHeader(pg.texts);
    if (h) headers = h;
    if (!headers) continue;
    const headerBottom = h ? Math.max(...h.map(x => x.yBottom)) + 0.15 : -1;
    const data = pg.texts.filter(t => t.y > headerBottom);
    if (!data.length) continue;
    const colOf = columnOf(headers, data);

    // Every table row has one "anchor" line: the line holding its subdivision name.
    const anchors = lines(data).filter(l => l.some(t => colOf(t.x) === "subdivision")).map(l => l[0].y);

    // Row bands come from the drawn horizontal borders. Text positions can be offset from the
    // border positions by a constant, so find the offset that puts every anchor line in its
    // own band with the most room to spare.
    const allBands: [number, number][] = [];
    for (let i = 0; i < pg.hlines.length - 1; i++) allBands.push([pg.hlines[i], pg.hlines[i + 1]]);
    let best: { d: number; margin: number } | null = null;
    if (allBands.length && anchors.length) {
      for (let d = -1.5; d <= 1.5001; d += 0.01) {
        const used = new Set<number>(); let margin = Infinity, ok = true;
        for (const y of anchors) {
          const yy = y + d;
          const bi = allBands.findIndex(([a, b]) => yy > a && yy < b);
          if (bi < 0 || used.has(bi)) { ok = false; break; }
          used.add(bi);
          margin = Math.min(margin, yy - allBands[bi][0], allBands[bi][1] - yy);
        }
        if (ok && (!best || margin > best.margin + 1e-6)) best = { d, margin };
      }
    }

    let shift = 0;
    let bands: [number, number][] = [];
    if (best && best.margin > 0.05) {
      shift = best.d;
      bands = allBands.filter(([a, b]) => anchors.some(y => y + shift > a && y + shift < b));
    } else {
      // No usable borders: split halfway between anchor lines.
      for (let i = 0; i < anchors.length; i++) {
        const lo = i ? (anchors[i - 1] + anchors[i]) / 2 : headerBottom;
        const hi = i < anchors.length - 1 ? (anchors[i] + anchors[i + 1]) / 2 : Infinity;
        bands.push([lo, hi]);
      }
    }

    for (const [a, b] of bands) {
      const inBand = data.filter(t => t.y + shift > a && t.y + shift < b).sort((p, q) => p.y - q.y || p.x - q.x);
      const row: Partial<Record<ColumnKey, string[]>> = {};
      for (const t of inBand) (row[colOf(t.x)] ||= []).push(t.s);
      const flat: Partial<Record<ColumnKey, string>> = {};
      for (const k of Object.keys(row) as ColumnKey[]) {
        const sep = k === "new" || k === "active" || k === "btr" ? "," : " ";
        flat[k] = row[k]!.join(sep);
      }
      if (flat.subdivision && !/^subdivision$/i.test(flat.subdivision.trim())) rows.push(flat);
    }
  }
  if (!headers) throw new Error("Couldn't find the header row. The PDF needs Subdivision and Latitude column headers.");
  return rows;
}
