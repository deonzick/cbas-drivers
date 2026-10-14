"use client";
// Check-offs (and TurboScan marks) made without signal wait here (on the phone) and sync, with the time they were
// actually tapped, as soon as the connection is back.
import { supabase } from "./supabase";

/** A check/uncheck of a section, or a subdivision's "scanned into TurboScan" box. */
export type QueuedOp = { kind: "section" | "scan"; id: string; done: boolean; at: string };
const opKey = (o: QueuedOp) => `${o.kind}:${o.id}`;
const qKey = (uid: string) => `cbas-queue-${uid}`;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(f => f());
export const onQueueChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function readQueue(uid: string): QueuedOp[] {
  try { return JSON.parse(localStorage.getItem(qKey(uid)) || "[]"); } catch { return []; }
}
function writeQueue(uid: string, ops: QueuedOp[]) {
  try { localStorage.setItem(qKey(uid), JSON.stringify(ops)); } catch {}
  notify();
}
/** Adds changes; a later change to the same item replaces the earlier one. */
export function enqueue(uid: string, ops: QueuedOp[]) {
  const keys = new Set(ops.map(opKey));
  writeQueue(uid, [...readQueue(uid).filter(o => o.kind && !keys.has(opKey(o))), ...ops]);
}

const isNetworkError = (e: any) =>
  !navigator.onLine || /fetch|network|load failed|timed? ?out|connection/i.test(String(e?.message || e || ""));

let flushing: Promise<{ sent: number; failed: number }> | null = null;
/** Sends queued check-offs in order. Stops at the first network failure and keeps the rest. */
export function flushQueue(uid: string) {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0, failed = 0;
    // Sections first: a subdivision can only be marked scanned once its sections are in.
    const ops = readQueue(uid).filter(o => o.kind);
    for (const op of [...ops.filter(o => o.kind === "section"), ...ops.filter(o => o.kind === "scan")]) {
      try {
        const { error } = op.kind === "scan"
          ? await supabase().rpc("set_subdivision_scanned", { p_subdivision: op.id, p_done: op.done, p_at: op.at })
          : await supabase().rpc("set_section_done", { p_section: op.id, p_done: op.done, p_at: op.at });
        if (error) {
          if (isNetworkError(error)) break;
          failed++; // e.g. the section was removed by a re-upload; drop it
        } else sent++;
      } catch (e) { if (isNetworkError(e)) break; failed++; }
      writeQueue(uid, readQueue(uid).filter(o => !(opKey(o) === opKey(op) && o.at === op.at)));
    }
    return { sent, failed };
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Small JSON cache so the list opens with no signal. */
export const cache = {
  get<T>(key: string): T | null { try { const v = localStorage.getItem(`cbas-cache-${key}`); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key: string, v: unknown) { try { localStorage.setItem(`cbas-cache-${key}`, JSON.stringify(v)); } catch {} },
};
