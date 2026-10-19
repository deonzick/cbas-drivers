"use client";
import { useState } from "react";

export type Slice = { key: string; label: string; value: number; color: string; note?: string };

/** Donut of subdivision status across every driver, with a legend that doubles as the
 *  table view (counts and shares are always written out, never color alone). */
export function StatusPie({ slices, center, centerLabel }: { slices: Slice[]; center: string; centerLabel: string }) {
  const [hot, setHot] = useState<string | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 70, W = 22, C = 2 * Math.PI * R;
  const gap = slices.filter(s => s.value > 0).length > 1 ? 2.5 : 0; // surface gap between slices
  let at = 0;
  const pctOf = (v: number) => (total ? Math.round((v / total) * 100) : 0);

  return (
    <div className="pie">
      <div className="pie-fig">
        <svg viewBox="0 0 180 180" role="img" aria-label={slices.map(s => `${s.label}: ${s.value}`).join(", ")}>
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--fill)" strokeWidth={W} />
          {total > 0 && slices.map(s => {
            if (!s.value) return null;
            const len = (s.value / total) * C;
            const seg = (
              <circle key={s.key} cx="90" cy="90" r={R} fill="none" stroke={s.color} strokeWidth={hot === s.key ? W + 6 : W}
                strokeDasharray={`${Math.max(len - gap, 0.01)} ${C}`} strokeDashoffset={-at}
                transform="rotate(-90 90 90)" style={{ transition: "stroke-width .15s", opacity: hot && hot !== s.key ? 0.45 : 1, cursor: "default" }}
                onMouseEnter={() => setHot(s.key)} onMouseLeave={() => setHot(null)}>
                <title>{`${s.label}: ${s.value} (${pctOf(s.value)}%)`}</title>
              </circle>
            );
            at += len;
            return seg;
          })}
        </svg>
        <div className="pie-center">
          <b>{hot ? `${pctOf(slices.find(s => s.key === hot)!.value)}%` : center}</b>
          <span>{hot ? slices.find(s => s.key === hot)!.label : centerLabel}</span>
        </div>
      </div>
      <ul className="pie-legend">
        {slices.map(s => (
          <li key={s.key} onMouseEnter={() => setHot(s.key)} onMouseLeave={() => setHot(null)} data-hot={hot === s.key || undefined}>
            <i style={{ background: s.color }} />
            <span className="grow"><span className="pl-label">{s.label}</span>{s.note && <span className="pl-note">{s.note}</span>}</span>
            <span className="pl-val">{s.value.toLocaleString()}</span>
            <span className="pl-pct">{pctOf(s.value)}%</span>
          </li>))}
      </ul>
    </div>
  );
}
