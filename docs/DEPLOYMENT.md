# Deployment

How to self-host Charthouse, a playground for Helm charts. Charthouse ships as a single
self-contained Go binary that serves both the API and the built UI, so self-hosting is the
primary, zero-dependency path. A managed Vercel + Supabase setup is available as an optional
alternative.

> **Sharing works out of the box.** The Share button is backed by a pluggable store selected
> with the `SHARE_STORE` env var (`memory` by default). No external service is required — see
> [Storage durability](#storage-durability).

Related docs: [project map](../CLAUDE.md) · [README](../README.md) · [architecture](ARCHITECTURE.md) · [API reference](API.md) · [development](DEVELOPMENT.md)

---

## What you get in one binary

The production server (`cmd/server/main.go`) is a single, self-contained binary. It serves:

- `POST /api/render` — in-process Helm render via the Helm v4 Go SDK (no Helm CLI required).
- `GET`/`POST /api/share` — short-share links, backed by the configured store.
- `POST /api/import` — fetch and extract a chart archive from a URL.
- the built single-page app (`dist/`), **embedded at compile time** via `//go:embed all:dist`.

Unknown non-asset paths fall back to `index.html`, so client routes such as `/s/<id>` resolve in
the SPA; unmatched `/api/*` paths return a JSON `404`. Assets under `/assets/*` get a long
`immutable` cache; HTML is served `no-cache`. The server binds `PORT` (default `8080`).

You do not need the Helm CLI: rendering runs through the Helm Go SDK in-process.

---

## Option A — Docker (recommended)

The image is fully self-contained: the multi-stage `Dockerfile` builds the SPA with
`node:22-alpine` + pnpm, compiles a static Go binary on `golang:1.26-alpine` (`CGO_ENABLED=0`)
that embeds `dist/`, and ships the result on `gcr.io/distroless/static-debian12:nonroot`. The
final image has no shell and runs as a non-root user. It `EXPOSE`s `8080`.

### Compose (durable short links)

```bash
docker compose up --build
# -> http://localhost:8080
```

`docker-compose.yaml` defines one service, `charthouse`, mapping `8080:8080`. It sets
`SHARE_STORE=file` with `SHARE_DIR=/data/shares` and mounts the named volume
`charthouse-data` at `/data`, so short links are **durable across restarts and rebuilds**.

To change the storage backend, edit the `environment:` block:

- **Ephemeral links:** set `SHARE_STORE: "memory"` (no volume needed).
- **Managed storage:** set `SHARE_STORE: "supabase"` and provide `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (the compose file ships these as commented examples). See
  [Option C](#option-c--vercel--supabase-optionalmanaged) for the schema.

### Plain image (`docker build`)

```bash
docker build -t charthouse .
docker run -p 8080:8080 charthouse
# -> http://localhost:8080
```

A plain `docker run` uses the image defaults baked into the `Dockerfile`: `PORT=8080`,
`SHARE_STORE=memory`, `SHARE_DIR=/data/shares`. With the default memory store, links are
ephemeral (lost on container restart). Override at run time, e.g.:

```bash
# Durable links: mount a volume and switch to the file store.
docker run -p 8080:8080 \
  -e SHARE_STORE=file -e SHARE_DIR=/data/shares \
  -v charthouse-data:/data \
  charthouse
```

---

## Option B — single binary

Build the UI first (it is embedded into the binary), then build and run the server.

```bash
pnpm install
pnpm build                       # tsc -b && vite build  -> dist/
go build -o charthouse ./cmd/server
./charthouse                     # -> http://localhost:8080
```

`pnpm build` **must** precede `go build`: the SPA is embedded at compile time via
`//go:embed all:dist` (see [`embed.go`](../embed.go)). A committed `dist/.gitkeep` lets the Go
code compile even when no build has run — but without a real `pnpm build` the server has nothing
to serve and will report `frontend not built — run pnpm build` for UI routes. Run a real build
to serve the UI.

> A convenience script exists too: `pnpm serve` runs `go run ./cmd/server` (still requires a prior
> `pnpm build` to embed real assets).

Configure with environment variables (see [Configuration](#configuration)). For example:

```bash
PORT=9000 SHARE_STORE=file SHARE_DIR=/var/lib/charthouse/shares ./charthouse
```

---

## Configuration

Every value is optional; with no configuration at all Charthouse runs self-contained with
in-memory shares. The names below are exactly those documented in [`.env.example`](../.env.example).

| Variable                    | Default          | Secret?    | Meaning                                                                                                |
| --------------------------- | ---------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `PORT`                      | `8080`           | No         | HTTP port the self-hosted server (`cmd/server`) binds.                                                 |
| `SHARE_STORE`               | `memory`         | No         | Share-link backend: `memory` \| `file` \| `supabase`.                                                  |
| `SHARE_DIR`                 | `./data/shares`  | No         | Directory for the file store. Only used when `SHARE_STORE=file`.                                       |
| `SUPABASE_URL`              | _(unset)_        | No         | Supabase project base URL. Required when `SHARE_STORE=supabase`; calls `<SUPABASE_URL>/rest/v1/charthouse_shares` via PostgREST. |
| `SUPABASE_SERVICE_ROLE_KEY` | _(unset)_        | **Yes**    | Supabase service-role key, used as both `apikey` and `Authorization: Bearer`. Required when `SHARE_STORE=supabase`. Server-only — never expose to the client bundle. |

Behavior notes:

- An **unknown** `SHARE_STORE` value, or `SHARE_STORE=supabase` with `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` missing, is a misconfiguration: `/api/share` returns `503`. The SPA
  treats that `503` as a signal to fall back to self-contained hash URLs.
- With the default memory store (or a correctly configured file/supabase store), short links work,
  so `503` is otherwise not returned.

---

## Option C — Vercel + Supabase (optional / managed)

If you prefer a managed, serverless deployment, Charthouse also runs on Vercel with Supabase as
the share store. This path is entirely optional — the binary and Docker image above need none of it.

### Vercel layout

The repo ships [`vercel.json`](../vercel.json). It rewrites short-link paths to the SPA and
declares the three Go serverless functions:

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

The `/s/:id` rewrite sends short-link URLs to the SPA so the frontend can read the `:id`, call
`GET /api/share?id=<id>`, and load the shared chart (the browser keeps the `/s/:id` URL). Vercel
auto-detects the Vite build (`pnpm build` → `dist/`) and the Go functions under `api/`; each
`api/*/index.go` exports a `Handler` in the Vercel Go-function style.

### Supabase store

1. **Set env vars in Vercel** (Project Settings → Environment Variables):
   `SHARE_STORE=supabase`, `SUPABASE_URL=https://<project>.supabase.co`,
   `SUPABASE_SERVICE_ROLE_KEY=<service-role key>`.
2. **Apply the migration.** The schema lives in [`supabase/migrations/`](../supabase/migrations/)
   (`20260609000000_charthouse_shares.sql`). Apply it against your linked project:

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   This creates table `public.charthouse_shares` (`id text primary key`, `payload jsonb not null`,
   `created_at timestamptz not null default now()`), an index on `created_at`, and **enables Row
   Level Security**. RLS is enabled with **zero policies** on purpose: `anon`/`authenticated` keys
   cannot touch the table at all. The `/api/share` function authenticates with the **service-role
   key**, which bypasses RLS, so it is the only thing that can read or write shares.

> **Keep the service-role key server-only.** It bypasses RLS — leaking it grants full read/write
> to your Supabase project. There are no `VITE_`-prefixed variables in this project; never add one
> for the service-role key, and never let it reach the client bundle.

---

## Storage durability

| `SHARE_STORE` | Durability                                  | Use when                                            |
| ------------- | ------------------------------------------- | --------------------------------------------------- |
| `memory`      | **Ephemeral** — links die on restart        | Quick trials, demos, stateless instances            |
| `file`        | **Durable** on a mounted volume (`SHARE_DIR`) | Single-node self-hosting (the Docker compose default) |
| `supabase`    | **Managed** — Postgres via Supabase          | Serverless / multi-instance deployments             |

The `file` store writes one JSON file per share under `SHARE_DIR` with atomic rename-on-write;
mount that directory on a persistent volume (compose uses the named volume `charthouse-data`) for
durable links.

---

## Post-deploy smoke check

Replace `<host>` with your deployed origin (e.g. `http://localhost:8080`).

1. **UI loads.** Open `http://<host>/`. The sample chart should render in the output column. For a
   managed deployment, a short-link route such as `http://<host>/s/<id>` should also serve the SPA.

2. **Render API.** Confirm `POST /api/render` returns `{ "ok": true, ... }`:

   ```bash
   curl -sS -X POST http://<host>/api/render \
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

   Expect a `200` with `{ "ok": true, "stdout": "...ConfigMap...", "stderr": "", "durationMs": <n>, "helmVersion": "v4.2.0 sdk" }`.

3. **Share round-trip (optional).** Create a share, then read it back with the returned id:

   ```bash
   curl -sS -X POST http://<host>/api/share \
     -H 'content-type: application/json' \
     -d '{"payload":{"files":{"Chart.yaml":"apiVersion: v2\nname: s\nversion: 0.1.0\n"},"releaseName":"demo","namespace":"default"}}'
   # -> {"id":"abc12345"}

   curl -sS 'http://<host>/api/share?id=abc12345'
   # -> {"id":"abc12345","payload":{...}}
   ```

   With `SHARE_STORE=memory` this succeeds but the link is lost on restart. With a misconfigured
   store (unknown value, or `supabase` without credentials), `POST /api/share` returns `503` and
   the Share button falls back to a self-contained `#h=...` hash URL.

For exact request/response shapes and status codes, see [API.md](API.md).
