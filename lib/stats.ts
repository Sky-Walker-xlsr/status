import type { PeriodTotals } from "./types";

/** Merge several period aggregates (e.g. many hourly_stats rows) into one. */
export function combineTotals(rows: PeriodTotals[]): PeriodTotals {
  let total_checks = 0;
  let successful_checks = 0;
  let weightedResponseSum = 0;
  let weightedResponseCount = 0;
  let min_response_time_ms: number | null = null;
  let max_response_time_ms: number | null = null;

  for (const row of rows) {
    total_checks += row.total_checks;
    successful_checks += row.successful_checks;

    if (row.avg_response_time_ms !== null && row.successful_checks > 0) {
      weightedResponseSum += row.avg_response_time_ms * row.successful_checks;
      weightedResponseCount += row.successful_checks;
    }
    if (row.min_response_time_ms !== null) {
      min_response_time_ms =
        min_response_time_ms === null ? row.min_response_time_ms : Math.min(min_response_time_ms, row.min_response_time_ms);
    }
    if (row.max_response_time_ms !== null) {
      max_response_time_ms =
        max_response_time_ms === null ? row.max_response_time_ms : Math.max(max_response_time_ms, row.max_response_time_ms);
    }
  }

  return {
    total_checks,
    successful_checks,
    avg_response_time_ms: weightedResponseCount > 0 ? Math.round(weightedResponseSum / weightedResponseCount) : null,
    min_response_time_ms,
    max_response_time_ms,
  };
}

export function uptimePercent(totals: PeriodTotals): number | null {
  if (totals.total_checks === 0) return null;
  return (totals.successful_checks / totals.total_checks) * 100;
}

/** Aggregate raw `checks` rows (only successful ones count toward response time) into a PeriodTotals. */
export function totalsFromChecks(checks: { success: boolean; response_time_ms: number | null }[]): PeriodTotals {
  const total_checks = checks.length;
  const successfulTimes = checks.filter((c) => c.success && c.response_time_ms !== null).map((c) => c.response_time_ms as number);
  const successful_checks = checks.filter((c) => c.success).length;

  return {
    total_checks,
    successful_checks,
    avg_response_time_ms:
      successfulTimes.length > 0 ? Math.round(successfulTimes.reduce((a, b) => a + b, 0) / successfulTimes.length) : null,
    min_response_time_ms: successfulTimes.length > 0 ? Math.min(...successfulTimes) : null,
    max_response_time_ms: successfulTimes.length > 0 ? Math.max(...successfulTimes) : null,
  };
}
