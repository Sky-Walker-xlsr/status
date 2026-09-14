import type { SupabaseClient } from "@supabase/supabase-js";
import { runCheck } from "./runCheck";
import { mapWithConcurrency } from "./concurrency";

// Wide enough to survive a missed tick or a brief worker outage without
// wrongly treating the next check as "initial" again; still a single query.
const PREVIOUS_CHECK_LOOKBACK_MINUTES = 30;

// Stay under Cloudflare's 6-simultaneous-connections-per-invocation cap, with
// a margin for the Supabase calls before/after the fetch burst.
const CHECK_CONCURRENCY = 5;

interface EndpointRow {
  id: string;
  url: string;
}

/**
 * Runs once a minute for every endpoint. Batches every Supabase call across
 * all endpoints (one lookup, one bulk insert, ...) instead of one-per-endpoint
 * — with enough endpoints, per-endpoint round trips blow through Cloudflare's
 * per-invocation subrequest limit and silently drop checks for whichever
 * endpoints run out of budget. Only the actual target fetches stay per-endpoint,
 * since each is a different URL.
 */
export async function runMinuteCheck(db: SupabaseClient, checkSecret?: string) {
  const { data: endpoints, error } = await db.from("endpoints").select("id, url").returns<EndpointRow[]>();
  if (error) throw error;
  if (!endpoints || endpoints.length === 0) return;

  const previousByEndpoint = await fetchPreviousChecks(
    db,
    endpoints.map((e) => e.id)
  );

  const extraHeaders = checkSecret ? { "X-Health-Check-Secret": checkSecret } : undefined;
  const results = await mapWithConcurrency(endpoints, CHECK_CONCURRENCY, async (endpoint) => ({
    endpoint,
    result: await runCheck(endpoint.url, extraHeaders),
  }));

  const checkedAt = new Date().toISOString();
  const { error: insertError } = await db.from("checks").insert(
    results.map(({ endpoint, result }) => ({
      endpoint_id: endpoint.id,
      checked_at: checkedAt,
      success: result.success,
      status_code: result.status_code,
      response_time_ms: result.response_time_ms,
    }))
  );
  if (insertError) throw insertError;

  await writeStatusChangeEvents(db, results, previousByEndpoint, checkedAt);
}

async function fetchPreviousChecks(db: SupabaseClient, endpointIds: string[]): Promise<Map<string, boolean>> {
  const since = new Date(Date.now() - PREVIOUS_CHECK_LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("checks")
    .select("endpoint_id, checked_at, success")
    .in("endpoint_id", endpointIds)
    .gte("checked_at", since)
    .order("checked_at", { ascending: false })
    .returns<{ endpoint_id: string; checked_at: string; success: boolean }[]>();
  if (error) throw error;

  const previous = new Map<string, boolean>();
  for (const row of data ?? []) {
    if (!previous.has(row.endpoint_id)) previous.set(row.endpoint_id, row.success);
  }
  return previous;
}

async function writeStatusChangeEvents(
  db: SupabaseClient,
  results: { endpoint: EndpointRow; result: { success: boolean } }[],
  previousByEndpoint: Map<string, boolean>,
  checkedAt: string
) {
  const initial: string[] = [];
  const becameHealthy: string[] = [];
  const becameUnhealthy: string[] = [];

  for (const { endpoint, result } of results) {
    const previous = previousByEndpoint.get(endpoint.id);
    if (previous === undefined) {
      initial.push(endpoint.id);
    } else if (previous !== result.success) {
      (result.success ? becameHealthy : becameUnhealthy).push(endpoint.id);
    }
  }

  if (initial.length === 0 && becameHealthy.length === 0 && becameUnhealthy.length === 0) return;

  const lastUnhealthyByEndpoint =
    becameHealthy.length > 0 ? await fetchLastUnhealthyEvents(db, becameHealthy) : new Map<string, string>();

  const eventRows = [
    ...initial.map((endpoint_id) => ({ endpoint_id, type: "initial" as const, occurred_at: checkedAt })),
    ...becameUnhealthy.map((endpoint_id) => ({ endpoint_id, type: "became_unhealthy" as const, occurred_at: checkedAt })),
    ...becameHealthy.map((endpoint_id) => {
      const lastUnhealthyAt = lastUnhealthyByEndpoint.get(endpoint_id);
      const duration_seconds = lastUnhealthyAt
        ? Math.max(0, Math.round((new Date(checkedAt).getTime() - new Date(lastUnhealthyAt).getTime()) / 1000))
        : null;
      return { endpoint_id, type: "became_healthy" as const, occurred_at: checkedAt, duration_seconds };
    }),
  ];

  const { error } = await db.from("events").insert(eventRows);
  if (error) throw error;
}

async function fetchLastUnhealthyEvents(db: SupabaseClient, endpointIds: string[]): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("events")
    .select("endpoint_id, occurred_at")
    .in("endpoint_id", endpointIds)
    .eq("type", "became_unhealthy")
    .order("occurred_at", { ascending: false })
    .returns<{ endpoint_id: string; occurred_at: string }[]>();
  if (error) throw error;

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (!map.has(row.endpoint_id)) map.set(row.endpoint_id, row.occurred_at);
  }
  return map;
}
