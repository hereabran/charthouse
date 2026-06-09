# CLAUDE.md

Agent operating manual for **Charthouse**. Claude Code auto-loads this file. It is a map, not an encyclopedia: read it first, then follow the links for detail. Keep it accurate — only real paths, commands, and endpoints belong here.

## What this project is

Charthouse is a real-time playground for Helm charts. The UI is a three-column SPA (chart files + editor on the left, `values.yaml` / `values.override.yaml` in the middle, live rendered manifest on the right) styled with a Gruvbox light/dark theme. The frontend is Vite + React + TypeScript (pnpm). The backend renders charts **in-process via the Helm v4 Go SDK** — there is no `helm` CLI exec.

Two recent features shape the workflow:

- **Two editing modes (chart | single).** A segmented toggle switches between editing a full chart and a single template. Single mode synthesizes a minimal chart (Chart.yaml + one template + values) so the same render path applies to both. Mode round-trips through share links; legacy shares load as chart.
- **Resource topology viewer.** A button in the rendered-output header opens a full-window graph of the rendered manifests (workloads, networking, config, RBAC, storage, autoscaling) with relationships inferred purely from the manifests (no cluster). Click a node to inspect its YAML. The modal is lazy-loaded so React Flow / dagre stay out of the initial bundle.

Charts are ephemeral (browser `localStorage` only). A chart can be shared via a short URL (`/s/:id`) or, when the backend is unreachable, a self-contained `#h=<deflated-base64>` hash URL.

Charthouse is **vendor-neutral**: the primary deployment is a single self-contained Go binary (`cmd/server`) that embeds the built SPA and serves the API — runnable directly or via Docker. Vercel + Supabase remain optional (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). "Helm" is a CNCF trademark — refer to it nominatively only ("a playground for Helm charts"); never imply endorsement.

## Read these first

In order, before doing any work:

1. [feature_list.json](feature_list.json) — the scope. Pick exactly ONE feature; its `done` criteria are authoritative.
2. [claude-progress.md](claude-progress.md) — current state, what's verified, what's in flight.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit (frontend stores, render flow, Go handlers).
4. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local setup, commands, verification details.
5. [docs/API.md](docs/API.md) — the three endpoints, request/response shapes, status codes.
6. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — single-binary / Docker deploy plus optional Vercel + Supabase, env vars, migration discipline.

Also see [AGENTS.md](AGENTS.md) for shared agent conventions and [clean-state-checklist.md](clean-state-checklist.md) for the session-end checklist.

## Session lifecycle

Work one feature at a time, end to end:

1. **Init** — run `./init.sh` (installs deps, sanity-checks the toolchain).
2. **Select** — pick ONE feature from [feature_list.json](feature_list.json). Do not widen scope mid-session.
3. **Implement** — make the change; match surrounding code style (see Conventions).
4. **Verify** — run the exact commands in [Verification](#verification). All must be green.
5. **Record** — update [claude-progress.md](claude-progress.md) with what changed and its verification status.
6. **Commit** — only when the user asks. Branch first if on `main`.

If a side issue appears that would balloon the change, note it and keep it out of the current feature.

## Project map

Terse roles only; for file-by-file detail see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Path | Role |
| --- | --- |
| `src/` | Vite + React + TS frontend: components, Zustand stores, `lib/` API clients, Gruvbox styles |
| `src/lib/topology/` | Pure-TS topology engine: parse rendered YAML, infer relationships, emit `{nodes, edges}` (+ Vitest) |
| `src/components/topology/` | Topology UI: React Flow graph, node/panel, dagre layout, group theming |
| `src/components/editor/SingleTemplatePanel.tsx` | Single-file editing mode's template panel (alternative to the chart `TemplatePanel`) |
| `api/` | Go serverless handlers (Vercel-style): `render/index.go`, `share/index.go`, `import/index.go` — each exports `Handler` |
| `api/share/store/` | Pluggable share store (`store.go` interface + `memory.go` / `file.go` / `supabase.go`); selected by `SHARE_STORE` |
| `cmd/server/` | Self-hosted single-binary server (`main.go`): serves the API **and** the embedded SPA; binds `PORT` (default 8080) |
| `cmd/dev/` | Local Go dev API server (`main.go`); routes `/api/render`, `/api/share`, `/api/import`, binds `API_PORT` (default 5174) |
| `embed.go` | Repo-root `//go:embed all:dist` (package `charthouse`) — embeds the built SPA for `cmd/server` |
| `supabase/` | `config.toml` + `migrations/` for the `charthouse_shares` table (RLS enabled) — only for `SHARE_STORE=supabase` |
| `docs/` | Detail docs: ARCHITECTURE, DEVELOPMENT, API, DEPLOYMENT |
| `public/`, `index.html` | Static entry; pre-paint theme script and `#root` mount |

Key configs: `vite.config.ts` (dev port 5173, proxies `/api` → `http://localhost:5174`), `vercel.json` (rewrites `/s/:id` → `/`, per-function `maxDuration`/`memory`), `Dockerfile` + `docker-compose.yaml` (single `charthouse` service on `8080`), `go.mod` (`go 1.26.0`, `helm.sh/helm/v4 v4.2.0`).

## Commands you will actually run

All via pnpm (pinned `pnpm@11.5.1`). Run from the repo root.

```sh
pnpm install      # install JS deps (pnpm 11 honors allowBuilds.esbuild in pnpm-workspace.yaml)
pnpm dev          # frontend (vite :5173) + Go dev API (:5174) together
pnpm dev:vite     # frontend only
pnpm dev:api      # backend only — equals: go run ./cmd/dev
pnpm build        # tsc -b && vite build  ->  dist/
pnpm typecheck    # tsc -b --noEmit
pnpm test         # vitest run (topology engine tests)
pnpm serve        # production single-binary server (go run ./cmd/server) on :8080 — needs a prior pnpm build
pnpm preview      # serve built dist/ locally (Vite)
docker compose up # build + run the all-in-one container on :8080 (durable file-store shares via a named volume)
```

`pnpm serve` embeds `dist/` at compile time, so run `pnpm build` first or you serve a stale SPA. In dev, the Vite server bridges the browser to the API — open http://localhost:5173, not the Go port.

There is NO `helm` binary involved; `/api/render` uses the Helm Go SDK in-process.

`pnpm lint` is **not runnable**: the `lint` script calls `eslint`, but `eslint` is not in `devDependencies`, so it fails. Known debt — do not present it as a usable command or add it to verification.

## Verification

"Green" before any commit means all of the following pass — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the smoke-test body:

- `pnpm typecheck` — clean.
- `pnpm test` — Vitest passes (topology inference tests).
- `pnpm build` — succeeds into `dist/` (topology splits into its own lazy chunk).
- `go build ./... && go vet ./...` — both clean.
- **Smoke render** — with `pnpm dev` running, `POST http://localhost:5174/api/render` with `{files, releaseName, namespace}` for a tiny chart returns `{ "ok": true, "stdout": "...", ... }`. (Optionally also exercise `pnpm serve` on :8080 for the embedded SPA + SPA fallback.)

## Conventions & guardrails

- **Match surrounding code.** TS/React: existing component, store, and `lib/` patterns (Zustand stores, functional components, `@/` alias for `src/`). Go: keep handlers stateless, return JSON with `content-type: application/json; charset=utf-8` and `cache-control: no-store`, mirror the existing validation/limit style.
- **One feature at a time.** Respect the selected feature's scope and `done` criteria.
- **No secrets in charts or shares.** Chart files, values, and share payloads are user content rendered/echoed back — never embed credentials. `.env` is gitignored; never commit it or paste its contents.
- **Share storage is pluggable via `SHARE_STORE`.** Values are `memory` (default — ephemeral in-process, links die on restart), `file` (durable JSON under `SHARE_DIR`, default `./data/shares`), or `supabase`. With the default memory store, short links work out of the box; the `#h=` hash fallback only triggers on an explicit 503 (e.g. `SHARE_STORE=supabase` without its env vars, or an unknown value).
- **`SUPABASE_SERVICE_ROLE_KEY` is server-only.** It bypasses Supabase RLS and must never reach the client or any `VITE_`-prefixed var. There are zero client-exposed env vars by design.
- **Data is ephemeral.** No persistent user data: charts live in `localStorage` (`hp:chart`), theme in `hp:theme`. Even the durable file/Supabase stores have no expiry/GC. Don't add server-side chart persistence as a side effect.
- **`dist/` is git-ignored, but the placeholder is not.** `.gitignore` ignores `dist/*` yet un-ignores `!dist/.gitkeep` so `embed.go`'s `//go:embed all:dist` compiles before a build exists. Never commit real build artifacts under `dist/`; keep the `.gitkeep` placeholder intact.
- **Endpoints are fixed at three.** `/api/render`, `/api/share`, `/api/import` — no health/version endpoints. In the single-binary server, unknown `/api/*` paths return JSON 404 and other unknown non-asset paths fall back to `index.html` (so client routes like `/s/:id` work). Keep API changes documented in [docs/API.md](docs/API.md).
- **Supabase migrations are append-only.** Never edit an applied migration; add a new one (`supabase migration new <name>` + `supabase db push`).

## When stuck

- Behavior/contract questions → [docs/API.md](docs/API.md) and the handler source under `api/`.
- "How does X flow work" → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (render debounce, share fallback, import + SSRF guard, topology inference).
- Setup/command/verification failures → [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- Deploy/env/Docker/Supabase → [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- What's actually done vs claimed → [claude-progress.md](claude-progress.md) and [clean-state-checklist.md](clean-state-checklist.md).
- Ground truth always wins: read the source. If a doc disagrees with the code, fix the doc.
