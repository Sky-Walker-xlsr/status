import { getSupabaseClient } from "@/lib/supabase/client";
import type { Check, Endpoint, PeriodTotals, StatusEvent } from "@/lib/types";
import { combineTotals, totalsFromChecks } from "@/lib/stats";
import type { TrendPoint } from "@/components/ResponseTimeTrendChart";

export type Period = "1h" | "24h" | "7d" | "30d";
export type TrendPeriod = "24h" | "7d" | "30d";

type DailyStatRow = { day: string } & PeriodTotals;
type HourlyStatRow = { hour_start: string } & PeriodTotals;
type ChecksRow = { checked_at: string; success: boolean; response_time_ms: number | null };

export async function fetchEndpoint(id: string): Promise<Endpoint | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("endpoints_public").select("*").eq("id", id).returns<Endpoint[]>().maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function fetchLatestCheck(endpointId: string): Promise<Check | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("checks")
    .select("*")
    .eq("endpoint_id", endpointId)
    .order("checked_at", { ascending: false })
    .limit(1)
    .returns<Check[]>()
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function fetchEvents(endpointId: string, limit = 50): Promise<StatusEvent[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("endpoint_id", endpointId)
    .order("occurred_at", { ascending: false })
    .limit(limit)
    .returns<StatusEvent[]>();
  if (error) throw error;
  return data ?? [];
}

export async function fetchChecksPage(
  endpointId: string,
  page: number,
  pageSize: number
): Promise<{ checks: Check[]; totalCount: number }> {
  const supabase = getSupabaseClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("checks")
    .select("*", { count: "exact" })
    .eq("endpoint_id", endpointId)
    .order("checked_at", { ascending: false })
    .range(from, to)
    .returns<Check[]>();
  if (error) throw error;

  return { checks: data ?? [], totalCount: count ?? 0 };
}

/**
 * daily_stats for "today"/"yesterday" don't exist yet (the daily rollup only
 * writes yesterday's row at 00:05 UTC) — fall back to aggregating hourly_stats
 * for those two days so 30-day figures stay current.
 */
async function fetchDailyTotalsWithFallback(
  endpointId: string,
  sinceDay: string
): Promise<{ day: string; totals: PeriodTotals }[]> {
  const supabase = getSupabaseClient();

  const { data: dailyRows, error } = await supabase
    .from("daily_stats")
    .select("day, total_checks, successful_checks, avg_response_time_ms, min_response_time_ms, max_response_time_ms")
    .eq("endpoint_id", endpointId)
    .gte("day", sinceDay)
    .order("day", { ascending: true })
    .returns<DailyStatRow[]>();
  if (error) throw error;

  const byDay = new Map<string, PeriodTotals>();
  for (const row of dailyRows ?? []) {
    byDay.set(row.day, {
      total_checks: row.total_checks,
      successful_checks: row.successful_checks,
      avg_response_time_ms: row.avg_response_time_ms,
      min_response_time_ms: row.min_response_time_ms,
      max_response_time_ms: row.max_response_time_ms,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  for (const day of [yesterday, today]) {
    if (byDay.has(day) || day < sinceDay) continue;

    const dayStart = new Date(`${day}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const { data: hours, error: hoursError } = await supabase
      .from("hourly_stats")
      .select("total_checks, successful_checks, avg_response_time_ms, min_response_time_ms, max_response_time_ms")
      .eq("endpoint_id", endpointId)
      .gte("hour_start", dayStart.toISOString())
      .lt("hour_start", dayEnd.toISOString())
      .returns<HourlyStatRow[]>();
    if (hoursError) throw hoursError;

    if (hours && hours.length > 0) {
      byDay.set(day, combineTotals(hours));
    }
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, totals]) => ({ day, totals }));
}

export async function fetchPeriodTotals(endpointId: string, period: Period): Promise<PeriodTotals> {
  const supabase = getSupabaseClient();

  if (period === "1h" || period === "24h") {
    const hours = period === "1h" ? 1 : 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("checks")
      .select("success, response_time_ms")
      .eq("endpoint_id", endpointId)
      .gte("checked_at", since)
      .returns<Pick<ChecksRow, "success" | "response_time_ms">[]>();
    if (error) throw error;
    return totalsFromChecks(data ?? []);
  }

  if (period === "7d") {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("hourly_stats")
      .select("total_checks, successful_checks, avg_response_time_ms, min_response_time_ms, max_response_time_ms")
      .eq("endpoint_id", endpointId)
      .gte("hour_start", since)
      .returns<PeriodTotals[]>();
    if (error) throw error;
    return combineTotals(data ?? []);
  }

  const sinceDay = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const days = await fetchDailyTotalsWithFallback(endpointId, sinceDay);
  return combineTotals(days.map((d) => d.totals));
}

function bucketChecksByHour(checks: ChecksRow[]): TrendPoint[] {
  const buckets = new Map<number, { sum: number; count: number; timestamp: number }>();

  for (const check of checks) {
    if (!check.success || check.response_time_ms === null) continue;
    const bucketDate = new Date(check.checked_at);
    bucketDate.setMinutes(0, 0, 0);
    const key = bucketDate.getTime();
    const bucket = buckets.get(key) ?? { sum: 0, count: 0, timestamp: key };
    bucket.sum += check.response_time_ms;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((bucket) => ({
      label: new Date(bucket.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      timestamp: bucket.timestamp,
      responseTimeMs: Math.round(bucket.sum / bucket.count),
    }));
}

export async function fetchTrendData(endpointId: string, period: TrendPeriod): Promise<TrendPoint[]> {
  const supabase = getSupabaseClient();

  if (period === "24h") {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("checks")
      .select("checked_at, success, response_time_ms")
      .eq("endpoint_id", endpointId)
      .gte("checked_at", since)
      .order("checked_at", { ascending: true })
      .returns<ChecksRow[]>();
    if (error) throw error;
    return bucketChecksByHour(data ?? []);
  }

  if (period === "7d") {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("hourly_stats")
      .select("hour_start, avg_response_time_ms")
      .eq("endpoint_id", endpointId)
      .gte("hour_start", since)
      .order("hour_start", { ascending: true })
      .returns<Pick<HourlyStatRow, "hour_start" | "avg_response_time_ms">[]>();
    if (error) throw error;
    return (data ?? []).map((row) => ({
      label: new Date(row.hour_start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" }),
      timestamp: new Date(row.hour_start).getTime(),
      responseTimeMs: row.avg_response_time_ms,
    }));
  }

  const sinceDay = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const days = await fetchDailyTotalsWithFallback(endpointId, sinceDay);
  return days.map(({ day, totals }) => ({
    label: new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    timestamp: new Date(`${day}T00:00:00.000Z`).getTime(),
    responseTimeMs: totals.avg_response_time_ms,
  }));
}
