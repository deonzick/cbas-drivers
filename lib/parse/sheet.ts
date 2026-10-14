// Reads the same assignment table from .xlsx / .xls / .csv (the spreadsheet the PDFs are printed from).
import * as XLSX from "xlsx";
import { columnKeyFor, type ColumnKey } from "./normalize";

export function parseAssignmentSheet(buf: Buffer) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows: Partial<Record<ColumnKey, string>>[] = [];
  for (const name of wb.SheetNames) {
    const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    const hi = grid.findIndex(r => r.some(c => /subdivision/i.test(String(c))) && r.some(c => /lat/i.test(String(c))));
    if (hi < 0) continue;
    const keys = grid[hi].map(c => columnKeyFor(String(c)));
    for (const r of grid.slice(hi + 1)) {
      const row: Partial<Record<ColumnKey, string>> = {};
      keys.forEach((k, i) => { if (k && row[k] === undefined) row[k] = String(r[i] ?? ""); });
      if ((row.subdivision || "").trim()) rows.push(row);
    }
  }
  if (!rows.length) throw new Error("Couldn't find a sheet with Subdivision and Latitude columns.");
  return rows;
}
