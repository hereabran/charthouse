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
api/        Vercel-style serverless handlers (also used by dev server)
  render.ts → spawn `helm template <release> <chartDir> --namespace <ns> [-f values.override.yaml]`
  share.ts  → Supabase-backed short URLs
server/dev.ts  Local dev API server (port 5174). Vite proxies /api/* to it.
```

Render strategy: the API writes the in-memory chart files to a temp directory,
spawns `helm template` via `child_process`, returns `{ ok, stdout, stderr, durationMs, helmVersion }`.

Limits: 500 files, 256 KiB per file, 4 MiB total, 10s timeout.

## Prereqs

- `pnpm` 9+
- `node` 20+
- `helm` 3.x or 4.x on PATH (override with `HELM_BIN`)

```sh
pnpm install
pnpm dev
```

This starts:

- Vite on `http://localhost:5173`
- Dev API on `http://localhost:5174` (proxied at `/api/*`)

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

1. **Supabase**: create a project; run this SQL once:

   ```sql
   create table if not exists helm_playground_shares (
     id text primary key,
     payload jsonb not null,
     created_at timestamptz not null default now()
   );
   -- Optional retention: drop shares older than 30 days.
   create index if not exists helm_playground_shares_created_at_idx
     on helm_playground_shares (created_at);
   ```

   Grab `Project URL` and the **service role** key (server-side only).

2. **Vercel**: import the repo. Set env vars in the Vercel project:

   ```
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
   ```

   The `api/*.ts` handlers run as Node serverless functions. `vercel.json`
   already rewrites `/s/:id` to `/` so the SPA can resolve the share on load.

3. **Helm binary on Vercel**: the default Node runtime does **not** ship `helm`.
   Use one of:
   - Set `HELM_BIN` to a path you bundle in `api/` (commit the linux/amd64 binary).
   - Or deploy the API on a host that has `helm` available (Render, Fly, Railway, your own VM) and point Vite at it via a rewrite.

   For local dev and self-hosted deployments where `helm` is on PATH, no extra
   config is needed.

## Hosting without Supabase

The Share button gracefully falls back to a `#h=<deflated-base64>` URL that
encodes the whole chart. The URL is longer (a few KB) but requires no backend.
The app decodes it on load and removes the hash from history.

## Project layout

```
.
├── api/
│   ├── _lib/{helm,supabase,json-handler}.ts
│   ├── render.ts
│   └── share.ts
├── server/dev.ts
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/{layout,editor,values,output,upload,share,theme}/...
│   ├── store/{chart-store,theme-store,render-store}.ts
│   ├── lib/{helm-client,share-client,chart-archive,use-debounced-render,sample-chart}.ts
│   ├── styles/{globals,gruvbox}.css
│   └── types/chart.ts
├── vercel.json
├── vite.config.ts
└── package.json
```
