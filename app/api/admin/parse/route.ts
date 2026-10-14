import { handle, HttpError, requireAdmin } from "@/lib/server";
import { parseAssignmentPdf } from "@/lib/parse/pdf";
import { parseAssignmentSheet } from "@/lib/parse/sheet";
import { isPinsTable, normalizePins, normalizeRows } from "@/lib/parse/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reads an uploaded drive sheet (or the optional section-pins file) and returns a preview. Nothing is saved yet. */
export const POST = handle(async (req) => {
  await requireAdmin(req);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  if (file.size > 15 * 1024 * 1024) throw new HttpError(400, "That file is over 15 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name || "upload";
  let raw;
  try {
    raw = /\.pdf$/i.test(name) || buf.subarray(0, 4).toString() === "%PDF"
      ? await parseAssignmentPdf(buf)
      : parseAssignmentSheet(buf);
  } catch (e: any) {
    throw new HttpError(422, `Couldn't read ${name}: ${e.message || e}`);
  }
  if (isPinsTable(raw)) return Response.json({ kind: "pins", ...normalizePins(raw) });
  return Response.json({ kind: "drive", ...normalizeRows(raw, name) });
});
