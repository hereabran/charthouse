# helm-playground

A real-time Helm template rendering UI. Edit a chart on the left, tweak values in
the middle, watch the rendered Kubernetes manifests update on the right — all in
the browser, with no cluster and no `helm` binary required. Nothing is saved
server-side: drop a chart, render, share a link, walk away.

```
┌──────────────┬──────────────┬──────────────────────┐
│ chart files  │ values.yaml  │  rendered manifests   │
│ + file tree  │ + override   │  (live helm template) │
│   (Monaco)   │  (Monaco)    │   read-only, by doc    │
└──────────────┴──────────────┴──────────────────────┘
```

## What it does

- **Live render** — every edit is debounced (~300ms) and shipped to the backend,
  which renders the chart through the **Helm Go SDK** (in-process, no CLI) and
  returns the manifests. Output splits into per-document tabs.
- **Bring your own chart** — start from the bundled sample, create/rename/delete
  files in the tree, upload a folder / `.zip` / `.tgz`, or import a chart
  straight from a URL or Helm repo.
- **Values + override** — `values.yaml` plus a separate `values.override.yaml`
  tab (applied on top, the moral equivalent of `helm template ... -f override`),
  with optional JSON-schema validation surfaced as inline editor warnings.
- **Gruvbox theme** — light/dark toggle, 7 accent colors, and a sharp/rounded
  corner switch. Preferences persist in `localStorage`.
- **Shareable URLs** — one click copies a link that reproduces the exact chart,
  release name, and namespace. Backed by a short `/s/<id>` URL when Supabase is
  configured, or a self-contained hash URL when it isn't.

## Features

- **3-column layout** — resizable columns: file tree + editor, values + override,
  live rendered output. Collapses to a vertical stack on narrow screens.
- **Live render** — debounced edits sent to `/api/render`; output and per-document
  tabs update in place. Helm errors are shown inline rather than thrown away.
- **Upload chart** — drop a folder, `.zip`, or `.tgz` onto the window, or use the
  toolbar `upload` menu. The top-level chart directory is auto-stripped.
- **Import from URL** — paste a direct `.tgz`/`.tar.gz`/`.zip` link, a Helm repo
  base URL, or a repo + chart URL; the server fetches and extracts it for you
  (with SSRF protection against private/loopback hosts).
- **Edit in browser** — Monaco editor for templates, values, and helpers. Create,
  rename, and delete files (and folders) from the tree.
- **values.override.yaml** — separate tab, applied after `values.yaml`.
- **Schema validation** — when `values.schema.json` is present, values are checked
  with Ajv and errors are mapped to Monaco markers.
- **Shareable URLs** —
  - If `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set: a short URL
    `/s/abc123` backed by a Supabase row.
  - Otherwise: a self-contained `#h=<deflated base64>` hash URL (long, but needs
    no backend).
- **Gruvbox theme** with light/dark toggle, accent colors, and rounded/sharp
  corners — all persisted in `localStorage`.

## Quickstart

Prerequisites (advisory — only `packageManager` is enforced, via `package.json`):

- `pnpm` 11+ (the repo pins `pnpm@11.5.1`)
- `node` 22.13+ (for the pinned pnpm release)
- `go` 1.26+ (for the API; rendering uses the Helm Go SDK, so **no** `helm`
  binary is needed)

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs the frontend and backend together (via `concurrently`):

- **Vite** dev server on <http://localhost:5173> (the frontend)
- **Go** dev API on <http://localhost:5174>, proxied by Vite at `/api/*`

Open <http://localhost:5173> — the sample chart renders immediately.

Run them individually if you prefer:

```sh
pnpm dev:vite   # frontend only (vite, port 5173)
pnpm dev:api    # backend only  (go run ./cmd/dev, port 5174)
```

Other scripts:

```sh
pnpm build      # tsc -b && vite build  → dist/
pnpm preview    # serve the built dist/ locally
pnpm typecheck  # tsc -b --noEmit
pnpm lint       # eslint .ts/.tsx (note: eslint is not in devDependencies — known debt)
```

### Smoke test

After `pnpm dev`, hit the render endpoint directly from another shell:

```sh
curl -s http://localhost:5174/api/render \
  -H 'content-type: application/json' \
  -d "$(node -e 'const f={
  "Chart.yaml":"apiVersion: v2\nname: smoke\nversion: 0.1.0\n",
  "values.yaml":"replicas: 1\n",
  "templates/cm.yaml":"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: smoke\ndata:\n  r: \"{{ .Values.replicas }}\"\n"
};
process.stdout.write(JSON.stringify({files:f,releaseName:"demo",namespace:"default"}));')" \
  | jq .
```

Expected: `{ "ok": true, "stdout": "...ConfigMap...", "stderr": "", "durationMs": <ms>, "helmVersion": "v... sdk" }`.

See [docs/API.md](./docs/API.md) for the full request/response contracts, status
codes, and render limits (file count, per-file and total size caps, timeout).

## How sharing works

The Share button always produces a URL that fully reproduces the current chart,
release name, and namespace. It picks the best available mechanism:

- **Short URL (`/s/<id>`)** — used when the backend has Supabase configured. The
  payload is `POST`ed to `/api/share`, persisted in the `helm_playground_shares`
  table, and you get back a tidy `https://…/s/abc123` link. On load, the SPA
  resolves the `id` and rehydrates the chart. (`vercel.json` rewrites `/s/:id`
  to `/` so the SPA can handle it.)
- **Hash URL (`#h=<deflated base64>`)** — the no-backend fallback. The whole
  chart is JSON-serialized, deflated with pako, base64url-encoded, and appended
  to the URL hash. It's longer (a few KB) but needs zero infrastructure. On load
  the app decodes it and removes the hash from history.

If Supabase isn't configured, `/api/share` returns `503` and the frontend
transparently falls back to the hash URL — so sharing always works.

## Tech stack

| Layer        | Tools                                                          |
| ------------ | ------------------------------------------------------------- |
| Frontend     | React 19, Vite 6, TypeScript 5.7, Zustand                     |
| Styling      | Tailwind CSS 3.4, Gruvbox CSS variables                       |
| Editor       | Monaco (`@monaco-editor/react`, loaded from a CDN)            |
| Backend      | Go 1.26 serverless-style handlers + a local dev server        |
| Rendering    | `helm.sh/helm/v4` (Helm Go SDK, in-process)                   |
| Share store  | Supabase (PostgREST) — optional                               |
| Tooling      | pnpm 11, ESLint, Vercel (deploy)                              |

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how the frontend, dev server,
  and Go handlers fit together; the render pipeline and data flow.
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — local setup, scripts, ports,
  project layout, and conventions.
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — deploying to Vercel + Supabase, env
  vars, and the Supabase-less fallback.
- [docs/API.md](./docs/API.md) — the `/api/render`, `/api/share`, and
  `/api/import` HTTP contracts, limits, and status codes.

## Project layout

```
.
├── api/                         # Go serverless-style handlers
│   ├── render/index.go          #   POST /api/render  — Helm SDK dry-run render
│   ├── share/index.go           #   GET/POST /api/share — Supabase short URLs
│   └── import/                  #   POST /api/import — fetch + extract a chart
│       ├── index.go
│       └── repo.go
├── cmd/dev/main.go              # Local Go dev API server (port 5174)
├── supabase/
│   ├── config.toml
│   └── migrations/
│       └── 20260609000000_helm_playground_shares.sql
├── src/                         # Vite + React + TS frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/{layout,editor,values,output,upload,share,theme,ui}/...
│   ├── store/{chart-store,render-store,theme-store,border-store}.ts
│   ├── lib/{helm-client,share-client,import-client,chart-archive,schema-validate,use-debounced-render,sample-chart}.ts
│   ├── styles/{globals,gruvbox}.css
│   └── types/chart.ts
├── vercel.json
├── vite.config.ts
├── go.mod / go.sum
└── package.json
```

## For AI agents

If you're an AI agent working in this repo, start with [CLAUDE.md](./CLAUDE.md).
It's the agent-facing map: it points to the detail docs above, the verification
commands, the current scope, and the session workflow. Keep changes to one
feature at a time and verify before committing.

## Notes

- **No persistent chart storage.** Charts live in `localStorage` (`hp:chart`)
  only; the server never stores your chart. Short-share rows in Supabase have no
  expiry/GC.
- **Monaco loads from a CDN** (`cdn.jsdelivr.net`), so the editors need network
  access — offline/air-gapped use will degrade.
- **`HELM_BIN` in `.env.example` is stale** — rendering uses the Helm Go SDK, so
  it is unreferenced by the code.
- **Never commit secrets.** `SUPABASE_SERVICE_ROLE_KEY` is a server-only secret
  that bypasses Supabase RLS; keep it out of the client and out of git (`.env`
  and `.env*.local` are gitignored).
