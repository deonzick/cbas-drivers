"use client";
import type { ReactNode } from "react";

/** iOS-style grouped-list row that opens in place: title on the left, current value on the right. */
export function Disclosure({ title, value, children, danger, defaultOpen }: { title: string; value?: ReactNode; children: ReactNode; danger?: boolean; defaultOpen?: boolean }) {
  return (
    <details className="disc" open={defaultOpen}>
      <summary>
        <span className={`grow${danger ? " danger-ink" : ""}`}>{title}</span>
        {value != null && <span className="disc-value">{value}</span>}
        <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 6l6 6-6 6" /></svg>
      </summary>
      <div className="disc-body">{children}</div>
    </details>
  );
}
