"use client";

import Link from "next/link";
import type { Check, Endpoint } from "@/lib/types";
import StatusBadge from "./StatusBadge";
import ChecksBarChart from "./ChecksBarChart";
import { hostOf, formatMs } from "@/lib/format";

interface EndpointCardProps {
  endpoint: Endpoint;
  checks: Check[];
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
    </svg>
  );
}

export default function EndpointCard({ endpoint, checks }: EndpointCardProps) {
  const sorted = [...checks].sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime());
  const latest = sorted[0];
  const healthy = latest ? latest.success : false;

  return (
    <Link
      href={`/endpoint/${endpoint.id}`}
      className="flex flex-col gap-3 rounded-[var(--radius-main)] p-4 transition-transform hover:-translate-y-0.5"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium" style={{ color: "var(--color-text)" }}>
            {endpoint.name}
          </div>
          <div className="flex items-center gap-1 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            <span>{endpoint.group_name}</span>
            {endpoint.url ? (
              <span>· {hostOf(endpoint.url)}</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                · <LockIcon /> hidden
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge healthy={healthy} />
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            ~{formatMs(latest?.response_time_ms)}
          </span>
        </div>
      </div>
      <ChecksBarChart checks={checks} maxBars={30} />
    </Link>
  );
}
