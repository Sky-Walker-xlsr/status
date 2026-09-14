"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import SearchFilterBar, { type SortBy } from "@/components/SearchFilterBar";
import EndpointCard from "@/components/EndpointCard";
import ThemeToggle from "@/components/ThemeToggle";
import RefreshIntervalChip from "@/components/RefreshIntervalChip";
import { fetchOverviewData, type OverviewData } from "@/lib/queries/overview";
import type { Check } from "@/lib/types";

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.19-3.37-1.19-.46-1.19-1.11-1.51-1.11-1.51-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.55 2.34 1.1 2.91.84.09-.65.34-1.1.62-1.35-2.22-.26-4.56-1.13-4.56-5.02 0-1.11.38-2.02 1.02-2.73-.1-.26-.44-1.29.1-2.68 0 0 .84-.27 2.75 1.04a9.3 9.3 0 0 1 5 0c1.9-1.31 2.75-1.04 2.75-1.04.54 1.39.2 2.42.1 2.68.64.71 1.02 1.62 1.02 2.73 0 3.9-2.34 4.76-4.57 5.01.36.32.67.94.67 1.9 0 1.37-.01 2.48-.01 2.81 0 .27.18.6.69.49A10.28 10.28 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function isHealthy(checks: Check[] | undefined): boolean {
  if (!checks || checks.length === 0) return false;
  const latest = [...checks].sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())[0];
  return latest.success;
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [refreshSeconds, setRefreshSeconds] = useState(60);

  async function load() {
    try {
      const result = await fetchOverviewData();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load endpoints");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const interval = setInterval(load, refreshSeconds * 1000);
    return () => clearInterval(interval);
  }, [refreshSeconds]);

  const groups = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.endpoints.map((e) => e.group_name))).sort();
  }, [data]);

  const visibleEndpoints = useMemo(() => {
    if (!data) return [];
    let list = data.endpoints;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    if (groupFilter !== "all") {
      list = list.filter((e) => e.group_name === groupFilter);
    }

    list = [...list];
    if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => {
        const aHealthy = isHealthy(data.checksByEndpoint[a.id]);
        const bHealthy = isHealthy(data.checksByEndpoint[b.id]);
        if (aHealthy === bHealthy) return a.name.localeCompare(b.name);
        return aHealthy ? 1 : -1;
      });
    }

    return list;
  }, [data, search, groupFilter, sortBy]);

  return (
    <div className="min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <Header />

        <SearchFilterBar
          search={search}
          onSearchChange={setSearch}
          groups={groups}
          groupFilter={groupFilter}
          onGroupFilterChange={setGroupFilter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
        />

        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger-text)" }}>
            {error}
          </p>
        )}

        {!data && !error && (
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            Loading endpoints…
          </p>
        )}

        {data && visibleEndpoints.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            No endpoints match your filters.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEndpoints.map((endpoint) => (
            <EndpointCard key={endpoint.id} endpoint={endpoint} checks={data?.checksByEndpoint[endpoint.id] ?? []} />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RefreshIntervalChip onChange={setRefreshSeconds} />
            <ThemeToggle />
          </div>
          <a
            href="https://github.com/Sky-Walker-xlsr/status"
            target="_blank"
            rel="noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            aria-label="GitHub"
          >
            <GithubIcon />
          </a>
        </div>
      </div>
    </div>
  );
}
