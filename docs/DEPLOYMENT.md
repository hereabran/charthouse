# Deployment — Vercel + Supabase

How to deploy helm-playground to Vercel, with optional Supabase-backed short-share URLs.

> Sharing is **optional**. With Supabase unset, the app still deploys and works — the Share button
> falls back to self-contained hash URLs (no backend). See [Degraded mode](#degraded-mode-no-supabase).

Related docs: [project map](../CLAUDE.md) · [README](../README.md) · [architecture](ARCHITECTURE.md) · [API reference](API.md)

---

## Architecture on Vercel

helm-playground deploys as two things on one Vercel project:

1. **Static frontend** — the Vite build output (`dist/`), served as static assets / an SPA.
2. **Go serverless functions** under `api/` — one function per handler:
   - `api/render/index.go` → `POST /api/render` (Helm v4 Go SDK, in-process render)
   - `api/share/index.go` → `GET`/`POST /api/share` (Supabase-backed short URLs)
   - `api/import/index.go` → `POST /api/import` (fetch + extract a chart archive from a URL)

Each `index.go` exports a `Handler` function in the Vercel Go-function style. Vercel auto-detects them
from the `api/` directory and builds them using the root `go.mod` (module `helm-playground`, `go 1.26.0`,
`helm.sh/helm/v4 v4.2.0`). **No Helm CLI binary is required** — rendering runs through the Helm Go SDK.

> The local dev server `cmd/dev/main.go` (port `5174`) is for development only. It muxes the same three
> handlers behind one process; in production each handler is its own serverless function. It is **not**
> deployed.

### The `/s/:id` rewrite

Short-share links look like `https://<your-app>/s/abc12345`. There is no `/s/...` page on disk — these
URLs must reach the SPA so the frontend can read the `:id`, call `GET /api/share?id=<id>`, and load the
shared chart. `vercel.json` rewrites the path to the SPA root:

```json
{ "source": "/s/:id", "destination": "/" }
```

The browser keeps the `/s/:id` URL; only the served content is the SPA. On load, the frontend matches
the path `^/s/([a-z0-9]{6,16})$`, fetches the payload, and then rewrites the URL to `/`.

---

## Build / output config

The full `vercel.json` is small and authoritative — this is the entire file:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/s/:id", "destination": "/" }
  ],
  "functions": {
    "api/render/index.go": { "maxDuration": 15, "memory": 1024 },
    "api/share/index.go": { "maxDuration": 10, "memory": 256 },
    "api/import/index.go": { "maxDuration": 15, "memory": 512 }
  }
}
```

What this does — and, importantly, what it leaves to Vercel auto-detection:

- **No `buildCommand`** is set. Vercel auto-detects the Vite project and runs its build (the repo's
  `pnpm build` = `tsc -b && vite build`). The `packageManager` pin (`pnpm@11.5.1`) in `package.json`
  selects pnpm.
- **No `outputDirectory`** is set. Vercel uses Vite's default output, `dist/`.
- **No Go runtime version pin.** The Go version is inferred from the root `go.mod` (`go 1.26.0`).
- **`functions`** sets per-function limits:

  | Function                | `maxDuration` | `memory` |
  | ----------------------- | ------------- | -------- |
  | `api/render/index.go`   | 15s           | 1024 MB  |
  | `api/share/index.go`    | 10s           | 256 MB   |
  | `api/import/index.go`   | 15s           | 512 MB   |

> Do not add a `buildCommand` or `outputDirectory` unless you are intentionally overriding
> auto-detection — the current setup relies on it.

---

## Supabase setup (optional — enables short URLs)

Sharing is only short-URL-backed when **both** Supabase env vars are set on the deployment (see below).
If you skip this section, the app still deploys; sharing degrades gracefully to hash URLs.

### 1. Create a project

Create a Supabase project. Note its project URL (e.g. `https://xxxxxxxx.supabase.co`) and its
**service-role** key (Settings → API → `service_role` secret).

### 2. Apply the migration

The schema lives in `supabase/migrations/`. Apply it with the Supabase CLI against your linked project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

This applies the single migration file:

- **`supabase/migrations/20260609000000_helm_playground_shares.sql`**

which creates table **`public.helm_playground_shares`**:

| Column       | Type          | Notes                          |
| ------------ | ------------- | ------------------------------ |
| `id`         | `text`        | primary key                    |
| `payload`    | `jsonb`       | `not null`                     |
| `created_at` | `timestamptz` | `not null default now()`       |

It also creates an index `helm_playground_shares_created_at_idx` on `created_at`, and runs
`alter table ... enable row level security`.

> **Migration discipline:** if the shares table ever needs to change, create a new migration with
> `supabase migration new <name>` and re-run `supabase db push`. Never edit a previously-applied
> migration in place.

### 3. RLS posture (read before deploying)

Row Level Security is **enabled with zero policies** — this is intentional. With no policies, the
`anon` and `authenticated` keys cannot read or write the table at all. The `/api/share` Go function
authenticates with the **service-role key**, which bypasses RLS, so it is the only thing that can touch
the table.

Consequences:

- The service-role key is what makes sharing work. It is a **server-only secret**.
- Because the function uses the service-role key for both the `apikey` and `Authorization: Bearer`
  headers, all share reads/writes run with full privileges. Keep this key out of the client at all costs
  (see next section).
- Share rows have no expiry/GC; old rows accumulate in `created_at` order until you prune them.

---

## Environment variables (set in Vercel)

Set these in your Vercel project (Project Settings → Environment Variables). The names below are exactly
those documented in `.env.example`; do not rename them.

| Variable                    | Required? | Secret?            | Purpose                                                                                     |
| --------------------------- | --------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Optional  | Non-secret config  | Supabase project base URL; `/api/share` calls `<SUPABASE_URL>/rest/v1/helm_playground_shares` via PostgREST. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional  | **SECRET**         | Service-role key used by `/api/share` as both `apikey` and `Authorization: Bearer` (bypasses RLS). |
| `HELM_BIN`                  | Optional  | (unused)           | Documented in `.env.example` only; **not referenced anywhere in code** — render uses the Helm Go SDK. Leave unset. |

Notes and constraints:

- **Both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set together.** If either is missing,
  `/api/share` returns HTTP `503` and the frontend transparently falls back to hash URLs.
- **No `VITE_`-prefixed (client-exposed) variables exist in this project.** Anything prefixed `VITE_`
  is bundled into the public client and is readable by anyone. Because there are no public vars, do not
  create one — and in particular **never** add `VITE_SUPABASE_SERVICE_ROLE_KEY` or otherwise expose the
  service-role key to the client bundle. The service-role key bypasses RLS; leaking it gives anyone full
  read/write to your Supabase project.
- `HELM_BIN` is stale config kept only in `.env.example`; setting it has no effect.
- `API_PORT` is **dev-only** (consumed by `cmd/dev/main.go`); it is not used in the Vercel deployment.

---

## Degraded mode (no Supabase)

You do **not** need Supabase to deploy or to use sharing. When `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` are unset:

- `POST /api/share` returns `503` (`sharing not configured: ...`).
- The Share button catches that and instead builds a **self-contained hash URL** of the form
  `https://<your-app>/#h=<deflated-base64>`, which encodes the whole chart (files + release + namespace)
  in the fragment. It needs no backend; the app decodes it on load and strips the hash from history.

So a Supabase-less deployment is fully functional — sharing just produces longer URLs (a few KB) instead
of short `/s/:id` links. Add Supabase later to upgrade to short URLs without any code change.

> `/api/render` and `/api/import` do **not** depend on Supabase and work regardless of these env vars.

---

## Post-deploy smoke check

After the deployment goes live (replace `<your-app>` with the deployed host):

1. **Frontend loads + renders.** Open `https://<your-app>/`. The sample chart should render
   immediately in the right-hand output column.

2. **Render API.** Confirm `POST /api/render` returns `{ "ok": true, ... }` for a minimal chart:

   ```bash
   curl -sS -X POST https://<your-app>/api/render \
     -H 'content-type: application/json' \
     -d '{
       "files": {
         "Chart.yaml": "apiVersion: v2\nname: smoke\nversion: 0.1.0\n",
         "values.yaml": "msg: hi\n",
         "templates/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: smoke\ndata:\n  msg: {{ .Values.msg }}\n"
       },
       "releaseName": "demo",
       "namespace": "default"
     }'
   ```

   Expect a `200` with `{ "ok": true, "stdout": "...ConfigMap...", "stderr": "", "durationMs": <n>, "helmVersion": "..." }`.

3. **Share — short URL (only if Supabase is configured).** Click **Share** in the UI; you should get a
   `https://<your-app>/s/<id>` link. Open it in a fresh tab and confirm the chart loads. Equivalent
   API checks:

   ```bash
   # Create a share
   curl -sS -X POST https://<your-app>/api/share \
     -H 'content-type: application/json' \
     -d '{"payload":{"files":{"Chart.yaml":"apiVersion: v2\nname: s\nversion: 0.1.0\n"},"releaseName":"demo","namespace":"default"}}'
   # -> {"id":"abc12345"}

   # Read it back (use the id returned above)
   curl -sS 'https://<your-app>/api/share?id=abc12345'
   # -> {"id":"abc12345","payload":{...}}
   ```

   If Supabase is **not** configured, `POST /api/share` returns `503` — that is expected, and the
   Share button will produce a `#h=...` hash URL instead. Confirm that hash URL loads the chart.

4. **Import (optional).** Confirm `POST /api/import` resolves a public chart archive or Helm repo URL:

   ```bash
   curl -sS -X POST https://<your-app>/api/import \
     -H 'content-type: application/json' \
     -d '{"url":"https://example.com/path/to/chart.tgz"}'
   # -> {"ok":true,"files":{...},"source":{...}}
   ```

If all of the above behave as described, the deployment is healthy. For exact request/response shapes
and status codes, see [API.md](API.md).
