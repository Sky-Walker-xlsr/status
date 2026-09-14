/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once.
 *
 * Cloudflare Workers cap each invocation at 6 simultaneous connections
 * waiting for response headers (fetch/KV/R2/etc. all count). Firing every
 * endpoint check via a single `Promise.all` exceeds that once there are more
 * than ~6 endpoints — the overflow queues, and a queued check can blow past
 * its own timeout waiting for a free slot even though the target is healthy.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
