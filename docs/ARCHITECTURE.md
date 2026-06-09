# Architecture

System design reference for **Charthouse** — a playground for Helm charts. Edits
in the browser are debounced and rendered server-side through the Helm Go SDK; the
rendered manifest streams back into a read-only output column, and can be inspected
as a resource-topology graph. Nothing the user does is persisted server-side beyond
an optional, opt-in short-share record.

- For endpoint request/response contracts, see [API.md](API.md).
- For local setup, ports, scripts, and verification, see [DEVELOPMENT.md](DEVELOPMENT.md).
- For the harness map and session workflow, see [../CLAUDE.md](../CLAUDE.md).

> Naming note: "Helm" is a trademark of the Linux Foundation / CNCF. Charthouse
> uses it nominatively only ("a playground for Helm charts") and implies no
> endorsement. The Go module, the `package.json` name, and the Docker image are
> all `charthouse`.

> Accuracy note: rendering is done **in-process via the Helm v4 Go SDK**
> (`helm.sh/helm/v4`), not by shelling out to a `helm` binary. There is no
> `helm` CLI exec and no `HELM_BIN` is consulted anywhere in the code (it has
> been removed from `.env.example`). The diagram below labels that step
> "Helm Go SDK" for that reason.

---

## 1. Overview

Charthouse ships in two deployment shapes that share the same three Go HTTP
handlers (`render`, `share`, `import`), each exporting `Handler(w, r)`:

- **Self-hosted single binary** (primary) — `cmd/server/main.go` serves the three
  handlers **plus the built SPA** (embedded at compile time), so one static binary
  or the Docker image needs no external service. Binds `PORT` (default **8080**).
- **Development** — `cmd/dev/main.go` runs the three handlers only, on port
  **5174**; the Vite dev server (port **5173**) serves the SPA and proxies
  `/api/*` to it.
- **Vercel-style serverless** (optional) — the same `api/*/index.go` handlers
  deploy as individual Go functions; `vercel.json` declares them and rewrites
  `/s/:id`.

In development two processes cooperate:

- **Frontend** — a Vite + React 19 + TypeScript SPA (Gruvbox theme), served by
  the Vite dev server on port **5173**.
- **Backend** — the three handlers wired together by `cmd/dev/main.go` on port
  **5174**.

The Vite dev server proxies `/api/*` to the dev server; the dev server does
**not** serve the frontend and sets no CORS headers (none are needed because the
browser only talks to the Vite origin). In the self-hosted binary the SPA and the
API share one origin, so CORS is moot there too.

### Data-flow: edit → render → output

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Browser  (React SPA, 3-column UI, http://localhost:5173)                │
 │                                                                          │
 │  TemplatePanel /        ValuesPanel            RenderedOutput            │
 │  SingleTemplatePanel    (mode-aware)           (read-only Monaco         │
 │  (left, mode-aware)                            + "topology" button)      │
 │        │                    │                       ▲                    │
 │        └──────┬─────────────┘                       │                    │
 │               ▼                                      │                    │
 │        chart-store (Zustand, persisted 'hp:chart')   │                    │
 │          mode + files / single* + release / namespace │                    │
 │               │  buildRenderFiles(state)              │                    │
 │               ▼                                      │                    │
 │     useDebouncedRender(300ms) ──► helm-client.renderChart()             │
 │               │   POST /api/render {files, releaseName, namespace}       │
 └───────────────┼──────────────────────────────────────┼──────────────────┘
                 │ (Vite proxies /api -> :5174)          │ render-store
                 ▼                                        │ {ok,stdout,...}
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Go server  (cmd/dev :5174  |  cmd/server :8080 + embedded SPA)          │
 │   mux: /api/render  /api/share  /api/import                              │
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
record through a pluggable store.

The rendered output also feeds a **resource-topology viewer**: a pure-TS engine
parses the rendered YAML and infers relationships between resources, which a lazy
React Flow modal draws as a graph (see §5).

---

## 2. Frontend architecture

Entry chain: `index.html` (pre-paint theme script, `<title>` "Charthouse — Helm
chart playground") → `src/main.tsx` (`ReactDOM.createRoot`, `<React.StrictMode>`)
→ `src/App.tsx`.

`App.tsx` renders a fixed vertical stack. The **left column swaps by editing
mode**: a full-chart file tree, or a single template editor.

```
App
├── Toolbar              (mode toggle "Chart | Single file", release/namespace,
│                         Import, Upload, Reset, Share, Theme, docs link)
├── ThreeColumnLayout
│     ├── left   = TemplatePanel        (chart mode: FileTree over Monaco)
│     │            SingleTemplatePanel   (single mode: one template editor)
│     ├── middle = ValuesPanel          (values.yaml / override tabs, shared by both modes
│     │                                   + schema validation in chart mode)
│     └── right  = RenderedOutput       (read-only Monaco + topology button)
├── StatusBar            (footer)
└── DropOverlay          (whole-window drag-and-drop target)
```

`App.tsx` selects the left panel directly:
`left={mode === 'single' ? <SingleTemplatePanel /> : <TemplatePanel />}`.

### 2.1 Editing modes — chart vs single

Charthouse has two editing modes (`ChartMode = 'chart' | 'single'`, in
`src/types/chart.ts`), toggled by a segmented control in
`src/components/layout/Toolbar.tsx`.

- **Chart mode** — the workspace is a `ChartFiles` map (relative path → content):
  `Chart.yaml`, `values.yaml`, `templates/…`, etc. `TemplatePanel` shows a file
  tree over the Monaco editor; `ValuesPanel` edits `values.yaml` /
  `values.override.yaml` from the file map and runs schema validation when a
  `values.schema.json` is present.
- **Single mode** — the user edits exactly one template file. The left panel is
  `SingleTemplatePanel` (`src/components/editor/SingleTemplatePanel.tsx`), a bare
  Monaco editor over the `singleTemplate` store field, with no file tree.

Values are **shared** across both modes: `ValuesPanel` is mode-agnostic and always
edits `values.yaml` / `values.override.yaml` in `state.files`. Single mode owns
**only** its scratch `singleTemplate` — so switching modes never overwrites or
loses your values. (This also avoids a Monaco model-sharing pitfall: there is only
ever one document behind the `values.yaml` editor.)

When a render is requested, `buildRenderFiles(state)` (in `chart-store.ts`)
produces the file map sent to `/api/render`:

- **chart** → `state.files` unchanged.
- **single** → a synthesized minimal chart, because Helm requires a `Chart.yaml`,
  reusing the shared values from `files`:

  ```
  Chart.yaml                ->  apiVersion: v2 / name: chart / version: 0.1.0
  templates/template.yaml   ->  singleTemplate            (SINGLE_TEMPLATE_PATH)
  values.yaml               ->  files['values.yaml']
  values.override.yaml      ->  files['values.override.yaml']   (only if non-blank)
  ```

The active mode round-trips through sharing: `SharePayload` carries an optional
`mode` plus a `single { template }` block; values travel in `files` (see §6 / §7).

### 2.2 Three-column layout

`src/components/layout/ThreeColumnLayout.tsx` is a CSS grid:
`minmax(220px, w0fr) 6px minmax(220px, w1fr) 6px minmax(260px, w2fr)` with two
6px draggable `Splitter`s. Default weights `DEFAULT_WEIGHTS = [1, 1, 1.2]` (the
output column is widest). Weights persist to `localStorage['hp:layout:weights']`;
`MIN_WEIGHT = 0.25`; double-clicking a splitter resets to defaults. Below the
Tailwind `lg` breakpoint the grid collapses to a vertical stack.

### 2.3 Zustand stores (state ownership)

| Store | File | Persisted? | Owns |
| --- | --- | --- | --- |
| **chart-store** | `src/store/chart-store.ts` | yes — `localStorage['hp:chart']` | **Chart mode:** `files: ChartFiles`, `activePath` (init `templates/deployment.yaml`); initial files = `SAMPLE_CHART`. **Single mode:** `singleTemplate` (init `SAMPLE_SINGLE_TEMPLATE`) — the scratch template only; values are **shared** via `files`. **Shared:** `mode: 'chart' \| 'single'` (init `chart`), `releaseName` (init `demo`), `namespace` (init `default`). Mutators: `setActivePath`, `setFile`, `renameFile`, `deleteFile`, `deleteFolder`, `addFile`, `replaceAll(files, {release?, namespace?, mode?, single?})`, `setReleaseName`, `setNamespace`, `setMode`, `setSingleTemplate`, `resetToSample`. Helpers `isValuesFile`, `isChartYaml`; the **`buildRenderFiles(state)`** pure function (§2.1). |
| **render-store** | `src/store/render-store.ts` | no | Latest render result: `loading`, `ok` (init `true`), `stdout`, `stderr`, `durationMs`, `helmVersion?`, `lastRenderedAt`, `error`. Actions `setLoading` (clears error), `setResult` (stamps `lastRenderedAt`), `setError`. |
| **theme-store** | `src/store/theme-store.ts` | yes — `hp:theme`, `hp:accent` | `theme: 'dark' \| 'light'` and `accent` CSS var. `applyTheme` toggles `html.dark`; `applyAccent` sets `--gv-accent` on `documentElement`. Exports `ACCENT_COLORS` (7: aqua, blue, green, yellow, orange, red, purple). |
| **border-store** | `src/store/border-store.ts` | yes — `hp:border` (`'sharp' \| 'rounded'`) | `sharp` boolean; `applySharp` toggles `html.sharp` (which zeroes all `rounded-*` radii via globals.css). |

`chart-store` is the **only persisted chart state** — it is the source of truth
the render hook subscribes to (across both modes). `theme-store` and
`border-store` both apply their state to the DOM at module load via `getState()`.

### 2.4 Debounced render hook

`src/lib/use-debounced-render.ts` — `useDebouncedRender(delayMs = 350)`, but
`App.tsx` calls it as `useDebouncedRender(300)`, so the **effective debounce is
300 ms**. It subscribes to the render inputs and runs the render through
`buildRenderFiles(state)` so single mode is wrapped into a chart first. On any
change it starts a `setTimeout`; when the timer fires it aborts the previous
`AbortController`, calls `setLoading(true)`, invokes `renderChart({files,
releaseName, namespace}, signal)`, then `setResult()`. `AbortError` is swallowed
(superseded render); other errors go to `setError()`.

### 2.5 Client libraries (`src/lib/`)

| Lib | Responsibility |
| --- | --- |
| `helm-client.ts` | `renderChart(req, signal)`: `POST /api/render` with JSON `RenderRequest`. Treats **HTTP 422 as a valid response** carrying Helm errors (does not throw); throws on other non-2xx. |
| `share-client.ts` | Share encode/decode. `encodePayloadToHash` / `decodePayloadFromHash` (`pako` deflate + base64url, `#h=` prefix). `createShortShare` (`POST /api/share`; returns `null` on 503) and `loadShortShare` (`GET /api/share?id=`; returns `null` on 404/503). |
| `import-client.ts` | `importChartFromURL(url, signal)`: `POST /api/import {url}`; returns `{files, source}`; throws `body.error` on failure. Types `ImportSource`, `ImportResult`. |
| `chart-archive.ts` | Client-side archive parsing: `readZip` (JSZip), `readTgz` (`pako.inflate` + a hand-written POSIX/GNU tar parser), `readFolderInput` (`webkitRelativePath`), `readArchive` (dispatch by extension). Shared `stripChartRoot` + `SKIP_BINARY_EXT`. |
| `schema-validate.ts` | `validateValues(schemaJson, valuesYaml)`: Ajv compile + `js-yaml` load; maps each error to a Monaco `IMarkerData` (severity 2 = Warning) using a hand-built YAML line map. |
| `sample-chart.ts` | `SAMPLE_CHART`: the default `ChartFiles` (Chart.yaml, values.yaml, values.schema.json, values.override.yaml, templates/_helpers.tpl, deployment.yaml, service.yaml). Also `SAMPLE_SINGLE_TEMPLATE` (the single-mode scratch template). |
| `topology/` | Pure-TS resource-topology engine — `buildTopology(stdout, defaultNamespace)`. See §5. |

The editor itself (`src/components/editor/CodeEditor.tsx`) is a
`@monaco-editor/react` wrapper that loads Monaco **0.52.2 from the jsdelivr CDN**
and defines `gruvbox-dark` / `gruvbox-light` themes keyed by accent. Offline use
breaks the editor because Monaco is remote.

---

## 3. Backend architecture

Three handlers, each exporting `Handler(w, r)`, deployable independently. Every
JSON reply sets `content-type: application/json; charset=utf-8` and
`cache-control: no-store` (the bodiless `405 Method Not Allowed` branch only
sets the `Allow` header). The handlers are wired into three runtimes:

- `cmd/server/main.go` — self-hosted binary (API + embedded SPA), §3.1.
- `cmd/dev/main.go` — dev API only, §3.2.
- `api/*/index.go` — Vercel-style serverless (optional), §8.

### 3.1 Self-hosted server — `cmd/server/main.go`

The single binary that powers self-hosting and the Docker image. It builds an
`http.ServeMux`, registers the three API paths, and mounts an SPA handler at `/`:

```
/api/render -> render.Handler
/api/share  -> share.Handler
/api/import -> importchart.Handler
/           -> spaHandler(embedded dist/)
```

Binds `PORT` (default **8080**) via `http.ListenAndServe(":"+port, mux)`. It logs
the selected `SHARE_STORE` on startup.

**Embedded SPA.** The built frontend is embedded at compile time. `//go:embed`
directives are relative to the embedding file's directory and cannot reference
parents, so the embed lives in the **repo-root package** rather than under
`cmd/server`:

```go
// embed.go  (package charthouse, at the module root)
//go:embed all:dist
var DistFS embed.FS
```

`cmd/server` then `fs.Sub`s into `dist/` and serves it. The `all:` prefix is
important: it includes `dist/.gitkeep` so the package compiles before `pnpm build`
has produced real assets. `.gitignore` ignores `dist/*` but un-ignores
`!dist/.gitkeep`, and the build order is therefore **`pnpm build` before
`go build ./cmd/server`** (the Dockerfile enforces this).

**`spaHandler` routing** (`cmd/server/main.go`):

- Any path under `/api/` that is not one of the three registered routes returns
  a **JSON 404** (`{"error":"not found"}`), never HTML.
- `/` and any path that does not resolve to a real embedded file fall back to
  **`index.html`**, so client-side routes such as `/s/<id>` resolve inside the
  SPA (no separate rewrite config needed when self-hosting).
- Real assets under `assets/` get `cache-control: public, max-age=31536000,
  immutable`; the `index.html` fallback is served `no-cache`.

### 3.2 Dev server — `cmd/dev/main.go`

Registers exactly the three API paths plus a catch-all:

```
/api/render -> render.Handler
/api/share  -> share.Handler
/api/import -> importchart.Handler
/           -> 404 JSON {"error":"not found","path":<r.URL.Path>}
```

Binds one TCP port from `API_PORT` (default **5174**). The dev server does **not**
serve the SPA — `vite.config.ts` proxies `/api` → `http://localhost:5174`
(`changeOrigin: true`) in the other direction. There is no health-check or version
endpoint; every non-API path is the catch-all 404.

### 3.3 `/api/render` — `api/render/index.go`

POST only (non-POST → 405 with `Allow: POST`). The render pipeline:

1. Decode `renderInput` (body capped at **5 MiB** via `http.MaxBytesReader`);
   decode failure → 400.
2. Sanitize names: `releaseName` → lowercase `[a-z0-9-]`, fallback `demo`, max 53;
   `namespace` → same rules, fallback `default`, max 63.
3. `writeChart`: validate (≥1 file, `Chart.yaml` required, **≤500 files, ≤256 KiB
   per file, ≤4 MiB total**) and path-safety (`isSafeRelPath` rejects leading `/`,
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
   `Timeout = renderTimeout` (10s). Executed via
   `client.RunWithContext(ctx, ch, values)`.
7. Return the rendered manifest (`accessor.Manifest()`) as `stdout`.

Render is **in-process** — `action.NewInstall + DryRunClient` is the SDK
equivalent of `helm install --dry-run` / `helm template`. The **10s timeout** is
enforced both via `context.WithTimeout` and `client.Timeout`; on timeout the
handler returns **422** with `render timed out after 10000ms`. `helmVersion` is
read from build info for dep `helm.sh/helm/v4` (e.g. `v4.2.0 sdk`).

Status codes: 200 ok; 400 bad request / input validation; 422 invalid
`values.override.yaml`, chart-load errors, Helm render errors, and timeouts;
500 SDK init errors; 405 wrong method. See [API.md](API.md) for the full
request/response contract.

### 3.4 `/api/import` — `api/import/index.go` + `api/import/repo.go`

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

### 3.5 `/api/share` — `api/share/index.go` + the pluggable store

GET (`?id=`) and POST; other methods → 405 (`Allow: GET, POST`). The handler
itself is store-agnostic: it lazily builds a `store.Store` via `sync.Once` and
delegates persistence to it.

```go
type Store interface {
    Put(ctx context.Context, payload json.RawMessage) (id string, err error)
    Get(ctx context.Context, id string) (payload json.RawMessage, err error)
}
```

`store.New()` (`api/share/store/store.go`) selects the backend from **`SHARE_STORE`**:

| `SHARE_STORE` | Backend | File | Behavior |
| --- | --- | --- | --- |
| `memory` (**default**) | in-process map | `memory.go` | Zero-config, ephemeral — links are lost on process restart. Makes sharing work out of the box. |
| `file` | JSON files | `file.go` | One `<id>.json` per share under `SHARE_DIR` (default `./data/shares`); durable, atomic writes (temp file + rename). Good for single-node self-hosting with a mounted volume. |
| `supabase` | Supabase PostgREST | `supabase.go` | Managed Postgres via the REST API; requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. |

Shared constants live in `store.go`: `MaxPayloadBytes = 256 KiB`, the 8-char id
over alphabet `23456789abcdefghjkmnpqrstuvwxyz` (`NewID`, slight modulo bias —
31 is not a power of two; non-security-critical at a 31^8 keyspace), and
`IDPattern = ^[a-z0-9]{6,16}$` (covers legacy 6–16-char ids).

Handler behavior:

- **GET**: validates `id` against `IDPattern` (400 otherwise); `s.Get(...)`.
  `store.ErrNotFound` → **404**; other store errors → **502**; success → **200**
  `{id, payload}`.
- **POST**: body capped at 256 KiB; payload must start with `{`. `s.Put(...)`
  returns the new id → **200** `{id}`; store error → **502**.
- **503** is returned **only on explicit misconfiguration** — `store.New()`
  failing because `SHARE_STORE=supabase` is missing its credentials, or
  `SHARE_STORE` is an unknown value. With the default memory store sharing always
  works, so the SPA's `#h=` hash fallback now only triggers on that rare 503.

The `supabase` backend uses the **PostgREST REST API over plain HTTP**
(`net/http`) against table `charthouse_shares` — there is no Postgres/pg driver.
Both reads and writes send the service-role key as **both** `apikey` and
`Authorization: Bearer`, bypassing row-level security; upstream timeout is 8s.
The `file` backend re-validates `id` against `IDPattern` before touching the
filesystem path (defense in depth).

---

## 4. Data model

### 4.1 Ephemeral in-browser chart state

The entire workspace lives in `chart-store` and `localStorage['hp:chart']`. The
shareable unit is `SharePayload` (`src/types/chart.ts`):

```ts
type ChartFiles = Record<string, string>   // relative path -> file content
type ChartMode  = 'chart' | 'single'

interface SharePayload {
  files: ChartFiles
  releaseName: string
  namespace: string
  // Absent on legacy shares — treated as 'chart'.
  mode?: ChartMode
  // Present when mode === 'single', carrying the single-file editor state.
  single?: {
    template: string
    values: string
    override: string | null
  }
}
```

`files` always holds a render-ready chart: in single mode `ShareButton` populates
it from `buildRenderFiles(...)` (the synthesized chart) and *also* stores the raw
single-editor state under `single` so the editor can restore exactly. Legacy
shares without `mode` load as `'chart'`.

> Field-name note: `SharePayload` uses `releaseName`, but `chart-store.replaceAll`
> takes `{release?, namespace?, mode?, single?}`. `App.tsx` bridges them on load:
> `replaceAll(p.files, { release: p.releaseName, namespace: p.namespace,
> mode: p.mode ?? 'chart', single: p.mode === 'single' ? p.single : undefined })`.

### 4.2 Supabase shares table (optional)

Server-side persistence exists only when `SHARE_STORE=supabase`. The table is
defined in `supabase/migrations/20260609000000_charthouse_shares.sql`:

```sql
create table if not exists public.charthouse_shares (
  id          text        primary key,
  payload     jsonb       not null,
  created_at  timestamptz not null default now()
);

create index if not exists charthouse_shares_created_at_idx
  on public.charthouse_shares (created_at);

alter table public.charthouse_shares enable row level security;
```

RLS is **enabled with no policies** — only the service-role key (used by
`/api/share`, server-side only) can read or write. `payload` stores the
`SharePayload` JSON verbatim. There is no expiry or garbage collection. The
`memory` and `file` stores keep the same `SharePayload` JSON, in process memory or
as `<id>.json` files respectively.

---

## 5. Resource topology viewer

The render output can be inspected as a graph of Kubernetes resources and the
relationships inferred between them — with **no cluster contact**. It has two
halves: a pure-TS inference engine and a React Flow UI.

### 5.1 Inference engine — `src/lib/topology/`

Entry point: `buildTopology(stdout, defaultNamespace = 'default')` →
`{ nodes, edges }` (`infer.ts`; types in `types.ts`; manifest parsing in
`parse.ts`). Output is **deterministic** (nodes and edges are sorted).

`parse.ts` splits the rendered multi-doc YAML on `^---$` (mirroring the splitter
in `RenderedOutput`), captures each doc's `# Source:` line, loads each doc with
`js-yaml` (a doc that fails to parse is skipped, never killing the graph), and
classifies each resource into a `NodeGroup`:
`workload | networking | config | rbac | storage | autoscaling | other`.
Cluster-scoped kinds have their namespace normalized to `''` so cross-namespace
references resolve.

`infer.ts` then derives edges purely from the manifests (no API server):

| Edge | From → To | Inferred from |
| --- | --- | --- |
| `selects` | Service → workload | `spec.selector` label match against the pod template labels |
| `selects` | PodDisruptionBudget / NetworkPolicy → workload | `LabelSelector` (`matchLabels` + `matchExpressions`); an empty NetworkPolicy `podSelector: {}` matches all pods in the namespace |
| `routes` | Ingress → Service | `spec.rules[].http.paths[].backend.service.name` (+ legacy `serviceName`) and `defaultBackend` |
| `uses-secret` | Ingress → Secret | `spec.tls[].secretName` |
| `uses-config` / `uses-secret` | workload → ConfigMap / Secret | pod `volumes`, `projected` sources, `envFrom`, `env.valueFrom`, and `imagePullSecrets` |
| `uses-account` | workload → ServiceAccount | pod `serviceAccountName` / `serviceAccount` |
| `mounts` | workload → PersistentVolumeClaim | pod volume `claimName` and StatefulSet `volumeClaimTemplates` |
| `scales` | HorizontalPodAutoscaler → workload | `spec.scaleTargetRef` |
| `binds` | RoleBinding / ClusterRoleBinding → ServiceAccount + Role | `subjects` (ServiceAccount) and `roleRef` |
| `owns` | owner → resource | `metadata.ownerReferences` |

References that point at a resource not present in the rendered set become faded
**external** nodes (`docIndex: -1`, `external: true`), and the edge is marked
`dangling`. Tests live in `src/lib/topology/infer.test.ts` (Vitest, 10 passing;
run with `pnpm test`).

### 5.2 Viewer UI — `src/components/topology/`

The viewer is a **full-window overlay** built on **React Flow**
(`@xyflow/react` v12) + **dagre**. It is **`lazy()`-loaded behind `Suspense`** so
React Flow and dagre stay out of the initial bundle (a separate chunk); the import
sits in `RenderedOutput`:

```tsx
const TopologyModal = lazy(() => import('@/components/topology/TopologyModal'))
```

- **Trigger** — a "topology" button in the `RenderedOutput` header
  (`src/components/output/RenderedOutput.tsx`), **disabled when there are 0
  rendered docs**.
- `TopologyModal.tsx` — the overlay; calls `buildTopology(stdout, namespace)`
  (memoized), renders the graph plus a side panel, closes on `Escape` / the X
  button, and shows a group-color legend.
- `TopologyGraph.tsx` — wraps `ReactFlow` (with `Background`, `Controls`,
  `MiniMap`, a `ReactFlowProvider`, and a custom `resource` node type); positions
  come from `layout.ts` (deterministic top-down dagre layout, `rankdir: 'TB'`,
  computed once per graph). `ResourceNode.tsx` is the node renderer and
  `groupTheme.ts` maps each `NodeGroup` to a color + icon.
- `ResourcePanel.tsx` — clicking a node opens a side panel showing **that
  resource's rendered YAML** in a read-only Monaco editor; external nodes show an
  "external reference" notice instead.

---

## 6. Share system

Two modes, chosen automatically by the result of `createShortShare` in
`ShareButton.tsx`. The payload is built from the current mode: in single mode
`files` comes from `buildRenderFiles(...)` and the raw editor state is attached as
`single`; in chart mode the file map is shared directly. Either way `mode` is set.

1. **Short-URL (store-backed)** — `POST /api/share {payload}` returns `{id}`; the
   share URL is `${location.origin}/s/${id}`. Works with any configured store,
   including the default in-memory one.
2. **Hash fallback (self-contained)** — when `createShortShare` returns `null`
   (server 503 = sharing explicitly misconfigured) or throws, the URL becomes
   `${location.origin}/${encodePayloadToHash(payload)}`, i.e.
   `#h=<base64url(pako.deflate(JSON.stringify(payload)))>`. No backend required;
   larger (a few KB), and self-decoding on load. With the memory default this path
   is now rare.

Either way the URL is auto-copied to the clipboard and shown in a Modal.

**Load on startup** (`useLoadFromUrl` in `App.tsx`):

1. Try `decodePayloadFromHash(location.hash)` (regex `/[#&]h=([A-Za-z0-9_-]+)/`).
   On success: `apply(payload)`, then `history.replaceState` to
   `location.pathname` (strips the hash).
2. Else match the path against `/^\/s\/([a-z0-9]{6,16})$/` and call
   `loadShortShare(id)`. On success: `apply(payload)`, then `history.replaceState`
   to `/`.

`apply` is the `replaceAll` bridge in §4.1, restoring mode and single-editor state.
The short-id charset/length (`[a-z0-9]{6,16}`) is what both the client path matcher
and the server `IDPattern` expect; the server generates 8-char ids in that set.

**`/s/:id` rewrite.** Short-URLs are deep links into the SPA. When self-hosting,
`cmd/server`'s SPA fallback already serves `index.html` for unknown paths. On
Vercel, `vercel.json` rewrites `{ source: '/s/:id', destination: '/' }` to the
same effect.

---

## 7. Theming

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
palette through its `gruvbox-dark` / `gruvbox-light` themes, and the topology
graph uses the same group colors via `groupTheme.ts`.

---

## 8. Deployment shapes

The same three `Handler` functions back three runtimes:

- **Self-hosted binary** — `go run ./cmd/server` (or the built `charthouse`
  binary) serves API + embedded SPA on `PORT` (default 8080). Requires `pnpm
  build` first so `dist/` exists for `//go:embed all:dist`.
- **Docker** — the multi-stage `Dockerfile` builds the SPA (`node:22-alpine` +
  `pnpm build`), then the static Go binary embedding `dist/`
  (`golang:1.26-alpine`, `CGO_ENABLED=0`), and ships it on
  `gcr.io/distroless/static-debian12:nonroot` (`EXPOSE 8080`, default
  `SHARE_STORE=memory`, runs as nonroot). `docker-compose.yaml` runs one
  `charthouse` service with `SHARE_STORE=file` and a named volume at `/data` for
  durable links; the Supabase variables are present but commented.
- **Vercel + Supabase** (optional) — the `api/*/index.go` `Handler` exports are
  unchanged, `vercel.json` declares the three Go functions and the `/s/:id`
  rewrite, and Supabase is just `SHARE_STORE=supabase` + the `charthouse_shares`
  migration.

See [DEVELOPMENT.md](DEVELOPMENT.md) for the exact commands, ports, and scripts.

---

## 9. Non-goals and constraints

- **No persistent user data.** Charts live only in the browser
  (`localStorage['hp:chart']`); the render backend writes files to a per-request
  temp dir and removes it with `defer os.RemoveAll`. The only server-side
  persistence is the opt-in share store (`file` / `supabase`), and even the
  default `memory` store is ephemeral.
- **Ephemeral, stateless render workspace.** Each render gets a fresh
  `os.MkdirTemp` and the `"memory"` Helm storage driver — no cross-request state,
  no cluster contact (dry-run only).
- **Topology never contacts a cluster.** Relationships are inferred purely from
  the rendered manifests in the browser; the graph cannot reflect live cluster
  state.
- **No auth, no CORS on the Go server.** Handlers are exposed without
  authentication; in dev the browser reaches them only through the Vite proxy, and
  in the self-hosted binary the SPA and API share one origin. `/api/render`
  executes arbitrary chart templates (Go/Sprig templating) in-process under a 10s
  timeout — a templating surface, but no shell exec.
- **No `helm` binary.** Rendering is the Helm Go SDK in-process; `HELM_BIN` is no
  longer referenced and has been removed from `.env.example`.
- **CDN dependency.** Monaco loads from jsdelivr; the editors do not work fully
  offline.
- **Three API endpoints.** No health/version endpoints; in the dev server every
  other path is a catch-all 404, and in the self-hosted server non-asset paths
  fall back to the SPA (`/api/*` misses still return JSON 404).

For the exact request/response shapes and status codes of each endpoint, see
[API.md](API.md). For ports, scripts, and how to run all of this locally, see
[DEVELOPMENT.md](DEVELOPMENT.md).
