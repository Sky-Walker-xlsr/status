const CHECK_TIMEOUT_MS = 10_000;

export interface CheckResult {
  success: boolean;
  status_code: number | null;
  response_time_ms: number;
}

/**
 * GET the endpoint URL (not HEAD — spec requires a real response body) with a
 * timeout. Success = HTTP 2xx. Anything else (4xx/5xx/timeout/DNS/connection
 * error) counts as a failed check.
 */
export async function runCheck(url: string, extraHeaders?: Record<string, string>): Promise<CheckResult> {
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: extraHeaders,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    const response_time_ms = Date.now() - started;

    // We only care about the status — drain the body without reading it, or the
    // Workers runtime cancels the response as a stalled/unread deadlock risk once
    // enough checks are in flight at once.
    await response.body?.cancel();

    return {
      success: response.status >= 200 && response.status < 300,
      status_code: response.status,
      response_time_ms,
    };
  } catch {
    return {
      success: false,
      status_code: null,
      response_time_ms: Date.now() - started,
    };
  }
}
