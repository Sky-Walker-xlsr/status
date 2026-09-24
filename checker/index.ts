/**
 * ys-status-checker — standalone scheduled Worker that pings every endpoint
 * and writes the results to Supabase.
 *
 * Deliberately separate from the Next.js worker and deliberately tiny: no
 * supabase-js, no framework bundle, just `fetch`. Cron invocations on the
 * Workers Free plan get 10ms of CPU; the old checker (inside the Next.js
 * worker, via supabase-js) routinely hit `exceededCpu` and dropped whole runs.
 * All state + aggregation lives in Postgres (supabase/004_gatus_style_checker.sql),
 * so a run is: 1 GET endpoints → N target fetches → 1 RPC.
 *
 * Check semantics follow gatus: GET, follow redirects, success = HTTP 2xx
 * within the timeout, status changes only after FAILURE_THRESHOLD /
 * SUCCESS_THRESHOLD consecutive results.
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /**
   * Optional. Sent as `X-Health-Check-Secret` so a target zone's WAF can skip
   * Bot Fight Mode / Managed Challenge for the checker only (see README).
   */
  HEALTH_CHECK_SECRET?: string;
}

interface EndpointRow {
  id: string;
  url: string;
}

interface CheckResult {
  endpoint_id: string;
  success: boolean;
  status_code: number | null;
  response_time_ms: number;
}

const CHECK_TIMEOUT_MS = 10_000;
// One retry after a short pause before a check counts as failed — filters out
// single dropped connections between Cloudflare's edge and the target.
const RETRY_DELAY_MS = 2_000;
// Consecutive failed checks (5 min apart) before an endpoint is "unhealthy",
// and consecutive successes before it's "healthy" again.
const FAILURE_THRESHOLD = 2;
const SUCCESS_THRESHOLD = 1;
// Workers cap each invocation at 6 simultaneous open connections; stay under
// it so queued checks don't eat their own timeout waiting for a free slot.
const CHECK_CONCURRENCY = 5;
const USER_AGENT = "ys-status-checker/1.0 (+https://status.yannicksalm.ch)";

export default {
  // One `*/5` trigger drives everything — the Workers Free plan allows only 5
  // cron triggers per *account*, so rollups piggyback on the check run instead
  // of having their own schedules.
  async scheduled(controller: ScheduledController, env: Env) {
    const at = new Date(controller.scheduledTime);
    const tasks = [runChecks(env)];
    if (at.getUTCMinutes() === 0) tasks.push(rpc(env, "rollup_hourly", {}));
    if (at.getUTCHours() === 0 && at.getUTCMinutes() === 5) tasks.push(rpc(env, "rollup_daily", {}));

    // A failed check run must not skip the rollups (or vice versa).
    const failures = (await Promise.allSettled(tasks)).filter((r) => r.status === "rejected");
    for (const f of failures) console.error(f.reason instanceof Error ? f.reason.message : String(f.reason));
    if (failures.length > 0) throw new Error(`Scheduled run failed (${failures.length} task(s), see logs)`);
  },
} satisfies ExportedHandler<Env>;

async function runChecks(env: Env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/endpoints?select=id,url`, { headers: supabaseHeaders(env) });
  if (!res.ok) throw new Error(`Loading endpoints failed: ${res.status} ${await res.text()}`);
  const endpoints = (await res.json()) as EndpointRow[];
  if (endpoints.length === 0) return;

  // Same timestamp for the whole run, taken at the start (not after the
  // slowest check finished) so runs line up on the 5-minute grid.
  const checkedAt = new Date().toISOString();
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (env.HEALTH_CHECK_SECRET) headers["X-Health-Check-Secret"] = env.HEALTH_CHECK_SECRET;

  const results = await mapWithConcurrency(endpoints, CHECK_CONCURRENCY, async (endpoint): Promise<CheckResult> => {
    let result = await checkOnce(endpoint.url, headers);
    if (!result.success) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      result = await checkOnce(endpoint.url, headers);
    }
    return { endpoint_id: endpoint.id, ...result };
  });

  await rpc(env, "record_check_results", {
    p_checked_at: checkedAt,
    p_results: results,
    p_failure_threshold: FAILURE_THRESHOLD,
    p_success_threshold: SUCCESS_THRESHOLD,
  });
}

async function checkOnce(url: string, headers: Record<string, string>): Promise<Omit<CheckResult, "endpoint_id">> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    const response_time_ms = Date.now() - started;
    // Only the status matters — cancel the body so it doesn't hold one of the
    // 6 connection slots open until the runtime reaps it.
    await response.body?.cancel();
    return { success: response.status >= 200 && response.status < 300, status_code: response.status, response_time_ms };
  } catch (err) {
    console.error(`check failed for ${url}:`, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    return { success: false, status_code: null, response_time_ms: Date.now() - started };
  }
}

async function rpc(env: Env, fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...supabaseHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status} ${await res.text()}`);
  await res.body?.cancel();
}

function supabaseHeaders(env: Env): Record<string, string> {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
