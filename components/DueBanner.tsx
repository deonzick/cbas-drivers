"use client";
import { daysUntil, dueText, fmtDate } from "@/lib/format";

/** "12 days left" countdown for a driver's drive. */
export function DueBanner({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return null;
  const d = dueText(dueDate);
  const n = Math.abs(daysUntil(dueDate));
  return (
    <div className={`due ${d.tone}`}>
      <span className="days">{d.tone === "late" && d.text === "Due today" ? "Today" : n}</span>
      <div className="grow"><b>{d.text}</b><div className="small muted">Drive due {fmtDate(dueDate, { weekday: "long", month: "long", day: "numeric" })}</div></div>
    </div>
  );
}

