import type { SupabaseClient } from "@supabase/supabase-js";

const CHECKS_RETENTION_HOURS = 24;

interface ChecksRow {
  endpoint_id: string;
  success: boolean;
  response_time_ms: number | null;
}

/**
 * Aggregates the last fully-completed hour of `checks` into one `hourly_stats`
 * row per endpoint, then trims `checks` older than the 24h retention window.
 * Runs at minute 0 of every hour, so "the last full hour" is [now-1h, now).
 *
 * One bulk query + one bulk upsert regardless of endpoint count — a
 * per-endpoint loop here scales subrequests linearly and eventually hits
 * Cloudflare's per-invocation subrequest limit (see minuteCheck.ts).
 */
export async function runHourlyRollup(db: SupabaseClient) {
  const now = new Date();
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  hourStart.setHours(hourStart.getHours() - 1);
  const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

  const { data: checks, error } = await db
    .from("checks")
    .select("endpoint_id, success, response_time_ms")
    .gte("checked_at", hourStart.toISOString())
    .lt("checked_at", hourEnd.toISOString())
    .returns<ChecksRow[]>();
  if (error) throw error;

  if (checks && checks.length > 0) {
    const byEndpoint = new Map<string, ChecksRow[]>();
    for (const check of checks) {
      const list = byEndpoint.get(check.endpoint_id) ?? [];
      list.push(check);
      byEndpoint.set(check.endpoint_id, list);
    }

    const rows = Array.from(byEndpoint.entries()).map(([endpoint_id, endpointChecks]) => {
      const successfulTimes = endpointChecks
        .filter((c) => c.success && c.response_time_ms !== null)
        .map((c) => c.response_time_ms as number);

      return {
        endpoint_id,
        hour_start: hourStart.toISOString(),
        total_checks: endpointChecks.length,
        successful_checks: endpointChecks.filter((c) => c.success).length,
        avg_response_time_ms:
          successfulTimes.length > 0 ? Math.round(successfulTimes.reduce((a, b) => a + b, 0) / successfulTimes.length) : null,
        min_response_time_ms: successfulTimes.length > 0 ? Math.min(...successfulTimes) : null,
        max_response_time_ms: successfulTimes.length > 0 ? Math.max(...successfulTimes) : null,
      };
    });

    const { error: upsertError } = await db.from("hourly_stats").upsert(rows, { onConflict: "endpoint_id,hour_start" });
    if (upsertError) throw upsertError;
  }

  const cutoff = new Date(now.getTime() - CHECKS_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
  const { error: deleteError } = await db.from("checks").delete().lt("checked_at", cutoff);
  if (deleteError) throw deleteError;
}
