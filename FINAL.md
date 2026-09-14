# FINAL.md — ys-status, komplettes finales Setup

Vollständige Referenz des aktuellen Endzustands: Architektur, Datenmodell, Sicherheitsmodell, Dateistruktur, Betrieb. Im Gegensatz zu [SETUP.md](SETUP.md) (chronologischer Bug-Log) beschreibt dieses Dokument **nur den Ist-Zustand**, ohne Historie.

---

## 1. Überblick

"Health Dashboard" — öffentliche, rein lesende Status-Page für selbst gehostete Infrastruktur, Web-Apps und Kundenprojekte. Kein Login, kein Admin-UI, Endpoints werden per SQL gepflegt.

**Stack:**

| Ebene | Technologie |
|---|---|
| Frontend | Next.js 16 (App Router, TypeScript, Client Components), Tailwind CSS 4 |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` |
| Datenbank | Supabase (Postgres), legacy API keys (`anon` + `service_role`) |
| Scheduling | Cloudflare Cron Triggers (kein separater Cron-Dienst) |
| Charts | Recharts (Response-Time-Trend), selbstgebaute Bar-Charts (Checks) |
| Icons/Animation | animate-ui (Registry via shadcn CLI), motion (Framer Motion) |

**Live:** `https://ys-status.yannick-salm.workers.dev`
**Repo:** `https://github.com/Sky-Walker-xlsr/status` (öffentlich)

---

## 2. Architektur

Ein einziger Cloudflare Worker bedient zwei völlig unabhängige Aufgaben über einen gemeinsamen Entry-Point (`worker.ts`):

```
                        ┌─────────────────────────┐
   HTTP Request  ─────► │  worker.ts               │
   (Browser)            │  export default {         │
                        │    fetch: nextHandler.fetch│──► Next.js (OpenNext) ──► Supabase (anon key)
                        │    scheduled(controller)   │
                        │  }                         │
   Cron Trigger ───────►│                            │──► lib/checker/* (service_role key)
   (Cloudflare, intern)  └─────────────────────────┘
```

- **`fetch`**: kommt 1:1 vom OpenNext-generierten Next.js-Handler (`.open-next/worker.js`, Build-Artefakt). Bedient die zwei Seiten (`/`, `/endpoint/[id]`), die client-seitig direkt gegen die Supabase-REST-API (View `endpoints_public`, Tabellen `checks`/`events`/`hourly_stats`/`daily_stats`) lesen — **kein eigener Backend-API-Layer**.
- **`scheduled`**: dispatcht anhand `controller.cron` auf `lib/checker/minuteCheck.ts` / `hourlyRollup.ts` / `dailyRollup.ts`, die mit dem `service_role`-Key schreiben (RLS-Bypass).

Frontend pollt periodisch (Overview konfigurierbar per Refresh-Chip, Detail fest alle 60s) statt Websockets/Realtime zu nutzen.

---

## 3. Datenmodell (Supabase / Postgres)

```
endpoints ──┬── checks         (1 Zeile/Minute, Retention 24h)
            ├── hourly_stats   (1 Zeile/Endpoint/Stunde, Retention 7 Tage)
            ├── daily_stats    (1 Zeile/Endpoint/Tag, Retention für immer)
            └── events         (nur bei Statuswechsel, Retention für immer)

endpoints_public  (View über endpoints, maskiert url bei hide_url=true)
```

### `endpoints`
| Spalte | Typ | Bemerkung |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `group_name` | text | frei wählbar, treibt das "Filter by"-Dropdown im Frontend |
| `url` | text | vom Checker gepingte URL |
| `hide_url` | boolean, default `false` | siehe Abschnitt 4 |
| `created_at` | timestamptz | |

### `checks` (Rohdaten, 24h Retention)
`id`, `endpoint_id`, `checked_at`, `success` (bool), `status_code` (int, nullable), `response_time_ms` (int). Index `(endpoint_id, checked_at desc)`.

### `hourly_stats` / `daily_stats` (Rollups)
`id`, `endpoint_id`, `hour_start` / `day`, `total_checks`, `successful_checks`, `avg_response_time_ms`, `min_response_time_ms`, `max_response_time_ms`. Unique `(endpoint_id, hour_start)` bzw. `(endpoint_id, day)` — Upsert-Ziel für die Rollup-Jobs.

### `events`
`id`, `endpoint_id`, `type` (`initial` | `became_healthy` | `became_unhealthy`), `occurred_at`, `duration_seconds` (nur bei `became_healthy`: wie lange der vorherige Ausfall dauerte).

### `endpoints_public` (View, siehe `003_endpoints_public_view.sql`)
```sql
select id, name, group_name,
  case when hide_url then null else url end as url,
  hide_url, created_at
from endpoints;
```
Einzige Tabelle/View, aus der das Frontend liest (`anon`-Key). Direkter `SELECT` auf `endpoints` ist `anon`/`authenticated` entzogen (`revoke select on endpoints from anon, authenticated`).

**Rollup-Kaskade** (warum 3 Stufen statt einer simplen Tages-Ja/Nein-Regel): jede Ebene liefert exakte Uptime-% für ihren Zeitraum, ohne die DB unbegrenzt wachsen zu lassen. 1h/24h-Stats kommen direkt aus `checks`, 7d aus `hourly_stats`, 30d aus `daily_stats` (mit Fallback auf `hourly_stats` für die letzten 1-2 Tage, die der Daily-Rollup noch nicht erfasst hat — der läuft erst um 00:05 UTC für den Vortag).

---

## 4. Sicherheitsmodell

Drei unabhängige Schutzschichten:

1. **RLS**: `select`-Policies (`using (true)`) auf allen Tabellen für Lesezugriff — aber `endpoints` selbst hat für `anon`/`authenticated` gar kein `SELECT`-Grant mehr (siehe Punkt 2), RLS allein reicht hier also nicht.
2. **`endpoints_public`-View + Grant-Revoke**: verhindert, dass eine als `hide_url=true` markierte URL überhaupt an den Client geht — nicht nur im UI versteckt, sondern auf DB-Ebene `null`. Betrifft z.B. PostgREST/Supabase-URLs mit generischer Subdomain (`Xavi Test-DB`, `YS-Home-DB` aktuell so markiert).
3. **`HEALTH_CHECK_SECRET`-Header**: der Checker schickt bei jedem Check `X-Health-Check-Secret: <secret>` mit. Für Zielseiten, die selbst auf Cloudflare liegen und den Worker-Traffic per Bot Fight Mode/Super Bot Fight Mode blocken, kann auf der **Zielseite** (nicht hier) eine WAF-Skip-Rule für diesen Header angelegt werden — betroffen war `xavistylist.ch`/`admin.xavistylist.ch`, siehe [SETUP.md](SETUP.md) Bug 7.

**Was der `service_role`-Key sieht:** alles, ungefiltert — RLS und Grants gelten nicht für ihn. Ausschliesslich im Checker-Worker verwendet (`lib/checker/db.ts`), nie im Frontend-Code, nie in einer `NEXT_PUBLIC_*`-Variable.

---

## 5. Verzeichnisstruktur

```
worker.ts                        Custom Cloudflare Worker Entry (fetch + scheduled)
open-next.config.ts              OpenNext-Konfiguration (default)
wrangler.jsonc                   Worker-Config: vars, Cron Triggers, account_id
wrangler.jsonc.example           Platzhalter-Version zum Zurücksetzen

app/
  layout.tsx                     Root-Layout, Theme-Init-Script, Favicon-Metadata
  globals.css                    CSS-Variablen-Theme (dark/light via [data-theme])
  page.tsx                       Overview-Seite (Client Component)
  endpoint/[id]/page.tsx          Detail-Seite (Server-Wrapper um EndpointDetail)

components/
  Header.tsx, SearchFilterBar.tsx, EndpointCard.tsx, ChecksBarChart.tsx,
  EndpointDetail.tsx, StatCard.tsx, PillBadge.tsx, StatusBadge.tsx,
  ResponseTimeTrendChart.tsx, EventsList.tsx, Pagination.tsx,
  RefreshIntervalChip.tsx, ThemeToggle.tsx    Alles Client Components
  animate-ui/                     Registry-Code (Activity-Icon + Motion-Primitives)

lib/
  types.ts                       Geteilte TS-Typen (Endpoint, Check, StatusEvent, ...)
  format.ts                      Zeit-/Zahlen-Formatierung, hostOf()
  stats.ts                       PeriodTotals-Aggregation (combineTotals, uptimePercent)
  supabase/client.ts              anon-Key Browser-Client (Singleton)
  queries/overview.ts             Datenabruf für die Overview-Seite
  queries/detail.ts               Datenabruf für die Detail-Seite (Perioden, Trend, Pagination)
  checker/
    types.ts                     CheckerEnv (Worker-Bindings-Typ)
    db.ts                        service_role-Client
    runCheck.ts                  Einzelner HTTP-Check (loggt Fehlerursache bei Fehlschlag)
    concurrency.ts                mapWithConcurrency() — begrenzt gleichzeitige Checks auf 5
    minuteCheck.ts               Minuten-Cron: Checks (max. 5 parallel) + Event-Erkennung (gebatched)
    hourlyRollup.ts               Stunden-Cron: checks → hourly_stats (gebatched)
    dailyRollup.ts                Tages-Cron: hourly_stats → daily_stats (gebatched)
  utils.ts                        cn()-Helper (für animate-ui)

hooks/use-is-in-view.tsx          IntersectionObserver-Hook (für animate-ui)

supabase/                         NICHT im öffentlichen Repo (siehe .gitignore)
  001_init.sql                    Basisschema + RLS
  002_hide_url.sql                endpoints.hide_url
  003_endpoints_public_view.sql   endpoints_public View + Grant-Revoke
  insert.sql                      Echte Endpoint-Inserts (interne URLs, deshalb ignored)

public/
  icon_black.svg, icon_white.svg  Favicons für prefers-color-scheme: light/dark
```

---

## 6. Theming

CSS-Variablen in `app/globals.css`, umgeschaltet über `[data-theme="dark"|"light"]` auf `<html>` (nicht `prefers-color-scheme` — das ist bewusst nur für den Favicon reserviert, siehe unten). Default ohne Attribut: **dark**.

| Variable | Dark | Light |
|---|---|---|
| `--color-bg` | `#171717` | `#fcf6f5` |
| `--color-card` | `#1f1f1f` | `#ffffff` |
| `--color-border` | `#2a2a2a` | `#e5d8d4` (warm getönt, an `--color-bg` angepasst) |
| `--color-success` | `#21f1a8` | `#0ea472` |
| `--color-danger` | `#990011` | `#990011` |
| `--color-accent` (Chart) | `#60a5fa` | `#3b82f6` |

`ThemeToggle.tsx` schreibt die Wahl in `localStorage` (`ys-status-theme`); ein Inline-`<script>` in `layout.tsx` liest das vor dem ersten Paint, um einen Theme-Flash zu vermeiden.

**Favicon** ist davon komplett unabhängig — der reagiert nur auf `prefers-color-scheme` (Browser/OS-Einstellung), nicht auf den In-App-Toggle:
```ts
// app/layout.tsx
icons: {
  icon: [
    { url: "/icon_black.svg", media: "(prefers-color-scheme: light)" },
    { url: "/icon_white.svg", media: "(prefers-color-scheme: dark)" },
  ],
},
```

---

## 7. Deployment & Betrieb

**Cloudflare:** Account `yannicksalm.ch` (`account_id: b7cc1bc9eeaec1c7dd4e9308c4c7cfc5`), Worker-Name `ys-status`. Domain-Route (`status.yannicksalm.ch`) ist in `wrangler.jsonc` vorbereitet, aber auskommentiert — noch kein DNS-Eintrag.

```bash
npm run deploy    # opennextjs-cloudflare build && opennextjs-cloudflare deploy
npm run preview   # lokale Cloudflare-Simulation
npx wrangler tail --format pretty     # Live-Logs (auch der Cron-Ticks)
```

**Secrets** (nicht in `wrangler.jsonc`, via `wrangler secret put <NAME>`):

| Secret | Zweck |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Checker-Worker-DB-Zugriff (RLS-Bypass) |
| `HEALTH_CHECK_SECRET` | `X-Health-Check-Secret`-Header, siehe Abschnitt 4 |

**Nicht-secret Vars** (in `wrangler.jsonc` committed, da öffentlich sicher — `anon`-Key ist RLS-geschützt):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Lokale Entwicklung:** `.env.local` (gitignored) mit denselben drei Keys + `HEALTH_CHECK_SECRET`, siehe `.env.example` für die Struktur.

**Migrationen:** kein Runner — `supabase/00X_*.sql` der Reihe nach manuell im Supabase SQL Editor ausführen. Reihenfolge: `001_init.sql` → `002_hide_url.sql` → `003_endpoints_public_view.sql`.

**Neuen Endpoint hinzufügen:**
```sql
insert into endpoints (name, group_name, url) values
  ('Mein Service', 'Infrastruktur', 'https://service.example.com');
```
Wird automatisch beim nächsten Minuten-Cron erfasst, kein Deploy nötig. Für eine versteckte URL zusätzlich `update endpoints set hide_url = true where name = '...';`.

---

## 8. Aktueller Live-Stand

- **19 Endpoints** über 8 Gruppen: Infrastruktur (7, in zwei leicht unterschiedlich geschriebenen Gruppen — siehe unten), Clients (3), Web-App (3), Monitoring (2), DB (2), Homepage (1), Test (1) — alle healthy
- Alle 3 Cron Triggers aktiv (`* * * * *` Checks, `0 * * * *` Hourly-Rollup, `5 0 * * *` Daily-Rollup um 00:05 UTC)
- Checks laufen mit max. 5 gleichzeitigen Requests pro Tick (`lib/checker/concurrency.ts`) — wichtig ab ca. 7 Endpoints, siehe SETUP.md Bug 10
- 2 Endpoints mit `hide_url = true` (Xavi Test-DB, YS-Home-DB)

**Bekannte kleine Unsauberkeiten** (nicht funktional kritisch, aber erwähnenswert):
- `group_name` "Infrastruktur" und "Infrastrucktur" (Tippfehler) existieren parallel → zwei separate Einträge im "Filter by"-Dropdown statt einem.
- `Psono Vault` hat weiterhin eine unvollständige URL (`https://.yannicksalm.ch`, fehlende Subdomain) in `insert.sql` — beim letzten Check noch nicht korrigiert.
- `styl` (Coiffeur Aarau) und `teamevent-umfrage` haben noch keinen Eintrag — keine verifizierte Live-Domain gefunden.
- README.md/SETUP.md verlinken auf `supabase/*.sql`-Dateien, die im öffentlichen GitHub-Repo nicht vorhanden sind (bewusst ausgeschlossen, siehe SETUP.md Abschnitt 7).
- GitGuardian meldet den `anon`-Key in `wrangler.jsonc` als JWT — false positive, siehe SETUP.md Abschnitt 10.

Details zu allen Bugs, Entscheidungen und deren Begründung: siehe [SETUP.md](SETUP.md). Setup-/Deploy-Anleitung für Neuaufsetzen: siehe [README.md](README.md).
