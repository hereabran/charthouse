# Architecture

System design reference for **helm-playground** — a real-time Helm chart
templating UI. Edits in the browser are debounced and rendered server-side
through the Helm Go SDK; the rendered manifest streams back into a read-only
output column. Nothing the user does is persisted server-side beyond an
optional, opt-in short-share row.

- For endpoint request/response contracts, see [API.md](API.md).
- For local setup, ports, scripts, and verification, see [DEVELOPMENT.md](DEVELOPMENT.md).
- For the harness map and session workflow, see [../CLAUDE.md](../CLAUDE.md).

> Accuracy note: rendering is done **in-process via the Helm v4 Go SDK**
> (`helm.sh/helm/v4`), not by shelling out to a `helm` binary. There is no
> `helm` CLI exec and no `HELM_BIN` is consulted anywhere in the code. The
> diagram below labels that step "Helm Go SDK" for that reason.

---

## 1. Overview

Two processes cooperate in development:

- **Frontend** — a Vite + React 19 + TypeScript SPA (Gruvbox theme), served by
  the Vite dev server on port **5173**.
- **Backend** — three stateless Go HTTP handlers (`render`, `share`, `import`),
  wired together for local dev by `cmd/dev/main.go` on port **5174**. In
  production these same handlers deploy as Vercel-style Go serverless functions
  under `api/`.

The Vite dev server proxies `/api/*` to the Go server; the Go server does **not**
serve or proxy the frontend and sets no CORS headers (none are needed because
the browser only ever talks to the Vite origin).

### Data-flow: edit → render → output

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Browser  (React SPA, 3-column UI, http://localhost:5173)                │
 │                                                                          │
 │  TemplatePanel        ValuesPanel            RenderedOutput              │
 │  (files + Monaco)     (values + override)    (read-only Monaco)         │
 │        │                    │                       ▲                    │
 │        └──────┬─────────────┘                       │                    │
 │               ▼                                      │                    │
 │        chart-store (Zustand, persisted 'hp:chart')   │                    │
 │               │  files / releaseName / namespace      │                    │
 │               ▼                                      │                    │
 │     useDebouncedRender(300ms) ──► helm-client.renderChart()             │
 │               │   POST /api/render {files, releaseName, namespace}       │
 └───────────────┼──────────────────────────────────────┼──────────────────┘
                 │ (Vite proxies /api -> :5174)          │ render-store
                 ▼                                        │ {ok,stdout,...}
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Go server  (cmd/dev/main.go, http://localhost:5174)                     │
 │   mux: /api/render  /api/share  /api/import   (catch-all -> 404 JSON)   │
 │                                                                          │
 │   /api/render handler (api/render/index.go):                            │
 │     1. validate + write files to os.MkdirTemp("helm-pg-*")/chart        │
 │     2. cli.New() with all Helm state pinned inside the temp dir          │
 │     3. action.NewInstall, DryRunStrategy=DryRunClient, driver "memory"  │
 │     4. loader.Load(chartDir); client.RunWithContext(ctx, chart, values) │
 │     5. read rendered manifest; defer os.RemoveAll(tempRoot)             │
 │                          │                                               │
 │                   Helm Go SDK (in-process, no helm binary)              │
 │                          ▼                                               │
 │            rendered YAML manifest -> {ok, stdout, stderr, durationMs}    │
 └────────────────────────────────────────────────────────────────────────┘
                 ▲                                        │
                 │  response                              │
                 └────────────────────────────────────────┘
                        flows back to RenderedOutput
```

The same path serves the two side features: `/api/import` fetches a chart
archive over HTTP and returns its files; `/api/share` reads/writes a short-share
row in Supabase.

---

## 2. Frontend architecture

Entry chain: `index.html` (pre-paint theme script) → `src/main.tsx`
(`ReactDOM.createRoot`, `<React.StrictMode>`) → `src/App.tsx`.

`App.tsx` renders a fixed vertical stack:

```
App
├── Toolbar              (release/namespace inputs, Import, Upload, Reset, Share, Theme, docs link)
├── ThreeColumnLayout
│     ├── left   = TemplatePanel   (FileTree over Monaco editor for the active file)
│     ├── middle = ValuesPanel     (values.yaml / values.override.yaml tabs + schema validation)
│     └── right  = RenderedOutput  (read-only Monaco showing render stdout, split into docs)
├── StatusBar            (footer)
└── DropOverlay          (whole-window drag-and-drop target)
```

### 2.1 Three-column layout

`src/components/layout/ThreeColumnLayout.tsx` is a CSS grid:
`minmax(220px, w0fr) 6px minmax(220px, w1fr) 6px minmax(260px, w2fr)` with two
6px draggable `Splitter`s. Default weights `DEFAULT_WEIGHTS = [1, 1, 1.2]` (the
output column is widest). Weights persist to `localStorage['hp:layout:weights']`;
`MIN_WEIGHT = 0.25`; double-clicking a splitter resets to defaults. Below the
Tailwind `lg` breakpoint the grid collapses to a vertical stack.

### 2.2 Zustand stores (state ownership)

| Store | File | Persisted? | Owns |
| --- | --- | --- | --- |
| **chart-store** | `src/store/chart-store.ts` | yes — `localStorage['hp:chart']` | `files: ChartFiles`, `activePath` (init `templates/deployment.yaml`), `releaseName` (init `demo`), `namespace` (init `default`); initial files = `SAMPLE_CHART`. Mutators: `setActivePath`, `setFile`, `renameFile`, `deleteFile`, `deleteFolder`, `addFile`, `replaceAll(files, {release?, namespace?})`, `setReleaseName`, `setNamespace`, `resetToSample`. Helpers `isValuesFile`, `isChartYaml`. |
| **render-store** | `src/store/render-store.ts` | no | Latest render result: `loading`, `ok` (init `true`), `stdout`, `stderr`, `durationMs`, `helmVersion?`, `lastRenderedAt`, `error`. Actions `setLoading` (clears error), `setResult` (stamps `lastRenderedAt`), `setError`. |
| **theme-store** | `src/store/theme-store.ts` | yes — `hp:theme`, `hp:accent` | `theme: 'dark' \| 'light'` and `accent` CSS var. `applyTheme` toggles `html.dark`; `applyAccent` sets `--gv-accent` on `documentElement`. Exports `ACCENT_COLORS` (7: aqua, blue, green, yellow, orange, red, purple). |
| **border-store** | `src/store/border-store.ts` | yes — `hp:border` (`'sharp' \| 'rounded'`) | `sharp` boolean; `applySharp` toggles `html.sharp` (which zeroes all `rounded-*` radii via globals.css). |

`chart-store` is the **only persisted chart state** — it is the source of truth
the render hook subscribes to. `theme-store` and `border-store` both apply their
state to the DOM at module load via `getState()`.

### 2.3 Debounced render hook

`src/lib/use-debounced-render.ts` — `useDebouncedRender(delayMs = 350)`, but
`App.tsx` calls it as `useDebouncedRender(300)`, so the **effective debounce is
300 ms**. It subscribes to `files`, `releaseName`, and `namespace`; on any
change it starts a `setTimeout`. When the timer fires it aborts the previous
`AbortController`, calls `setLoading(true)`, invokes `renderChart({files,
releaseName, namespace}, signal)`, then `setResult()`. `AbortError` is swallowed
(superseded render); other errors go to `setError()`.

### 2.4 Client libraries (`src/lib/`)

| Lib | Responsibility |
| --- | --- |
| `helm-client.ts` | `renderChart(req, signal)`: `POST /api/render` with JSON `RenderRequest`. Treats **HTTP 422 as a valid response** carrying Helm errors (does not throw); throws on other non-2xx. |
| `share-client.ts` | Share encode/decode. `encodePayloadToHash` / `decodePayloadFromHash` (`pako` deflate + base64url, `#h=` prefix). `createShortShare` (`POST /api/share`; returns `null` on 503) and `loadShortShare` (`GET /api/share?id=`; returns `null` on 404/503). |
| `import-client.ts` | `importChartFromURL(url, signal)`: `POST /api/import {url}`; returns `{files, source}`; throws `body.error` on failure. Types `ImportSource`, `ImportResult`. |
| `chart-archive.ts` | Client-side archive parsing: `readZip` (JSZip), `readTgz` (`pako.inflate` + a hand-written POSIX/GNU tar parser), `readFolderInput` (`webkitRelativePath`), `readArchive` (dispatch by extension). Shared `stripChartRoot` + `SKIP_BINARY_EXT`. |
| `schema-validate.ts` | `validateValues(schemaJson, valuesYaml)`: Ajv compile + `js-yaml` load; maps each error to a Monaco `IMarkerData` (severity 2 = Warning) using a hand-built YAML line map. |
| `sample-chart.ts` | `SAMPLE_CHART`: the default `ChartFiles` (Chart.yaml, values.yaml, values.schema.json, values.override.yaml, templates/_helpers.tpl, deployment.yaml, service.yaml). |

The editor itself (`src/components/editor/CodeEditor.tsx`) is a
`@monaco-editor/react` wrapper that loads Monaco **0.52.2 from the jsdelivr CDN**
and defines `gruvbox-dark` / `gruvbox-light` themes keyed by accent. Offline use
breaks the editor because Monaco is remote.

---

## 3. Backend architecture

Three handlers, each exporting `Handler(w, r)`, deployable independently. Every
JSON reply sets `content-type: application/json; charset=utf-8` and
`cache-control: no-store` (the bodiless `405 Method Not Allowed` branch only
sets the `Allow` header).

### 3.1 Dev server — `cmd/dev/main.go`

Builds an `http.ServeMux`, registers exactly three exact paths, and a catch-all:

```
/api/render -> render.Handler
/api/share  -> share.Handler
/api/import -> importchart.Handler
/           -> 404 JSON {"error":"not found","path":<r.URL.Path>}
```

Binds one TCP port from `API_PORT` (default **5174**), listening on `:`+port via
`http.ListenAndServe`. There is no health-check or version endpoint — every
other path is the catch-all 404. The dev server does **not** serve the Vite
frontend; `vite.config.ts` proxies `/api` → `http://localhost:5174`
(`changeOrigin: true`) in the other direction.

### 3.2 `/api/render` — `api/render/index.go`

POST only (non-POST → 405 with `Allow: POST`). The render pipeline:

1. Decode `renderInput` (body capped at 5 MiB via `http.MaxBytesReader`); decode
   failure → 400.
2. Sanitize names: `releaseName` → lowercase `[a-z0-9-]`, fallback `demo`, max 53;
   `namespace` → same rules, fallback `default`, max 63.
3. `writeChart`: validate (≥1 file, `Chart.yaml` required, ≤500 files, ≤256 KiB
   per file, ≤4 MiB total) and path-safety (`isSafeRelPath` rejects leading `/`,
   `..`, NUL, backslashes, etc.), then write to a fresh
   `os.MkdirTemp("", "helm-pg-")` with a `chart/` subdir. The temp root is
   always removed via `defer os.RemoveAll(root)`.
4. If `files["values.override.yaml"]` is present and non-blank, parse it with
   `loader.LoadValues` and use it as the install values; otherwise values are an
   empty map.
5. `settings := cli.New()`, with **all Helm state pinned inside the temp root**
   (`RegistryConfig`, `RepositoryConfig`, `RepositoryCache`, `PluginsDirectory`,
   `ContentCache`). `actionConfig.Init(getter, namespace, "memory")` — the
   `"memory"` storage driver keeps nothing on disk.
6. `loader.Load(chartDir)`, then `client := action.NewInstall(actionConfig)` with
   `DryRunStrategy = action.DryRunClient`, `IncludeCRDs = input.IncludeCRDs`,
   `Timeout = renderTimeout` (10s). Executed via `client.RunWithContext(ctx, ch, values)`.
7. Return the rendered manifest (`accessor.Manifest()`) as `stdout`.

Render is **in-process** — `action.NewInstall + DryRunClient` is the SDK
equivalent of `helm install --dry-run` / `helm template`. The 10s timeout is
enforced both via `context.WithTimeout` and `client.Timeout`; on timeout the
handler returns **422** with `render timed out after 10000ms`. `helmVersion` is
read from build info for dep `helm.sh/helm/v4` (e.g. `v4.2.0 sdk`).

Status codes: 200 ok; 400 bad request / input validation; 422 invalid
`values.override.yaml`, chart-load errors, Helm render errors, and timeouts;
500 SDK init errors; 405 wrong method. See [API.md](API.md) for the full
request/response contract.

### 3.3 `/api/import` — `api/import/index.go` + `api/import/repo.go`

POST only (8 KiB body cap). Accepts `{url}` (http/https only). `resolveURL`
(in `repo.go`) handles three URL shapes:

1. **Direct archive** (`.tgz` / `.tar.gz` / `.zip`) — used as-is.
2. **Repo base URL** — fetches `<base>/index.yaml`; auto-picks if exactly one
   chart entry, else 422 listing all charts (or erroring if none).
3. **Repo + chart URL** — strips the last path segment as the chart name,
   fetches the parent `index.yaml`, and picks the latest (first) version.

Plain GitHub repo URLs are not specially handled.

**SSRF protection** (`safeDialContext`): resolves the host via
`net.DefaultResolver` and refuses to dial any IP that is loopback, unspecified,
link-local, multicast, or RFC1918 private; it dials the validated resolved IP
directly to close the resolve-vs-dial TOCTOU race. RFC 6598 (`100.64.0.0/10`,
Tailscale CGNAT) is deliberately allowed. Redirects are allowlisted (max 5, each
target re-validated). Download limits: 32 MiB per archive/index, 2 MiB per
extracted file, 1000 files max, 16 MiB total extracted; 10s per-fetch timeout,
20s overall handler context. Extraction strips the common chart-root dir
(mirroring `src/lib/chart-archive.ts`), skips binary extensions, applies a
path-traversal guard, and requires a `Chart.yaml` entry (else 422).

### 3.4 `/api/share` — `api/share/index.go`

GET (`?id=`) and POST; other methods → 405 (`Allow: GET, POST`). Returns **503**
with `sharing not configured: ...` when either `SUPABASE_URL` or
`SUPABASE_SERVICE_ROLE_KEY` is empty — the SPA reads that as "use the hash
fallback." Persistence is the **Supabase PostgREST REST API over plain HTTP**
(`net/http`) — there is no Postgres/pg driver. Both reads and writes send the
service-role key as **both** `apikey` and `Authorization: Bearer`, which bypasses
row-level security.

- **GET**: validates `id` against `^[a-z0-9]{6,16}$`; queries
  `<SUPABASE_URL>/rest/v1/helm_playground_shares?id=eq.<id>&select=payload&limit=1`.
  Empty result → 404.
- **POST**: body capped at 256 KiB; payload must start with `{`. Generates an
  8-char id from alphabet `23456789abcdefghjkmnpqrstuvwxyz` via `crypto/rand`
  (slight modulo bias — 31 is not a power of two; non-security-critical at a
  31^8 keyspace), then `POST`s `{id, payload}` with `Prefer: return=minimal`.

Upstream timeout is 8s. Supabase errors map to 502; internal marshal/id errors
to 500.

---

## 4. Data model

### 4.1 Ephemeral in-browser chart state

The entire workspace lives in `chart-store` and `localStorage['hp:chart']`. The
shareable unit is `SharePayload` (`src/types/chart.ts`), which has exactly three
fields:

```ts
type ChartFiles = Record<string, string>   // relative path -> file content

interface SharePayload {
  files: ChartFiles
  releaseName: string
  namespace: string
}
```

> Field-name note: `SharePayload` uses `releaseName`, but `chart-store.replaceAll`
> takes `{release?, namespace?}`. `App.tsx` bridges them on load:
> `replaceAll(p.files, { release: p.releaseName, namespace: p.namespace })`.

### 4.2 Supabase shares table

The only server-side persistence. Defined in
`supabase/migrations/20260609000000_helm_playground_shares.sql`:

```sql
create table if not exists public.helm_playground_shares (
  id          text        primary key,
  payload     jsonb       not null,
  created_at  timestamptz not null default now()
);

create index if not exists helm_playground_shares_created_at_idx
  on public.helm_playground_shares (created_at);

alter table public.helm_playground_shares enable row level security;
```

RLS is **enabled with no policies** — only the service-role key (used by
`/api/share`, server-side only) can read or write. `payload` stores the
`SharePayload` JSON verbatim. There is no expiry or garbage collection.

---

## 5. Share system

Two modes, chosen automatically by the result of `createShortShare` in
`ShareButton.tsx`:

1. **Short-URL (Supabase-backed)** — `POST /api/share {payload}` returns
   `{id}`; the share URL is `${location.origin}/s/${id}`. Used when Supabase is
   configured.
2. **Hash fallback (self-contained)** — when `createShortShare` returns `null`
   (server 503 = sharing unconfigured) or throws, the URL becomes
   `${location.origin}/${encodePayloadToHash(payload)}`, i.e.
   `#h=<base64url(pako.deflate(JSON.stringify(payload)))>`. No backend required;
   larger (a few KB), and self-decoding on load.

Either way the URL is auto-copied to the clipboard and shown in a Modal.

**Load on startup** (`useLoadFromUrl` in `App.tsx`):

1. Try `decodePayloadFromHash(location.hash)` (regex `/[#&]h=([A-Za-z0-9_-]+)/`).
   On success: `replaceAll(...)`, then `history.replaceState` to
   `location.pathname` (strips the hash).
2. Else match the path against `/^\/s\/([a-z0-9]{6,16})$/` and call
   `loadShortShare(id)`. On success: `replaceAll(...)`, then `history.replaceState`
   to `/`.

The short-id charset/length (`[a-z0-9]{6,16}`) is what both the client path
matcher and the server `idPattern` expect; the server generates 8-char ids in
that set.

**`/s/:id` rewrite.** Short-URLs are deep links into the SPA. `vercel.json`
rewrites `{ source: '/s/:id', destination: '/' }` so the production host serves
`index.html` for those paths, letting the client-side loader resolve the share.

---

## 6. Theming

Gruvbox **hard** palette, defined as CSS variables in
`src/styles/gruvbox.css`:

- `:root` = light theme (`--gv-bg: #f9f5d7`, …).
- `html.dark` = dark theme (`--gv-bg: #1d2021`, …).
- `--gv-accent` defaults to `--gv-aqua` in both.

`index.html` applies `html.dark` from `localStorage['hp:theme']` **before paint**
to avoid a flash. `ThemeButton` (via `theme-store`) toggles `html.dark`, sets one
of 7 accent swatches (`--gv-accent`, persisted as `hp:accent`), and toggles
sharp/rounded corners (via `border-store` → `html.sharp`, which overrides all
Tailwind `rounded-*` to `0` in `src/styles/globals.css`). Monaco mirrors the
palette through its `gruvbox-dark` / `gruvbox-light` themes.

---

## 7. Non-goals and constraints

- **No persistent user data.** Charts live only in the browser
  (`localStorage['hp:chart']`); the render backend writes files to a per-request
  temp dir and removes it with `defer os.RemoveAll`. The Supabase shares table is
  the sole opt-in exception and stores only what the user explicitly shares.
- **Ephemeral, stateless render workspace.** Each render gets a fresh
  `os.MkdirTemp` and the `"memory"` Helm storage driver — no cross-request state,
  no cluster contact (dry-run only).
- **No auth, no CORS on the Go server.** The dev server exposes the three
  handlers without authentication; the browser reaches them only through the Vite
  proxy. `/api/render` executes arbitrary chart templates (Go/Sprig templating)
  in-process under a 10s timeout — a templating surface, but no shell exec.
- **No `helm` binary.** Rendering is the Helm Go SDK in-process; `HELM_BIN` in
  `.env.example` is stale/unused.
- **CDN dependency.** Monaco loads from jsdelivr; the editors do not work fully
  offline.
- **Exactly three endpoints.** No health/version endpoints; every other path is a
  catch-all 404.

For the exact request/response shapes and status codes of each endpoint, see
[API.md](API.md). For ports, scripts, and how to run all of this locally, see
[DEVELOPMENT.md](DEVELOPMENT.md).
