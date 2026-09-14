export interface Endpoint {
  id: string;
  name: string;
  group_name: string;
  /** Null when `hide_url` is set — the database masks it before it ever reaches the anon client. */
  url: string | null;
  hide_url: boolean;
  created_at: string;
}

export interface Check {
  id: number;
  endpoint_id: string;
  checked_at: string;
  success: boolean;
  status_code: number | null;
  response_time_ms: number | null;
}

export interface HourlyStat {
  id: number;
  endpoint_id: string;
  hour_start: string;
  total_checks: number;
  successful_checks: number;
  avg_response_time_ms: number | null;
  min_response_time_ms: number | null;
  max_response_time_ms: number | null;
}

export interface DailyStat {
  id: number;
  endpoint_id: string;
  day: string;
  total_checks: number;
  successful_checks: number;
  avg_response_time_ms: number | null;
  min_response_time_ms: number | null;
  max_response_time_ms: number | null;
}

export type EventType = "became_healthy" | "became_unhealthy" | "initial";

export interface StatusEvent {
  id: number;
  endpoint_id: string;
  type: EventType;
  occurred_at: string;
  duration_seconds: number | null;
}

/** Aggregate counters shared by the checks/hourly_stats/daily_stats shapes. */
export interface PeriodTotals {
  total_checks: number;
  successful_checks: number;
  avg_response_time_ms: number | null;
  min_response_time_ms: number | null;
  max_response_time_ms: number | null;
}
