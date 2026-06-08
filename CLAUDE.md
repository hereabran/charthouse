# CLAUDE.md

Agent operating manual for **helm-playground**. Claude Code auto-loads this file. It is a map, not an encyclopedia: read it first, then follow the links for detail. Keep it accurate — only real paths, commands, and endpoints belong here.

## What this project is

helm-playground is a real-time Helm template rendering playground. The UI is a three-column SPA (chart files + editor on the left, `values.yaml` / `values.override.yaml` in the middle, live rendered manifest on the right) styled with a Gruvbox light/dark theme. The frontend is Vite + React + TypeScript (pnpm). The backend is a small set of stateless Go HTTP handlers under `api/` (render, share, import) that render charts **in-process via the Helm v4 Go SDK** — there is no `helm` CLI exec. Charts are ephemeral (browser `localStorage` only); a chart can be shared via a Supabase-backed short URL (`/s/:id`) or, with no backend configured, a self-contained `#h=<deflated-base64>` hash URL.

## Read these first

In order, before doing any work:

1. [feature_list.json](feature_list.json) — the scope. Pick exactly ONE feature; its `done` criteria are authoritative.
2. [claude-progress.md](claude-progress.md) — current state, what's verified, what's in flight.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit (frontend stores, render flow, Go handlers).
4. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local setup, commands, verification details.
5. [docs/API.md](docs/API.md) — the three endpoints, request/response shapes, status codes.
6. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel + Supabase deploy, env vars, migration discipline.

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
| `api/` | Go serverless handlers (Vercel-style): `render/index.go`, `share/index.go`, `import/index.go` — each exports `Handler` |
| `cmd/dev/` | Local Go dev API server (`main.go`); routes `/api/render`, `/api/share`, `/api/import`, binds `API_PORT` (default 5174) |
| `supabase/` | `config.toml` + `migrations/` for the `helm_playground_shares` table (RLS enabled) |
| `docs/` | Detail docs: ARCHITECTURE, DEVELOPMENT, API, DEPLOYMENT |
| `public/`, `index.html` | Static entry; pre-paint theme script and `#root` mount |

Key configs: `vite.config.ts` (dev port 5173, proxies `/api` → `http://localhost:5174`), `vercel.json` (rewrites `/s/:id` → `/`, per-function `maxDuration`/`memory`), `go.mod` (`go 1.26.0`, `helm.sh/helm/v4 v4.2.0`).

## Commands you will actually run

All via pnpm (pinned `pnpm@11.5.1`). Run from the repo root.

```sh
pnpm install      # install JS deps (pnpm 11 honors allowBuilds.esbuild in pnpm-workspace.yaml)
pnpm dev          # frontend (vite :5173) + Go dev API (:5174) together
pnpm dev:vite     # frontend only
pnpm dev:api      # backend only — equals: go run ./cmd/dev
pnpm build        # tsc -b && vite build  ->  dist/
pnpm typecheck    # tsc -b --noEmit
pnpm preview      # serve built dist/ locally
```

Backend directly (no pnpm): `go run ./cmd/dev` (override port with `API_PORT=5174 go run ./cmd/dev`). The Vite dev server is what bridges the browser to the API — open http://localhost:5173, not the Go port.

There is NO `helm` binary involved; `/api/render` uses the Helm Go SDK in-process.

## Verification

"Green" before any commit means all of the following pass — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the smoke-test body:

- `pnpm typecheck` — clean.
- `pnpm build` — succeeds into `dist/`.
- **Smoke render** — with `pnpm dev` running, `POST http://localhost:5174/api/render` with `{files, releaseName, namespace}` for a tiny chart returns `{ "ok": true, "stdout": "...", ... }`.

Do **not** add `pnpm lint` to the verification path: `eslint` is referenced by the `lint` script but is not in `devDependencies`, so it fails. This is known debt — leave it out of CI/verification.

## Conventions & guardrails

- **Match surrounding code.** TS/React: existing component, store, and `lib/` patterns (Zustand stores, functional components, `@/` alias for `src/`). Go: keep handlers stateless, return JSON with `content-type: application/json; charset=utf-8` and `cache-control: no-store`, mirror the existing validation/limit style.
- **One feature at a time.** Respect the selected feature's scope and `done` criteria.
- **No secrets in charts or shares.** Chart files, values, and share payloads are user content rendered/echoed back — never embed credentials. `.env` is gitignored; never commit it or paste its contents.
- **`SUPABASE_SERVICE_ROLE_KEY` is server-only.** It bypasses Supabase RLS and must never reach the client or any `VITE_`-prefixed var. There are zero client-exposed env vars by design.
- **Data is ephemeral.** No persistent user data: charts live in `localStorage` (`hp:chart`), theme in `hp:theme`. Short-share rows have no expiry/GC. Don't add server-side chart persistence as a side effect.
- **Endpoints are fixed at three.** `/api/render`, `/api/share`, `/api/import` — no health/version endpoints; everything else 404s. Keep API changes documented in [docs/API.md](docs/API.md).
- **Supabase migrations are append-only.** Never edit an applied migration; add a new one (`supabase migration new <name>` + `supabase db push`).

## When stuck

- Behavior/contract questions → [docs/API.md](docs/API.md) and the handler source under `api/`.
- "How does X flow work" → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (render debounce, share fallback, import + SSRF guard).
- Setup/command/verification failures → [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- Deploy/env/Supabase → [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- What's actually done vs claimed → [claude-progress.md](claude-progress.md) and [clean-state-checklist.md](clean-state-checklist.md).
- Ground truth always wins: read the source. If a doc disagrees with the code, fix the doc.
