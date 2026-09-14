import { getSupabaseClient } from "@/lib/supabase/client";
import type { Check, Endpoint } from "@/lib/types";

export interface OverviewData {
  endpoints: Endpoint[];
  checksByEndpoint: Record<string, Check[]>;
}

// Wide enough window to guarantee >= MAX_CHECKS_PER_ENDPOINT rows per endpoint
// even if a few checks were missed, without scanning the full 24h retention.
const RECENT_WINDOW_HOURS = 4;
const MAX_CHECKS_PER_ENDPOINT = 30;

export async function fetchOverviewData(): Promise<OverviewData> {
  const supabase = getSupabaseClient();

  const { data: endpoints, error: endpointsError } = await supabase
    .from("endpoints_public")
    .select("*")
    .order("name", { ascending: true });
  if (endpointsError) throw endpointsError;

  const since = new Date(Date.now() - RECENT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data: checks, error: checksError } = await supabase
    .from("checks")
    .select("*")
    .gte("checked_at", since)
    .order("checked_at", { ascending: false })
    .limit(5000);
  if (checksError) throw checksError;

  const checksByEndpoint: Record<string, Check[]> = {};
  for (const check of (checks ?? []) as Check[]) {
    const list = checksByEndpoint[check.endpoint_id] ?? (checksByEndpoint[check.endpoint_id] = []);
    if (list.length < MAX_CHECKS_PER_ENDPOINT) list.push(check);
  }

  return { endpoints: (endpoints ?? []) as Endpoint[], checksByEndpoint };
}
