# ys-status — Health Dashboard

Eigene Status-Page-Applikation (angelehnt an [gatus](https://github.com/TwiN/gatus)), gebaut mit Next.js, Supabase und Cloudflare Workers. Rein lesend, kein Login, keine Admin-UI — Endpoints werden per SQL gepflegt.

## Stack

- Next.js (App Router, TypeScript), Deployment via `@opennextjs/cloudflare`
- Supabase (Postgres), Zugriff über die legacy API keys (`anon` fürs Frontend, `service_role` nur im Checker-Worker)
- Tailwind CSS
- Cloudflare Cron Triggers für den Checker/Rollup-Worker (siehe `worker.ts`)

## Setup

```bash
npm install
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY eintragen
npm run dev                  # http://localhost:3000
```

### Migration ausführen

1. Neues Supabase-Projekt anlegen.
2. Settings → API → die drei **legacy** Keys (Project URL, `anon`, `service_role`) kopieren.
3. Die Dateien in `supabase/` der Reihe nach im SQL Editor ausführen:
   - [`001_init.sql`](supabase/001_init.sql) — legt `endpoints`, `checks`, `hourly_stats`, `daily_stats`, `events` an inkl. RLS-Policies (public read, kein Write für `anon`).
   - [`002_hide_url.sql`](supabase/002_hide_url.sql) — fügt `endpoints.hide_url` hinzu (siehe unten).
   - [`003_endpoints_public_view.sql`](supabase/003_endpoints_public_view.sql) — maskiert `url` für versteckte Endpoints auch auf DB-Ebene (siehe unten).

Es gibt keinen Migration-Runner — weitere Migrationen als `004_*.sql` etc. in `supabase/` ablegen und manuell ausführen.

### Domain eines Endpoints verstecken

Manche Endpoints (z.B. PostgREST/Supabase-URLs mit generischer, aber nicht-öffentlicher Subdomain) sollen im Dashboard nicht mit ihrer echten Domain auftauchen:

```sql
update endpoints set hide_url = true where name = 'Meine PostgREST API';
```

Das Frontend liest **nicht** direkt aus `endpoints`, sondern aus der View `endpoints_public` (siehe `003_endpoints_public_view.sql`), die `url` für `hide_url = true`-Zeilen auf Datenbankebene auf `null` setzt und `anon`/`authenticated` die direkte `SELECT`-Berechtigung auf `endpoints` entzieht. Die echte URL ist damit auch über die Supabase-REST-API mit dem öffentlichen `anon`-Key nicht mehr auslesbar — nicht nur im UI versteckt. Der Checker-Worker liest weiterhin mit dem `service_role`-Key direkt aus `endpoints` und checkt die echte URL ganz normal.

### Neuen Endpoint hinzufügen

Rein per SQL, keine UI dafür:

```sql
insert into endpoints (name, group_name, url) values
  ('Homepage', 'Infrastructure', 'https://example.com'),
  ('PT Dashboard', 'Infrastructure', 'https://pt.yannicksalm.ch');
```

Der Checker holt sich neue Endpoints automatisch beim nächsten Minuten-Cron — kein Deploy nötig.

### Bot-Schutz auf Zielseiten umgehen

Der Checker läuft selbst als Cloudflare Worker, also kommen die Health-Check-Requests aus Cloudflares eigenem Netz. Zielseiten, die ebenfalls auf Cloudflare liegen und Bot Fight Mode / Super Bot Fight Mode aktiv haben, blocken das oft als automatisierten Traffic (403) — selbst wenn die Seite für normale Besucher einwandfrei läuft.

Fix: der Checker schickt bei jedem Request den Header `X-Health-Check-Secret` mit (Wert = `HEALTH_CHECK_SECRET`, siehe `.env.example` / `wrangler secret put HEALTH_CHECK_SECRET`). Auf der **Zielseite** (nicht hier im Projekt) in Cloudflare eine WAF Custom Rule anlegen:

- Security → WAF → Custom rules → Create rule
- Field: `Header` → `X-Health-Check-Secret` → `equals` → `<HEALTH_CHECK_SECRET-Wert>`
- Action: **Skip** → Bot Fight Mode / Super Bot Fight Mode / Managed Challenge

Damit umgeht nur der Checker (mit dem korrekten Secret) den Bot-Schutz — für alle anderen Besucher bleibt er aktiv.

## Wie es funktioniert

- **Jede Minute** (`* * * * *`): `worker.ts` → `lib/checker/minuteCheck.ts` macht für jeden Endpoint ein GET (10s Timeout, Erfolg = HTTP 2xx), schreibt eine Zeile in `checks` und bei Statuswechsel eine Zeile in `events`.
- **Stündlich** (`0 * * * *`): `lib/checker/hourlyRollup.ts` aggregiert die letzte volle Stunde in `hourly_stats`, löscht `checks` älter als 24h.
- **Täglich um 00:05 UTC** (`5 0 * * *`): `lib/checker/dailyRollup.ts` aggregiert den Vortag in `daily_stats`, löscht `hourly_stats` älter als 7 Tage.

Das Frontend (`lib/queries/`) liest je nach Zeitraum aus der passenden Tabelle: 1h/24h direkt aus `checks`, 7d aus `hourly_stats`, 30d aus `daily_stats` (mit Fallback auf `hourly_stats` für die letzten 1-2 Tage, die `daily_stats` noch nicht gerollt hat).

## Deployment auf Cloudflare

```bash
cp wrangler.jsonc.example wrangler.jsonc   # falls noch nicht vorhanden
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in wrangler.jsonc eintragen
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

npm run deploy   # opennextjs-cloudflare build && opennextjs-cloudflare deploy
```

`wrangler.jsonc` (`main: "worker.ts"`) verwendet einen Custom Worker Entry: `worker.ts` importiert den von OpenNext generierten Fetch-Handler aus `.open-next/worker.js` und ergänzt ihn um den `scheduled`-Handler für die drei Cron Triggers. Die Domain/Route in `wrangler.jsonc` ist noch auskommentiert — nach DNS-Setup aktivieren.

Lokal testen:

```bash
npm run preview   # opennextjs-cloudflare build && opennextjs-cloudflare preview
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"   # Minuten-Check manuell triggern
```

## Scripts

| Command | Zweck |
|---|---|
| `npm run dev` | Next.js Dev-Server |
| `npm run build` | Next.js Production Build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type Check |
| `npm run preview` | Lokale Cloudflare-Preview |
| `npm run deploy` | Deploy auf Cloudflare Workers |
