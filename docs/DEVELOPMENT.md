# Development

Local development and verification for **charthouse** — a real-time Helm
template rendering UI (Vite + React frontend, Go API). This is the
**Verification subsystem** detail: how to get the app running and how to prove a
change is green before you commit.

Routing: [CLAUDE.md](../CLAUDE.md) (agent operating loop) · [README.md](../README.md)
(human overview) · [API.md](./API.md) (endpoint contracts) ·
[DEPLOYMENT.md](./DEPLOYMENT.md) (Docker, single binary, Vercel).

---

## Prerequisites

| Tool | Version | Why / source of truth |
|------|---------|------------------------|
| Node.js | 22.13+ | Required by the pinned pnpm 11.x. Advisory only — `package.json` has **no** `engines` field, so it is not enforced. (Verified locally: v26.) |
| pnpm | **11.5.1** | Pinned via `packageManager` in `package.json` (`pnpm@11.5.1`). Use this exact version. |
| Go | **1.26+** | `go.mod` declares `go 1.26.0`. (Verified locally: go1.26.3.) Render uses `errors.AsType` (a new generic errors API), so an older toolchain will fail to build. |
| helm CLI | optional, validated against **v4.2.0** | **Not required to run the app.** `/api/render` renders **in-process via the Helm Go SDK** (`helm.sh/helm/v4 v4.2.0`) — it does *not* shell out to a `helm` binary, and `HELM_BIN` is unused dead config. Install `helm` only if you want to cross-check rendering by hand with `helm template`. The project was validated against helm v4.2.0. |

Tests run via **Vitest** (`pnpm test`); the linter is **not** wired (eslint is
not installed). The green bar is `typecheck` + `test` + `build` + a render smoke
test (see [Verification](#verification--is-it-green)).

---

## Setup

```bash
./init.sh          # harness bootstrap: prints current state + verifies prerequisites
pnpm install       # install JS deps (canonical install step)
```

`init.sh` is the harness entry point (it orients you on repo state and the
startup/verification path). The actual dependency install is always
`pnpm install`. Under pnpm 11, install honors the build-script approval in
[`pnpm-workspace.yaml`](../pnpm-workspace.yaml) (`allowBuilds.esbuild: true`) so
esbuild's native binary builds without prompting — see
[Troubleshooting](#troubleshooting).

> No Supabase or other backend config is needed to develop locally. Sharing
> falls back to self-contained URL-hash payloads when Supabase env vars are
> absent (see [Environment](#environment)).

---

## Running

```bash
pnpm dev
```

This runs the frontend **and** the Go API together via `concurrently`
(`pnpm dev:vite` + `pnpm dev:api`, `-k` so killing one kills both):

| Process | Command | Port | Notes |
|---------|---------|------|-------|
| Frontend (Vite) | `pnpm dev:vite` → `vite` | **5173** | Open <http://localhost:5173>. Renders the sample chart immediately. |
| Backend (Go dev API) | `pnpm dev:api` → `go run ./cmd/dev` | **5174** | Serves `/api/render`, `/api/share`, `/api/import`. Override the port with `API_PORT`. |

**How `/api` reaches the backend:** the Vite dev server proxies `/api` →
`http://localhost:5174` (`server.proxy` in [`vite.config.ts`](../vite.config.ts),
`changeOrigin: true`). The Go dev server does **not** serve or proxy the
frontend and sets **no CORS headers** — the browser always talks to Vite on
5173, and Vite forwards `/api/*` to Go. Any path other than the three `/api/*`
routes returns a JSON 404 from the Go server.

Run a single side when you only need one:

```bash
pnpm dev:vite      # frontend only (port 5173)
pnpm dev:api       # backend only (port 5174)
```

### Production server / single binary

`cmd/server` is the self-contained binary used for self-hosting and Docker: it
serves the three `/api/*` routes **and** the built SPA (embedded via `go:embed`)
from one port (`PORT`, default **8080**). Build the UI first — the server embeds
`dist/`:

```bash
pnpm build         # produce dist/ first
pnpm serve         # go run ./cmd/server  -> http://localhost:8080
```

Or run the whole thing in Docker: `docker compose up --build` (also port 8080).
See [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Environment

All env vars are **server-side**; there are **zero** `VITE_`-prefixed (client)
variables. Copy [`.env.example`](../.env.example) to `.env` if you need any of
them — but none are required for local development.

| Var | Required? | Purpose |
|-----|-----------|---------|
| `PORT` | optional | HTTP port for the self-hosted server (`cmd/server`). Default `8080`. Not used by the dev server. |
| `SHARE_STORE` | optional | Share-link backend: `memory` (default, ephemeral, zero-config), `file`, or `supabase`. |
| `SHARE_DIR` | optional | Directory for the `file` store (only when `SHARE_STORE=file`). Default `./data/shares`. |
| `SUPABASE_URL` | only for supabase | Supabase project URL. The supabase store talks to `<SUPABASE_URL>/rest/v1/charthouse_shares` via PostgREST. |
| `SUPABASE_SERVICE_ROLE_KEY` | only for supabase | Service-role key (`apikey` + `Authorization: Bearer`, bypasses RLS). **Server-only secret — never expose to the client.** |
| `API_PORT` | optional, dev-only | Overrides the Go **dev** server port (default `5174`). Used only by `cmd/dev/main.go`; not in `.env.example`. |

**Sharing works with zero config.** The default `memory` store means short
`/s/<id>` links work locally with no backend or secrets (they are just lost on
restart). `/api/share` returns HTTP `503` only when an explicitly configured
store fails to initialize (e.g. `SHARE_STORE=supabase` without its credentials),
and the Share button then falls back to a self-contained `#h=<deflated-base64>`
URL that encodes the whole chart.

> Heads-up: `.env` is gitignored. If you place a real `SUPABASE_SERVICE_ROLE_KEY`
> there, keep it out of any shared location and rotate it if it ever leaks.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for configuring Supabase in production.

---

## Verification — "is it green?"

The green bar for this repo is **typecheck + build + render smoke**. Run these
before committing.

### 1. Typecheck

```bash
pnpm typecheck      # tsc -b --noEmit
```

### 2. Test

```bash
pnpm test           # vitest run
```

Covers the pure topology inference engine (`src/lib/topology`). Add specs
alongside new pure logic.

### 3. Build

```bash
pnpm build          # tsc -b && vite build  -> dist/
```

You can preview the production build with `pnpm preview` (`vite preview`). For
the backend, `go build ./... && go vet ./...` must also pass.

### 4. Manual render smoke test

With `pnpm dev` running, POST a tiny chart to `/api/render` **through the Vite
proxy** (port 5173). `/api/render` accepts only POST; the body is JSON matching
`{ files, releaseName, namespace, includeCRDs? }` where `files` maps relative
chart paths to contents (a `Chart.yaml` key is required).

```bash
curl -s http://localhost:5173/api/render \
  -H 'content-type: application/json' \
  -d '{
    "releaseName": "demo",
    "namespace": "default",
    "files": {
      "Chart.yaml": "apiVersion: v2\nname: smoke\nversion: 0.1.0\n",
      "values.yaml": "msg: hi\n",
      "templates/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}-cm\ndata:\n  msg: {{ .Values.msg | quote }}\n"
    }
  }'
```

Expected response (HTTP 200) — `stdout` contains the rendered manifest:

```json
{ "ok": true, "stdout": "...kind: ConfigMap...", "stderr": "", "durationMs": 12, "helmVersion": "v4.2.0 sdk" }
```

You can hit the Go server directly at `http://localhost:5174/api/render` instead
of the proxy — same result. Useful status codes: `200` success; `400` bad/invalid
input; `422` chart/values/render error or the 10s render timeout; `405` non-POST
(`Allow: POST`). Full contract in [API.md](./API.md).

### What is NOT part of verification

```bash
pnpm lint           # eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0   <-- DO NOT RELY ON THIS
```

The `lint` script exists in `package.json`, **but eslint is not installed**
(it is not in `devDependencies`), so the command fails. This is known debt — do
**not** add `pnpm lint` to CI or your verification path. Use typecheck + test +
build + render smoke instead.

(Tests, by contrast, *are* wired — run `pnpm test`, see [Test](#2-test) above.)

---

## Project structure (quick reference)

| Path | What lives here |
|------|-----------------|
| `src/` | Vite + React + TypeScript frontend (the SPA). |
| `src/App.tsx`, `src/main.tsx` | App root, layout, StrictMode mount. |
| `src/components/` | UI: `layout/`, `editor/` (incl. `SingleTemplatePanel` for single-file mode), `values/`, `output/`, `share/`, `theme/`, `topology/`, `ui/`, `upload/`. |
| `src/store/` | Zustand stores: `chart-store` (persisted; holds files **and** chart/single mode state), `render-store`, `theme-store`, `border-store`. |
| `src/lib/` | API clients + logic: `helm-client`, `share-client`, `import-client`, `chart-archive`, `schema-validate`, `use-debounced-render`, `sample-chart`. |
| `src/lib/topology/` | Pure-TS topology engine: `buildTopology(stdout)` → graph of K8s resources + inferred relationships (with `infer.test.ts`). |
| `src/types/chart.ts` | Shared types + constants (`ChartFiles`, `RenderRequest`, `SharePayload`, file-name constants). |
| `src/styles/` | `globals.css` (Tailwind + component classes), `gruvbox.css` (palette). |
| `api/render/index.go` | `POST /api/render` — Helm Go SDK in-process render (dry-run). |
| `api/share/index.go` | `GET`/`POST /api/share` — short URLs via the pluggable share store. |
| `api/share/store/` | Share `Store` interface + backends: `memory` (default), `file`, `supabase`. Selected by `SHARE_STORE`. |
| `api/import/index.go`, `api/import/repo.go` | `POST /api/import` — fetch + extract a chart from a URL (SSRF-guarded). |
| `cmd/dev/main.go` | Local Go dev server (port `API_PORT`, default 5174) that muxes the three `api/*` handlers. |
| `cmd/server/main.go` | Self-hosted production server (port `PORT`, default 8080): the three `api/*` handlers **plus** the embedded SPA, with `/s/:id` SPA fallback. |
| `embed.go` | Repo-root package that `//go:embed all:dist` (must sit next to `dist/`); consumed by `cmd/server`. |
| `go.mod` | Module `charthouse`, `go 1.26.0`, `helm.sh/helm/v4 v4.2.0`. |
| `vite.config.ts` | Frontend dev server (5173) + `/api` → `:5174` proxy + `@` → `src` alias. |
| `vercel.json` | Prod rewrites (`/s/:id` → `/`) and per-function runtime config. |
| `supabase/migrations/` | Schema for `charthouse_shares` (RLS enabled). |
| `.env.example` | Documented optional env vars. |

---

## Troubleshooting

### `ERR_PNPM_IGNORED_BUILDS` / esbuild build not approved

Under pnpm 11, postinstall build scripts must be explicitly approved.
[`pnpm-workspace.yaml`](../pnpm-workspace.yaml) already approves esbuild:

```yaml
allowBuilds:
  esbuild: true
```

If you still see `ERR_PNPM_IGNORED_BUILDS`, confirm you are on pnpm **11.5.1**
(`pnpm --version`) and that the `allowBuilds` block above is present, then
re-run `pnpm install`. No other package needs a build-script approval.

### `helm: command not found` (or wanting to cross-check renders)

The app does **not** need the `helm` CLI — `/api/render` renders in-process via
the Helm Go SDK, so missing `helm` on `PATH` will not break `pnpm dev` or the
render smoke test. Install `helm` (validated against **v4.2.0**) only if you want
to hand-verify output, e.g. `helm template <release> <chartDir>`.

### Port already in use (5173 / 5174)

`pnpm dev` needs both ports free. Check and free them:

```bash
lsof -i :5173 -i :5174
```

Set `API_PORT` to move the Go dev server off 5174 — but note the Vite proxy
target in [`vite.config.ts`](../vite.config.ts) is hard-coded to
`http://localhost:5174`, so if you change `API_PORT` you must update the proxy
target to match.

### `/api/*` returns 404 or a network error in the browser

The browser must talk to Vite (5173), which proxies `/api` to Go (5174). If the
Go side is down you will see proxy errors; start it with `pnpm dev:api`. The Go
server returns a JSON 404 for any path other than `/api/render`, `/api/share`,
`/api/import` — there is no health/version endpoint.

### Editors are blank / Monaco fails to load

Monaco is loaded from a CDN (`cdn.jsdelivr.net/npm/monaco-editor@0.52.2`).
Offline or air-gapped environments will show empty editors. You need network
access for the editor panes.
