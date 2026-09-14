import type { SupabaseClient } from "@supabase/supabase-js";

const HOURLY_STATS_RETENTION_DAYS = 7;

interface HourlyStatRow {
  endpoint_id: string;
  total_checks: number;
  successful_checks: number;
  avg_response_time_ms: number | null;
  min_response_time_ms: number | null;
  max_response_time_ms: number | null;
}

/**
 * Aggregates yesterday's `hourly_stats` into one `daily_stats` row per
 * endpoint, then trims `hourly_stats` older than the 7-day retention window.
 * Runs at 00:05 UTC, so "yesterday" is the UTC calendar day before now.
 *
 * One bulk query + one bulk upsert regardless of endpoint count — see
 * hourlyRollup.ts / minuteCheck.ts for why a per-endpoint loop doesn't scale.
 */
export async function runDailyRollup(db: SupabaseClient) {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayString = dayStart.toISOString().slice(0, 10);

  const { data: hours, error } = await db
    .from("hourly_stats")
    .select("endpoint_id, total_checks, successful_checks, avg_response_time_ms, min_response_time_ms, max_response_time_ms")
    .gte("hour_start", dayStart.toISOString())
    .lt("hour_start", dayEnd.toISOString())
    .returns<HourlyStatRow[]>();
  if (error) throw error;

  if (hours && hours.length > 0) {
    const byEndpoint = new Map<string, HourlyStatRow[]>();
    for (const row of hours) {
      const list = byEndpoint.get(row.endpoint_id) ?? [];
      list.push(row);
      byEndpoint.set(row.endpoint_id, list);
    }

    const rows = Array.from(byEndpoint.entries()).map(([endpoint_id, endpointHours]) => {
      const total_checks = endpointHours.reduce((sum, h) => sum + h.total_checks, 0);
      const successful_checks = endpointHours.reduce((sum, h) => sum + h.successful_checks, 0);

      let weightedSum = 0;
      let weightedCount = 0;
      let min_response_time_ms: number | null = null;
      let max_response_time_ms: number | null = null;

      for (const h of endpointHours) {
        if (h.avg_response_time_ms !== null && h.successful_checks > 0) {
          weightedSum += h.avg_response_time_ms * h.successful_checks;
          weightedCount += h.successful_checks;
        }
        if (h.min_response_time_ms !== null) {
          min_response_time_ms = min_response_time_ms === null ? h.min_response_time_ms : Math.min(min_response_time_ms, h.min_response_time_ms);
        }
        if (h.max_response_time_ms !== null) {
          max_response_time_ms = max_response_time_ms === null ? h.max_response_time_ms : Math.max(max_response_time_ms, h.max_response_time_ms);
        }
      }

      return {
        endpoint_id,
        day: dayString,
        total_checks,
        successful_checks,
        avg_response_time_ms: weightedCount > 0 ? Math.round(weightedSum / weightedCount) : null,
        min_response_time_ms,
        max_response_time_ms,
      };
    });

    const { error: upsertError } = await db.from("daily_stats").upsert(rows, { onConflict: "endpoint_id,day" });
    if (upsertError) throw upsertError;
  }

  const cutoff = new Date(now.getTime() - HOURLY_STATS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: deleteError } = await db.from("hourly_stats").delete().lt("hour_start", cutoff);
  if (deleteError) throw deleteError;
}
