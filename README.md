# helm-playground

A real-time Helm template rendering UI. Three columns: chart files (left), values
(middle), rendered output (right). Gruvbox theme with light/dark toggle. No
persistent storage — drop a chart, render, share, walk away.

## Features

- **3-column layout** — file tree + editor, values + override, live `helm template` output.
- **Live render** — edits are debounced and shipped to `helm template`; output and per-document tabs update in place.
- **Upload chart** — drop a folder, `.zip`, or `.tgz` onto the window, or use the toolbar `upload` menu. Top-level chart directory is auto-stripped.
- **Edit in browser** — Monaco editor for templates, values, helpers. Create / rename / delete files from the tree.
- **values.override.yaml** — separate tab, applied after `values.yaml` with `-f`.
- **Shareable URLs** —
  - If `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set: short URL `/s/abc123` backed by a Supabase row.
  - Otherwise: falls back to a self-contained `#h=<deflated base64>` hash URL (long, but no infra required).
- **Gruvbox theme** with light/dark toggle, persisted in `localStorage`.

## Architecture

```
src/        Vite + React + TS frontend
api/        Vercel-style Go serverless functions
  render/index.go → Helm SDK render equivalent of `helm template <release> <chartDir> --namespace <ns> [-f values.override.yaml]`
  share/index.go  → Supabase-backed short URLs (PostgREST, no SDK)
cmd/dev/main.go   Local Go dev API server (port 5174). Vite proxies /api/* to it.
```

Render strategy: the API writes the in-memory chart files to a temp directory,
renders through the Helm Go SDK, and returns `{ ok, stdout, stderr, durationMs, helmVersion }`.

Limits: 500 files, 256 KiB per file, 4 MiB total, 10s timeout.

## Prereqs

- `pnpm` 11+
- `node` 22.13+ for the pinned `pnpm` 11.x release
- `go` 1.26+ for the API

```sh
pnpm install
pnpm dev
```

This starts:

- Vite on `http://localhost:5173`
- Go dev API on `http://localhost:5174` (proxied at `/api/*`)

Open `http://localhost:5173`. The sample chart renders immediately.

## Smoke test

```sh
# After `pnpm dev`, the sample chart should render. From another shell:
curl -s http://localhost:5174/api/render \
  -H 'content-type: application/json' \
  -d "$(node -e 'const fs=require("fs");
const f={
  "Chart.yaml":"apiVersion: v2\nname: smoke\nversion: 0.1.0\n",
  "values.yaml":"replicas: 1\n",
  "templates/cm.yaml":"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: smoke\ndata:\n  r: \"{{ .Values.replicas }}\"\n"
};
process.stdout.write(JSON.stringify({files:f,releaseName:"demo",namespace:"default"}));')" \
  | jq .
```

You should get `{ "ok": true, "stdout": "...ConfigMap...", "stderr": "...", "durationMs": <ms>, "helmVersion": "v..." }`.

## Deploy: Vercel + Supabase

1. **Supabase**: create a project, then apply the schema via the Supabase CLI:

   ```sh
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   The schema lives in [`supabase/migrations/`](./supabase/migrations) — the
   initial migration creates `public.helm_playground_shares` and enables RLS.
   The Go `/api/share` function uses the `service_role` key, which bypasses
   RLS; anon/authenticated keys cannot reach the table.

   Grab `Project URL` and the **service role** key (server-side only).

2. **Vercel**: import the repo. Set env vars in the Vercel project:

   ```
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
   ```

   The share handler is a Go Vercel Function that talks to Supabase via
   PostgREST — no client SDK on the server. `vercel.json` already rewrites
   `/s/:id` to `/` so the SPA can resolve the share on load.

3. **Render API**: `/api/render` is a Go Vercel Function backed by the Helm
   SDK. Vercel builds it from `api/render/index.go` using the root `go.mod`,
   so no Helm CLI binary or `HELM_BIN` setting is required.

## Hosting without Supabase

The Share button gracefully falls back to a `#h=<deflated-base64>` URL that
encodes the whole chart. The URL is longer (a few KB) but requires no backend.
The app decodes it on load and removes the hash from history.

## Project layout

```
.
├── api/
│   ├── render/index.go
│   └── share/index.go
├── cmd/dev/main.go
├── supabase/
│   ├── config.toml
│   └── migrations/
│       └── 20260609000000_helm_playground_shares.sql
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/{layout,editor,values,output,upload,share,theme}/...
│   ├── store/{chart-store,theme-store,render-store}.ts
│   ├── lib/{helm-client,share-client,chart-archive,use-debounced-render,sample-chart}.ts
│   ├── styles/{globals,gruvbox}.css
│   └── types/chart.ts
├── vercel.json
├── go.mod
├── go.sum
├── vite.config.ts
└── package.json
```
