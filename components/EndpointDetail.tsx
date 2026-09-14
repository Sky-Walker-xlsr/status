"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StatusBadge from "./StatusBadge";
import StatCard from "./StatCard";
import PillBadge from "./PillBadge";
import ChecksBarChart from "./ChecksBarChart";
import ResponseTimeTrendChart, { type TrendPoint } from "./ResponseTimeTrendChart";
import EventsList from "./EventsList";
import Pagination from "./Pagination";
import {
  fetchChecksPage,
  fetchEndpoint,
  fetchEvents,
  fetchLatestCheck,
  fetchPeriodTotals,
  fetchTrendData,
  type Period,
  type TrendPeriod,
} from "@/lib/queries/detail";
import type { Check, Endpoint, PeriodTotals, StatusEvent } from "@/lib/types";
import { hostOf, formatMs, formatRelativeTime, formatUptime } from "@/lib/format";

const PERIODS: Period[] = ["1h", "24h", "7d", "30d"];
const PERIOD_LABELS: Record<Period, string> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};
const CHECKS_PAGE_SIZE = 90;
const POLL_INTERVAL_MS = 60_000;

interface EndpointDetailProps {
  endpointId: string;
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
    </svg>
  );
}

export default function EndpointDetail({ endpointId }: EndpointDetailProps) {
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [latestCheck, setLatestCheck] = useState<Check | null>(null);
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [periodTotals, setPeriodTotals] = useState<Record<Period, PeriodTotals | null>>({
    "1h": null,
    "24h": null,
    "7d": null,
    "30d": null,
  });

  const [checksPage, setChecksPage] = useState<Check[]>([]);
  const [checksTotalCount, setChecksTotalCount] = useState(0);
  const [page, setPage] = useState(1);

  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("24h");
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);

  const [error, setError] = useState<string | null>(null);

  const loadCore = useCallback(async () => {
    try {
      const [ep, latest, ev, totals] = await Promise.all([
        fetchEndpoint(endpointId),
        fetchLatestCheck(endpointId),
        fetchEvents(endpointId),
        Promise.all(PERIODS.map((p) => fetchPeriodTotals(endpointId, p))),
      ]);
      setEndpoint(ep);
      setLatestCheck(latest);
      setEvents(ev);
      setPeriodTotals({ "1h": totals[0], "24h": totals[1], "7d": totals[2], "30d": totals[3] });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load endpoint");
    }
  }, [endpointId]);

  const loadChecksPage = useCallback(async () => {
    try {
      const { checks, totalCount } = await fetchChecksPage(endpointId, page, CHECKS_PAGE_SIZE);
      setChecksPage(checks);
      setChecksTotalCount(totalCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load checks");
    }
  }, [endpointId, page]);

  const loadTrend = useCallback(async () => {
    try {
      const points = await fetchTrendData(endpointId, trendPeriod);
      setTrendData(points);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load response time trend");
    }
  }, [endpointId, trendPeriod]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  useEffect(() => {
    loadChecksPage();
  }, [loadChecksPage]);

  useEffect(() => {
    loadTrend();
  }, [loadTrend]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadCore();
      loadChecksPage();
      loadTrend();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadCore, loadChecksPage, loadTrend]);

  const totalPages = Math.max(1, Math.ceil(checksTotalCount / CHECKS_PAGE_SIZE));
  const healthy = latestCheck?.success ?? false;

  const latencyRange = useMemo(() => {
    const times = checksPage.filter((c) => c.success && c.response_time_ms !== null).map((c) => c.response_time_ms as number);
    if (times.length === 0) return null;
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [checksPage]);

  if (error && !endpoint) {
    return (
      <div className="min-h-screen px-4 py-6 sm:px-8">
        <p className="text-sm" style={{ color: "var(--color-danger-text)" }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Link href="/" className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          ← Back to Dashboard
        </Link>

        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--color-text)" }}>
              {endpoint?.name ?? "…"}
            </h1>
            <p className="flex items-center gap-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              <span>Group: {endpoint?.group_name ?? "—"}</span>
              {endpoint?.url && <span>· {hostOf(endpoint.url)}</span>}
              {endpoint && !endpoint.url && (
                <span className="inline-flex items-center gap-1">
                  · <LockIcon /> hidden
                </span>
              )}
            </p>
          </div>
          <StatusBadge healthy={healthy} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Current Status"
            value={healthy ? "Operational" : "Down"}
            valueColor={healthy ? "var(--color-success)" : "var(--color-danger-text)"}
          />
          <StatCard label="Avg Response Time" value={formatMs(periodTotals["24h"]?.avg_response_time_ms)} />
          <StatCard
            label="Response Time Range"
            value={
              periodTotals["24h"]?.min_response_time_ms != null
                ? `${periodTotals["24h"]?.min_response_time_ms}-${periodTotals["24h"]?.max_response_time_ms}ms`
                : "—"
            }
          />
          <StatCard label="Last Check" value={latestCheck ? formatRelativeTime(latestCheck.checked_at) : "—"} />
        </div>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
              Recent Checks
            </h2>
            {latencyRange && (
              <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {latencyRange.min}-{latencyRange.max}ms
              </span>
            )}
          </div>
          <div
            className="rounded-[var(--radius-main)] p-4"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
          >
            <ChecksBarChart checks={checksPage} maxBars={CHECKS_PAGE_SIZE} barHeight={44} />
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
              Response Time Trend
            </h2>
            <select
              value={trendPeriod}
              onChange={(e) => setTrendPeriod(e.target.value as TrendPeriod)}
              className="rounded-[var(--radius-main)] px-2.5 py-1.5 text-xs outline-none"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            >
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </div>
          <div
            className="rounded-[var(--radius-main)] p-4"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
          >
            <ResponseTimeTrendChart data={trendData} />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Response Time
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PERIODS.map((p) => (
              <PillBadge key={p} label={PERIOD_LABELS[p]} value={formatMs(periodTotals[p]?.avg_response_time_ms)} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Uptime Statistics
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PERIODS.map((p) => {
              const totals = periodTotals[p];
              const uptime = totals && totals.total_checks > 0 ? (totals.successful_checks / totals.total_checks) * 100 : null;
              return (
                <PillBadge
                  key={p}
                  label={PERIOD_LABELS[p]}
                  value={formatUptime(uptime)}
                  tone={uptime === null ? "neutral" : uptime >= 99 ? "success" : uptime < 90 ? "danger" : "neutral"}
                />
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Current Health
          </h2>
          <PillBadge label="Status" value={healthy ? "up" : "down"} tone={healthy ? "success" : "danger"} />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Events
          </h2>
          <EventsList events={events} />
        </section>
      </div>
    </div>
  );
}
