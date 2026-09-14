/** Bindings the scheduled worker needs — the subset of wrangler.jsonc `vars` plus the service-role secret. */
export interface CheckerEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /**
   * Optional. Sent as the `X-Health-Check-Secret` header on every check
   * request, so a target zone's WAF can allowlist the checker specifically
   * (e.g. to skip Bot Fight Mode/Managed Challenge for Cloudflare-hosted
   * targets that otherwise 403 Workers-originated traffic) without weakening
   * bot protection for real visitors. Checks run fine without it — it's only
   * needed for targets that block Workers-to-Workers/zone traffic.
   */
  HEALTH_CHECK_SECRET?: string;
}
