# SETUP.md — Build-Log ys-status

Chronologischer Ablauf vom ersten Scaffold bis zum laufenden Live-Deployment, inkl. aller Bugs, Ursachen und Fixes. Gedacht als Rohmaterial für eigene Doku — kein Endnutzer-Dokument.

---

## 1. Ausgangslage / Auftrag

Eigene Status-Page-Applikation ("Health Dashboard"), angelehnt an [gatus](https://github.com/TwiN/gatus), aber komplett selbst gebaut:

- Next.js (App Router, TS) auf Cloudflare Workers via `@opennextjs/cloudflare`
- Supabase (Postgres) als DB, legacy API keys (`anon` fürs Frontend, `service_role` nur serverseitig)
- Tailwind CSS, dunkles Theme (`#171717` bg, `#21F1A8` success, `#990011` danger)
- Rein lesend, kein Login, Endpoints per SQL gepflegt (kein Admin-UI)
- Cloudflare Cron Triggers statt `node-cron`, da Workers keinen dauerhaften Prozess haben

3-stufiges Rollup-Modell für exakte Uptime-% ohne die DB unbegrenzt wachsen zu lassen:

| Tabelle | Granularität | Retention |
|---|---|---|
| `checks` | 1 Zeile/Check, jede Minute | 24h |
| `hourly_stats` | 1 Zeile/Endpoint/Stunde | 7 Tage |
| `daily_stats` | 1 Zeile/Endpoint/Tag | für immer |
| `events` | nur bei Statuswechsel | für immer (bleibt klein) |

---

## 2. Erstes Scaffold

Komplett neu aufgesetzt (kein Template): `package.json`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `next.config.ts`, `open-next.config.ts`, Tailwind-Farbschema in `globals.css`.

**Datenbankschema** (`supabase/001_init.sql`): `endpoints`, `checks`, `hourly_stats`, `daily_stats`, `events` inkl. RLS-Policies (public read, kein Write für `anon`/`authenticated` — nur `service_role` schreibt).

**Custom Worker Entry** (`worker.ts`): OpenNext generiert nur einen `fetch`-Handler. Für die drei Cron Triggers (`* * * * *`, `0 * * * *`, `5 0 * * *`) braucht es einen eigenen Worker-Entry, der den generierten Next.js-Handler aus `.open-next/worker.js` importiert und um `scheduled()` ergänzt:

```ts
import { default as nextHandler } from "./.open-next/worker.js";
export default {
  fetch: nextHandler.fetch,
  async scheduled(controller, env) { /* dispatch auf controller.cron */ },
};
```
`wrangler.jsonc` → `"main": "worker.ts"` (nicht `.open-next/worker.js` direkt).

**Frontend**: Overview-Seite (`/`) mit Endpoint-Cards + Mini-Bar-Chart, Detail-Seite (`/endpoint/[id]`) mit Stat-Cards, Recharts-Trend-Chart, Uptime-Stats, Events-Liste. Alles Client Components, die direkt via `anon`-Key aus Supabase lesen (kein eigener Backend-API-Layer) und per `setInterval` pollen.

**Checker-Logik** (`lib/checker/`): `runCheck.ts` (HTTP GET, 10s Timeout, Erfolg = 2xx), `minuteCheck.ts` / `hourlyRollup.ts` / `dailyRollup.ts` — initial jeweils mit einer `Promise.all(endpoints.map(...))`-Schleife pro Endpoint (siehe Bug #3, das war der große Fehler).

---

## 3. Bugs & Fixes (chronologisch)

### Bug 1 — npm peer-dependency conflict beim Install

**Problem:** `npm install` schlug fehl: `@opennextjs/cloudflare@^1.19.2` löste auf `1.20.6` auf, welches `next >=16.3.3` als Peer verlangt — wir hatten aber `next: 16.2.4` gepinnt (Kopie von ys-workout).

**Fix:** `@opennextjs/cloudflare` exakt auf `1.19.2` gepinnt (matched `next 16.2.4`s tatsächliches Peer-Range `>=15.5.15 <16 || >=16.2.3`). Später (siehe Bug 4) wieder aufgehoben.

### Bug 2 — TypeScript `never`-Errors bei Supabase-Queries

**Problem:** `supabase-js` ohne generischen `Database`-Typ liefert bei `.select("spalte1, spalte2, ...")` (mehrspaltiger String, nicht `"*"`) einen `never`-Row-Typ zurück → TS-Fehler wie `Property 'day' does not exist on type 'never'`.

**Fix:** Überall `.returns<MeinRowType[]>()` nach der Query angehängt, um den Row-Typ explizit zu erzwingen (idiomatisches supabase-js-v2-Pattern statt `as X[]`-Casts, die bei `null`-Row-Typen ebenfalls TS-Fehler werfen).

### Bug 3 — "Too many subrequests by single Worker invocation" (größter Bug, echter Datenverlust)

**Problem:** Nach dem ersten Deploy zeigte das Dashboard für die meisten Endpoints **gar keine Checks** (nicht mal fehlgeschlagene) — nur 2 von ~15 Endpoints hatten Daten. `wrangler tail` zeigte:
```
(warn) A stalled HTTP response was canceled to prevent deadlock...
[ERROR] Too many subrequests by single Worker invocation.
```

**Ursache:** `minuteCheck.ts` machte pro Endpoint einzeln: 1 SELECT (previous check) + 1 fetch (Ziel-URL) + 1 INSERT (checks) + ggf. 1-2 weitere für Events. Bei 15+ Endpoints × 3-5 Subrequests = 45-75 Subrequests pro einzelner Worker-Invocation — über dem Cloudflare-Limit. Sobald das Budget aufgebraucht war, warfen die Supabase-Calls für die restlichen Endpoints eine ungefangene Exception → deren `checkOneEndpoint`-Promise rejected, ohne je eine Zeile zu schreiben. Zusätzlich wurde der `fetch()`-Response-Body nie gelesen (`response.status` reicht ja) → Workers-Runtime cancelt "stalled" Responses nach einer gewissen Anzahl gleichzeitig offener, ungelesener Bodies.

**Fix:**
1. `runCheck.ts`: `await response.body?.cancel()` nach jedem Fetch (Body sauber verwerfen statt liegen lassen).
2. `minuteCheck.ts`, `hourlyRollup.ts`, `dailyRollup.ts` komplett umgebaut: **ein** Bulk-SELECT für alle Endpoints statt N Einzel-Queries, **ein** Bulk-INSERT/UPSERT für alle Ergebnisse statt N Einzel-Writes, Aggregation/Gruppierung passiert in JS (`Map<endpoint_id, ...>`). Subrequest-Anzahl ist jetzt konstant (~4-6) unabhängig von der Endpoint-Anzahl — einzig die tatsächlichen Ziel-Fetches skalieren noch mit N (unvermeidbar, das ist die eigentliche Arbeit).

**Verifiziert:** `wrangler tail` über einen echten Minuten-Tick — 19/19 Endpoints bekommen jetzt jede Minute einen Check, keine Warnings mehr.

### Bug 4 — 500 Internal Server Error nach erstem Deploy (`ChunkLoadError`)

**Problem:** Erste `npm run deploy` lief durch, aber jede Seite gab `500` zurück. `wrangler tail`:
```
ChunkLoadError: Failed to load chunk server/chunks/ssr/_1ktnnjr._.js from runtime for chunk server/app/page.js
```

**Ursache:** `@opennextjs/cloudflare@1.19.2` (siehe Bug 1) hat einen Kompatibilitäts-Patch für Turbopack-Wasm-Loader, der auf das Chunk-Format von Next.js bis 16.2 ausgelegt war. Wir hatten aber Next.js zwischenzeitlich auf `16.3.5` gehoben (wegen npm-audit-Fixes, siehe unten) — Next 16.3 emittiert diese Chunks anders, der alte Patch griff nicht mehr. Fix dafür kam offiziell erst in `@opennextjs/cloudflare@1.20.3`.

**Fix:** `@opennextjs/cloudflare` von `1.19.2` auf `1.20.6` (latest) gehoben — der ursprüngliche Grund für das Pinnen (Bug 1) war mit `next@16.3.5` ohnehin hinfällig, `1.20.6`s Peer-Range passt jetzt.

**Nebenfund:** Das `@ts-expect-error`-Pragma vor dem `.open-next/worker.js`-Import wurde nach dem Upgrade zum TS-Fehler (`Unused '@ts-expect-error' directive`), weil die neuere OpenNext-Version jetzt sauber auflösbare Typen generiert. Auf `@ts-ignore` (+ `eslint-disable-next-line` für die ESLint-Regel, die `@ts-ignore` verbietet) gewechselt, weil ob der Import einen echten TS-Fehler wirft vom Build-Zustand abhängt (`.open-next/worker.js` existiert vor dem ersten Build gar nicht) — `@ts-ignore` flackert bei sowas nicht wie `@ts-expect-error`.

### Bug 5 — npm audit: 3 Vulnerabilities (2 high, 1 critical) in `next@16.2.4`

**Problem:** `npm audit` zeigte kritische/hohe CVEs in `next` (u.a. DoS, Cache-Poisoning, SSRF-Varianten), gefixt erst ab `next@16.3.5`.

**Fix:** `next` von `16.2.4` auf `16.3.5` gehoben (im erlaubten Peer-Range von `@opennextjs/cloudflare`). Löste in Kombination mit dem alten `@opennextjs/cloudflare@1.19.2` dann Bug 4 aus — beide Fixes gehören zusammen.

### Bug 6 — Mehrere Cloudflare-Accounts, `wrangler deploy` braucht `account_id`

**Problem:** Das Cloudflare-Login (`yannick.salm@bluewin.ch`) hat Zugriff auf 4 Accounts (Frauenverein Sarmenstorf, Small Customers, Yannick Dev, yannicksalm.ch) — `wrangler deploy` hätte interaktiv nach dem Account gefragt, was in einer nicht-interaktiven Umgebung hängen bleibt.

**Fix:** `"account_id": "b7cc1bc9eeaec1c7dd4e9308c4c7cfc5"` (Account `yannicksalm.ch`, selber Account wie `pt.yannicksalm.ch` etc.) explizit in `wrangler.jsonc` eingetragen.

### Bug 7 — 403 Forbidden bei xavistylist.ch / admin.xavistylist.ch trotz laufender Seite

**Problem:** Beide Endpoints liefen einwandfrei (curl von aussen: `200 OK`), aber der Checker bekam konsistent `403`.

**Ursache:** Der Checker läuft selbst als Cloudflare Worker — die Requests kommen also aus Cloudflares eigenem Netz. Cloudflares Bot Management auf der Ziel-Zone (Bot Fight Mode / Super Bot Fight Mode) stuft Workers-zu-Workers/Zone-Traffic offenbar als automatisiert ein und blockt ihn, obwohl normale Browser-Requests durchkommen. Verifiziert durch Vergleich: `curl` (auch ohne User-Agent) von einer regulären IP bekam `200`, exakt derselbe Request-Pfad vom Worker aus bekam `403` — der Unterschied ist die Netzwerk-Herkunft, nicht Header/Fingerprinting.

**Fix:** Checker schickt jetzt bei jedem Request einen Header `X-Health-Check-Secret: <random 32-byte secret>` mit (`lib/checker/runCheck.ts`, `env.HEALTH_CHECK_SECRET` als Wrangler-Secret). Auf der Ziel-Zone (xavistylist.ch, **nicht** in diesem Projekt) eine WAF Custom Rule mit Skip-Action angelegt:
```
(http.request.headers["x-health-check-secret"][0] eq "<secret>")
```
→ Action: Skip Bot Fight Mode / Super Bot Fight Mode / Managed Challenge. Damit umgeht nur der Checker den Bot-Schutz, alle anderen Besucher bleiben geschützt. Nach Einrichtung der Regel: beide Endpoints wieder healthy (verifiziert über `events`-Tabelle, `became_healthy` @ 07:32 UTC).

### Bug 8 — Kaputte/unvollständige Zeilen in `insert.sql`

Mehrfach aufgetreten beim manuellen Editieren von `insert.sql`:
- Leere `('', '', 'https://.yannicksalm.ch')`-Zeile (Name/Gruppe leer, URL ohne Subdomain) — entfernt, da nicht erratbar was gemeint war.
- `'Psono Vault'` mit `https://.yannicksalm.ch` (fehlende Subdomain) — erst später auf `https://psono.yannicksalm.ch/#!/` korrigiert.
- `update ... where name = 'A', 'B';` — ungültiges SQL (kein `IN`), korrigiert zu `where name in ('A', 'B')`.
- `'1.1.1.1'` als nackter URL-String ohne Schema — `fetch()` braucht ein absolutes URL mit `http(s)://`, sonst wirft es sofort (wird als permanent down gewertet). Korrigiert zu `https://1.1.1.1`.

**Lektion:** `insert.sql` ist reines Handwerkszeug ohne Constraint-Checks auf Name/URL-Validität — Tippfehler fallen erst beim nächsten Minuten-Tick auf (leere Karten oder `~10s`-Latenz durch Timeout), nicht beim Ausführen des SQL.

---

## 4. Feature-Erweiterungen (kein Bug, aber wichtige Design-Entscheidungen)

### `hide_url` — Domain vor öffentlichem Dashboard verstecken

Anforderung: manche Endpoints (v.a. PostgREST/Supabase-URLs mit generischer Subdomain) sollen im Dashboard nicht mit echter Domain auftauchen.

**Wichtige Erkenntnis unterwegs:** Ein reines UI-Flag (Domain im Frontend einfach nicht rendern) reicht **nicht** — der `anon`-Key steckt im JS-Bundle, jeder könnte die Supabase-REST-API direkt mit `SELECT * FROM endpoints` abfragen und die echte URL trotzdem auslesen, RLS-Policy erlaubt ja `SELECT` für alle. Deshalb zweistufig gelöst:
1. `002_hide_url.sql` — `endpoints.hide_url boolean`.
2. `003_endpoints_public_view.sql` — `anon`/`authenticated` das direkte `SELECT` auf `endpoints` entzogen (`revoke select on endpoints from anon, authenticated`), stattdessen View `endpoints_public`, die `url` für `hide_url = true`-Zeilen auf DB-Ebene zu `null` maskiert. Frontend liest nur noch aus der View. Checker-Worker (`service_role`) liest weiterhin direkt aus `endpoints`, unbetroffen von Grants/RLS.

**Folge-Bug:** Ein `UPDATE endpoints_public SET url = ...` (versehentlich gegen die View statt die Tabelle) schlägt fehl, weil `url` in der View eine berechnete `CASE`-Expression ist, keine simple Spalte — Postgres lässt das nicht automatisch durchschreiben. Schreibzugriffe müssen immer gegen die reale `endpoints`-Tabelle gehen.

### "Clients"-Gruppe

`group_name` ist freier Text — eine neue Gruppe "Clients" brauchte **keine Code-Änderung**, taucht automatisch im "Filter by"-Dropdown auf. Für die realen Domains der Kundenprojekte (frauenverein-sarmenstorf, supcomp, xavi, xavi-admin) wurde der Rest des Monorepos durchsucht (wrangler.toml, README, Audit-Docs) statt zu raten; für `styl` und `teamevent-umfrage` wurde keine Live-Domain gefunden — als TODO-Kommentar in `insert.sql` stehen gelassen statt geraten.

---

## 5. Cleanup nach Stabilisierung

Nach den Fixes (Bug 3, 7) enthielt die DB ~60 fehlgeschlagene Checks und 4 `became_healthy`-Events, die reine Setup-Artefakte waren (Psono/Homepage/Xavi/Xavi-Admin, bevor die jeweiligen Fixes griffen) — keine echten Ausfälle. Bereinigt:
- Alle `checks`-Zeilen mit `success = false` gelöscht (60 Zeilen).
- Die 4 zugehörigen `became_healthy`-Events gelöscht (hätten sonst fälschlich einen "Ausfall + Recovery" im Events-Log suggeriert).
- `initial`-Events (12 Stück, für alle Endpoints) bewusst **behalten** — die sind legitime "Monitoring gestartet"-Marker, keine Noise.
- `hourly_stats`/`daily_stats` waren zu dem Zeitpunkt noch leer (erster Rollup lief noch nicht), nichts zu bereinigen.

---

## 6. UI-Update: Header, Icon, GitHub-Link

Anforderung: grösserer Header, animiertes Icon aus der animate-ui-Registry, Text "YS. Health Dashboard" ohne Untertitel, echter GitHub-Link unten rechts.

**Ablauf:** `npx shadcn@latest add @animate-ui/icons-activity`. Da noch kein `components.json` existierte, löste das automatisch `shadcn init` aus (nicht explizit angefordert).

**Ursache/Problem:** `shadcn init` hat mehr gemacht als nur die Icon-Komponente zu holen — es injizierte eine komplette parallele oklch-Theme-Struktur in `globals.css` (`.dark`-Klasse, `--background`/`--foreground`-Tokens, ein `@layer base`-Block der `body { @apply bg-background text-foreground }` erzwingt) und tauschte den Font in `layout.tsx` (Geist). Das kollidierte direkt mit dem bereits bestehenden, selbstgebauten `[data-theme]`-Attribut-Theme-System (zwei parallele, sich überschreibende Theming-Mechanismen).

**Fix:** `git checkout -- app/globals.css app/layout.tsx` — beide zurück auf committeten Stand, danach nur das behalten, was die Icon-Komponente tatsächlich braucht: `lib/utils.ts` (cn-Helper), `components/animate-ui/`, `hooks/use-is-in-view.tsx`, `components.json`. Ungenutztes Scaffold (`components/ui/button.tsx`) gelöscht.

**Bug 9 — Fehler in der geladenen Registry-Datei selbst:** `components/animate-ui/icons/icon.tsx` übergab an zwei Stellen einen `render`-Prop an `<AnimateIcon>`, das aber laut eigenem Typ nur `asChild` + `children` kennt — `render` wäre unbenutzt in `...props` gelandet (falsches Runtime-Verhalten) und brach ausserdem den Typecheck (`Property 'render' does not exist on type 'IntrinsicAttributes & AnimateIconProps<string>'`). Kein Fehler in unserem Code, sondern im Registry-Snippet selbst. Fix: beide Stellen auf `<AnimateIcon asChild>...<IconComponent .../></AnimateIcon>` (Slot-Pattern mit `children` statt `render`) umgeschrieben.

**Ergebnis:** `Header.tsx` neu geschrieben — `ActivityIcon` (animate-ui, `size={40}`, `animateOnHover`, Farbe `var(--color-success)`), Text `YS. Health Dashboard`, kein Untertitel mehr. GitHub-Link unten rechts von Platzhalter (`https://github.com/`) auf `https://github.com/Sky-Walker-xlsr/status` gesetzt.

## 7. GitHub-Repo Setup & Push

- Ziel-Repo `Sky-Walker-xlsr/status` existierte bereits (leer, öffentlich).
- SSH-Identität war bereits vorkonfiguriert (`~/.ssh/config`, Host-Alias `github-sky-walker-xlsr`, eigener Key getrennt von der `homepagesya1`-Identität, die für die übrigen ys-*-Repos verwendet wird) — kein zusätzliches Auth-Setup nötig, direkt getestet via `ssh -T git@github-sky-walker-xlsr`.
- **Da das Repo öffentlich ist:** kompletter `supabase/`-Ordner in `.gitignore` aufgenommen (auf expliziten Wunsch) — enthält u.a. `insert.sql` mit echten internen Admin-Panel-URLs (Coolify, PgAdmin, Zitadel-Auth, Backup-Tool). `.env.local` war schon vorher ignoriert.
- Vor dem ersten Commit alle gestagten Dateien nach Secret-Mustern durchsucht (`eyJ...`/JWT-Strings, `service_role`, `HEALTH_CHECK_SECRET`-Werte) — einzig der bewusst öffentliche Supabase-`anon`-Key in `wrangler.jsonc` gefunden (unkritisch per Design, RLS-geschützt), sonst nichts.
- Initial Commit + `git push -u origin main`.

**Bekannter Nebeneffekt:** `README.md`/`SETUP.md` verlinken auf Dateien unter `supabase/` (z.B. `supabase/001_init.sql`) — die liegen wegen des Gitignore-Eintrags nicht im öffentlichen Repo, die Links sind auf GitHub also tot. Bewusst so gelassen (explizite User-Entscheidung fürs Ausblenden), nicht automatisch "repariert".

## 8. Kontrast-Fix (Light Theme) & Light/Dark-Favicon

**Kontrast:** Nach einer manuellen Anpassung von `--color-bg` im Light-Theme auf `#fcf6f5` (warmes Off-White) stand die Frage, ob `--color-card` (`#ffffff`) noch genug Kontrast zum Hintergrund hat.

**Erkenntnis:** `#ffffff` ist bereits die maximal mögliche Helligkeit — über reine Lightness lässt sich der Kontrast zum fast-weissen Hintergrund nicht weiter steigern (rechnerisches Kontrastverhältnis ~1.03:1, praktisch nicht wahrnehmbar). Die Karten-Füllfarbe selbst war also schon optimal; der Hebel musste woanders ansetzen.

**Fix:** `--color-border` von neutralem Grau (`#e2e2e2`) auf einen zum Hintergrund passenden warmen Ton (`#e5d8d4`) gesetzt, `--shadow-card` warm eingefärbt und leicht verstärkt (`rgba(133, 77, 60, 0.09)` statt reinem Schwarz-Schatten). Rand + Schatten übernehmen die Abgrenzung, nicht die Füllfarbe. Visuell per Playwright-Screenshot verifiziert (Karten jetzt klar vom Hintergrund unterscheidbar). Dark Theme unangetastet.

**Favicon je nach Browser-Farbschema:** Next.js' `icon.svg`-Dateikonvention kann nur ein einzelnes statisches Icon ausliefern, keine Variante nach `prefers-color-scheme`. Stattdessen `metadata.icons` in `layout.tsx` mit je einem `media`-Query pro Icon genutzt:
```ts
icons: {
  icon: [
    { url: "/icon_black.svg", media: "(prefers-color-scheme: light)" },
    { url: "/icon_white.svg", media: "(prefers-color-scheme: dark)" },
  ],
},
```
Das erzeugt zwei `<link rel="icon" media="...">`-Tags im `<head>`, der Browser wählt selbst anhand seines/des OS-Farbschemas — unabhängig vom In-App-Theme-Toggle, der nur unsere eigenen CSS-Variablen steuert.

**Stolperstein:** `icon_black.svg`/`icon_white.svg` lagen ursprünglich direkt in `app/` — dort liefert Next.js aber nur seine Sonderdateien (page.tsx, `icon.png`, `favicon.ico`, …) automatisch aus, beliebig benannte Dateien sind dort unter keiner URL erreichbar. Nach `public/` verschoben, damit `/icon_black.svg` etc. tatsächlich auflösbar sind — vorher waren beide Dateien faktisch tot.

---

## 9. Aktueller Stand

- Live: `https://ys-status.yannick-salm.workers.dev` (Account `yannicksalm.ch`, Account-ID `b7cc1bc9eeaec1c7dd4e9308c4c7cfc5`)
- GitHub: `https://github.com/Sky-Walker-xlsr/status` (öffentlich, `supabase/`-Ordner ausgeschlossen) — Stand des Repos: nur der initiale Commit. Header/Icon-Update (Abschnitt 6) und Kontrast/Favicon-Fix (Abschnitt 8) sind live deployed, aber **noch nicht committed/gepusht**.
- Alle 3 Cron Triggers laufen (`* * * * *`, `0 * * * *`, `5 0 * * *`), verifiziert über `wrangler tail`
- Secrets gesetzt: `SUPABASE_SERVICE_ROLE_KEY`, `HEALTH_CHECK_SECRET`
- ~19 Endpoints aktiv überwacht (Infrastruktur, Monitoring, Web-Apps, DB, Clients)
- Offene Punkte:
  - `styl` und `teamevent-umfrage` brauchen noch eine echte Domain in `insert.sql`
  - Custom-Domain-Route (`status.yannicksalm.ch`) in `wrangler.jsonc` ist noch auskommentiert, DNS-Setup steht noch aus
  - Lokale Änderungen aus Abschnitt 6 + 8 noch nicht committed/gepusht
  - Tote `supabase/`-Links in README.md/SETUP.md auf GitHub (siehe Abschnitt 7)
