"use client";

import type { Check } from "@/lib/types";
import { formatAbsoluteTime, formatRelativeTime, formatTimeShort } from "@/lib/format";

interface ChecksBarChartProps {
  checks: Check[];
  maxBars?: number;
  barHeight?: number;
}

export default function ChecksBarChart({ checks, maxBars = 30, barHeight = 34 }: ChecksBarChartProps) {
  const sorted = [...checks].sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());
  const visible = sorted.slice(-maxBars);
  const placeholders = Math.max(0, maxBars - visible.length);

  const oldest = visible[0];
  const newest = visible[visible.length - 1];

  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: barHeight }}>
        {Array.from({ length: placeholders }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex-1 rounded-sm"
            style={{ height: "100%", background: "var(--color-check-empty)" }}
          />
        ))}
        {visible.map((check) => (
          <div
            key={check.id}
            title={`${formatAbsoluteTime(check.checked_at)} — ${check.success ? "success" : "failed"}${
              check.response_time_ms !== null ? ` (${check.response_time_ms}ms)` : ""
            }`}
            className="flex-1 rounded-sm"
            style={{ height: "100%", background: check.success ? "var(--color-success)" : "var(--color-danger)" }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
        <span>{oldest ? formatTimeShort(oldest.checked_at) : "—"}</span>
        <span>{newest ? formatRelativeTime(newest.checked_at) : "—"}</span>
      </div>
    </div>
  );
}
