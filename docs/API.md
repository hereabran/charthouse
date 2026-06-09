# API Reference

The backend HTTP contract for charthouse. Three functional endpoints, all
stateless: `/api/render`, `/api/share` (GET + POST), and `/api/import`. There is
no health check, no version endpoint, and no auth on any route. Every other path
returns a catch-all `404`.

This document is the exact contract — request/response shapes here match the Go
handlers byte-for-byte. Only fields the code actually reads or returns are
documented.

- Backend overview and how the pieces fit: [ARCHITECTURE.md](ARCHITECTURE.md)
- Repo map and session workflow: [../CLAUDE.md](../CLAUDE.md)

---

## How requests reach these handlers

The same three handlers (`render.Handler`, `share.Handler`,
`importchart.Handler`) back **three** entry points. The `/api/*` paths are
**identical** across all three (`/api/render`, `/api/share`, `/api/import`) —
only the wiring and port differ.

- **Local dev** — `cmd/dev/main.go` builds an `http.ServeMux`, registers the
  three exact paths, and listens on `API_PORT` (default `5174`). Any other path
  returns `404` with JSON `{"error":"not found","path":"<requested-path>"}`. The
  Vite dev server (port `5173`) proxies `/api` → `http://localhost:5174`; the dev
  Go server itself does **not** serve the frontend, does **not** proxy to Vite,
  and sets **no CORS headers**.
- **Self-hosted server** — `cmd/server/main.go` is a single self-contained binary
  (also the Docker image). It registers the same three handlers **and** serves the
  built SPA, embedded into the binary at compile time. It listens on `PORT`
  (default `8080`). Unknown non-asset paths fall back to `index.html` so client
  routes like `/s/<id>` resolve in the SPA; unmatched `/api/*` paths get a JSON
  `404` (`{"error":"not found"}`); `/assets/*` get a long immutable cache and HTML
  is served `no-cache`.
- **Vercel functions** — each file under `api/` (`api/render/index.go`,
  `api/share/index.go`, `api/import/index.go`) is deployed as a Go serverless
  function exporting `Handler`, mapped to the matching `/api/*` route by Vercel.
  `vercel.json` also rewrites `/s/:id` → `/` so shared links land on the SPA.

All handlers set these response headers on their JSON replies:

```
content-type: application/json; charset=utf-8
cache-control: no-store
```

> Helm rendering is done **in-process** via the Helm v4 Go SDK
> (`helm.sh/helm/v4`). There is no `helm` binary exec and no CLI subcommand. See
> [ARCHITECTURE.md](ARCHITECTURE.md) for details.

The curl examples below use `http://localhost:8080` (the self-hosted server). For
local dev, swap the port to `5174` (or hit the Vite proxy on `5173`).

---

## POST /api/render

Renders an in-memory chart with the Helm Go SDK
(`action.NewInstall` + `DryRunStrategy = DryRunClient`, storage driver
`"memory"`). Chart files are written to a per-request temp dir
(`os.MkdirTemp("", "helm-pg-")`) and removed after rendering. Render timeout is
**10 seconds**.

**Method**: `POST` only. Any other method returns `405` with header `Allow: POST`
and an empty body.

### Request body

`Content-Type: application/json`. Max body **5 MiB** (`http.MaxBytesReader`).

```json
{
  "files": { "<relpath>": "<content>", "...": "..." },
  "releaseName": "string",
  "namespace": "string",
  "includeCRDs": false
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `files` | `object` (`map[string]string`) | yes | Relative chart path → file content. Must include a `Chart.yaml` key. |
| `releaseName` | `string` | yes | Sanitized to lowercase `[a-z0-9-]` (other chars → `-`), max 53 chars; empty → `demo`. |
| `namespace` | `string` | yes | Same sanitization, max 63 chars; empty → `default`. |
| `includeCRDs` | `bool` | no | Defaults to `false`. Omitted by the frontend. |

**`files` validation** (all enforced before render):

- At least one file (else `400` `no chart files supplied`).
- `Chart.yaml` key required (else `400` `Chart.yaml is required`).
- Max **500** files; max **256 KiB** per file; max **4 MiB** total.
- Each path must be safe: non-empty, no leading `/`, no `\`, no NUL, not `.`, not
  starting with `..`, no `/../`, and unchanged by `path.Clean`. Unsafe →
  `400` `unsafe path: <p>`.

**Optional values override**: if `files["values.override.yaml"]` is present and
non-blank, it is parsed via `loader.LoadValues` and used as the install values;
otherwise values default to an empty map.

### Success response — `200 OK`

```json
{
  "ok": true,
  "stdout": "<rendered manifest YAML>",
  "stderr": "",
  "durationMs": 42,
  "helmVersion": "v4.2.0 sdk"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | `bool` | `true` on success. |
| `stdout` | `string` | The rendered manifest. |
| `stderr` | `string` | `""` on success; carries the error message otherwise. |
| `durationMs` | `int64` | Render wall-clock in ms. |
| `helmVersion` | `string` | Omitted when empty; e.g. `v4.2.0 sdk` (from build info). |

### Error responses

All errors use the **same** `renderResponse` shape with `ok: false`, the message
in `stderr`, and (where available) `durationMs` / `helmVersion`.

| Status | When | `stderr` example |
| --- | --- | --- |
| `400` Bad Request | JSON decode failure | `bad request: <err>` |
| `400` Bad Request | Input validation (no files / missing `Chart.yaml` / too many/large files / unsafe path) | `Chart.yaml is required` |
| `422` Unprocessable Entity | Invalid `values.override.yaml`, chart load error, or Helm render error | `Error: <err>` |
| `422` Unprocessable Entity | Render exceeded the 10s timeout | `render timed out after 10000ms` |
| `500` Internal Server Error | SDK/config init or temp-dir failure | `server error: <err>` |
| `405` Method Not Allowed | Non-POST method | _(empty body; `Allow: POST`)_ |

> Note: a Helm template error (bad chart) is a **`422`**, not a `5xx`. The
> frontend treats `422` as a normal (error-carrying) response rather than a
> transport failure.

### curl

```bash
curl -sS -X POST http://localhost:8080/api/render \
  -H 'content-type: application/json' \
  -d '{
    "releaseName": "demo",
    "namespace": "default",
    "files": {
      "Chart.yaml": "apiVersion: v2\nname: hello\nversion: 0.1.0\n",
      "values.yaml": "msg: hi\n",
      "templates/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}-cm\ndata:\n  msg: {{ .Values.msg }}\n"
    }
  }'
```

---

## Sharing: backing store

`/api/share` (both GET and POST) is backed by a pluggable **Store**, selected at
runtime by the `SHARE_STORE` environment variable. The store is initialized once
per process (via `sync.Once`); an initialization failure is the **only** thing
that produces a `503` (see below).

| `SHARE_STORE` | Backend | Durability | Extra config |
| --- | --- | --- | --- |
| `memory` *(default)* | In-process map | Ephemeral — links are lost on restart | none |
| `file` | One JSON file per share under `SHARE_DIR` (default `./data/shares`), atomic writes | Durable on disk | `SHARE_DIR` (optional) |
| `supabase` | Supabase PostgREST table `charthouse_shares` via the service-role key | Durable | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (both required) |

With `memory` (the default) and `file`, sharing works with **no external
service** — short links are available out of the box. The `supabase` backend is
opt-in and is the only one that requires credentials.

**Shared across all backends:**

- Generated ids are **8 chars** over the unambiguous alphabet
  `23456789abcdefghjkmnpqrstuvwxyz` (`crypto/rand`). Used to build `/s/<id>`.
- Accepted ids (on GET) must match `^[a-z0-9]{6,16}$` (also covers legacy ids).
- Max accepted payload is **256 KiB**.

If store initialization fails, the handler returns `503` and the SPA falls back
to a self-contained `#h=` hash URL (the full state is encoded in the link, no
backend needed). This happens **only** on explicit misconfiguration — e.g.
`SHARE_STORE=supabase` with a missing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`,
or an unknown `SHARE_STORE` value. The default `memory` path never returns `503`.

---

## POST /api/share

Stores a payload via the configured store and returns its id.

**Method**: `POST` (this section). Any method other than `GET`/`POST` returns
`405` with header `Allow: GET, POST`.

### Request body

`Content-Type: application/json`. Max body **256 KiB**.

```json
{ "payload": { "...": "..." } }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `payload` | JSON object | yes | Stored verbatim. Must be a JSON object (raw text must start with `{`). |

The frontend sends `payload` as the share state, but the handler stores whatever
JSON object it receives.

### Success response — `200 OK`

```json
{ "id": "abc23xyz" }
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Newly generated 8-char id over alphabet `23456789abcdefghjkmnpqrstuvwxyz`. Used to build `/s/<id>`. |

### Error responses

POST errors return `{"error":"<message>"}`.

| Status | When | `error` example |
| --- | --- | --- |
| `400` Bad Request | JSON decode failure | `bad request: <err>` |
| `400` Bad Request | Empty payload or not a JSON object | `payload required` |
| `502` Bad Gateway | Store failed to persist (e.g. Supabase unreachable / `>= 400`, filesystem error, id-allocation failure) | `supabase 401: <body>` |
| `503` Service Unavailable | Store not configured / failed to initialize (misconfiguration only) | `sharing not configured: SHARE_STORE=supabase requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY` |

> For the `supabase` backend, the upstream PostgREST call timeout is **8 seconds**
> per request. The `memory` and `file` backends are local and have no network
> timeout.

### curl

```bash
curl -sS -X POST http://localhost:8080/api/share \
  -H 'content-type: application/json' \
  -d '{"payload":{"files":{"Chart.yaml":"apiVersion: v2\nname: hello\nversion: 0.1.0\n"},"releaseName":"demo","namespace":"default"}}'
```

---

## GET /api/share?id=&lt;id&gt;

Loads a previously shared payload by id from the configured store.

**Method**: `GET` (this section). See the method note above for `405`.

### Request

| Param | In | Type | Notes |
| --- | --- | --- | --- |
| `id` | query string | `string` | Must match `^[a-z0-9]{6,16}$`. |

### Success response — `200 OK`

```json
{ "id": "abc23xyz", "payload": { "...": "..." } }
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | The requested id. |
| `payload` | JSON | The stored payload, returned as raw JSON. |

### Error responses

GET errors return `{"error":"<message>"}`.

| Status | When | `error` example |
| --- | --- | --- |
| `400` Bad Request | `id` does not match the pattern | `invalid id` |
| `404` Not Found | No share for that id | `not found` |
| `502` Bad Gateway | Store/upstream error (e.g. Supabase unreachable / `>= 400` / decode failure, filesystem error) | `supabase unreachable: <err>` |
| `503` Service Unavailable | Store not configured / failed to initialize (misconfiguration only) | `sharing not configured: unknown SHARE_STORE "..." (want memory\|file\|supabase)` |

### curl

```bash
curl -sS 'http://localhost:8080/api/share?id=abc23xyz'
```

---

## POST /api/import

Fetches a chart over HTTP(S) and returns its files. Accepts a direct archive
(`.tgz` / `.tar.gz` / `.zip`), a Helm repo **base** URL (fetches `index.yaml` and
auto-picks the single chart, or errors listing all if multiple), or a repo+chart
URL. Strong SSRF protection: the host is resolved and the **validated IP** is
dialed directly; loopback, unspecified, link-local, multicast, and RFC 1918
private addresses are refused. (RFC 6598 `100.64.0.0/10` / Tailscale is
intentionally allowed.)

**Method**: `POST` only. Any other method returns `405` with header `Allow: POST`.

### Request body

`Content-Type: application/json`. Max body **8 KiB**.

```json
{ "url": "https://example.com/charts/hello-0.1.0.tgz" }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | `string` | yes | Must be `http` or `https` with a non-empty host. |

**Limits**: archive download capped at 32 MiB; `index.yaml` capped at 32 MiB;
per extracted file 2 MiB; max 1000 files; total extracted 16 MiB. Max 5 redirects,
each re-validated. Per-fetch timeout 10s; overall handler deadline 20s.

### Success response — `200 OK`

```json
{
  "ok": true,
  "files": { "Chart.yaml": "...", "values.yaml": "...", "templates/deployment.yaml": "..." },
  "source": {
    "url": "https://example.com/charts/hello-0.1.0.tgz",
    "contentType": "application/gzip",
    "format": "tgz",
    "sizeBytes": 1234
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | `bool` | `true` on success. |
| `files` | `object` (`map[string]string`) | Extracted chart files. Common chart-root dir stripped; binary extensions skipped; must contain `Chart.yaml`. Omitted on error. |
| `source` | `object` | Omitted on error. |
| `source.url` | `string` | The resolved archive URL actually fetched. |
| `source.contentType` | `string` | Upstream `Content-Type`. Omitted if empty. |
| `source.format` | `string` | `tgz` or `zip`. |
| `source.sizeBytes` | `int` | Downloaded archive size in bytes. |

### Error responses

Errors return `{"ok":false,"error":"<message>"}` (`ok`/`error` only; `files` and
`source` are omitted).

| Status | When | `error` example |
| --- | --- | --- |
| `400` Bad Request | JSON decode failure | `bad request: <err>` |
| `400` Bad Request | Missing / invalid `url` (empty, bad scheme, no host) | `unsupported scheme "ftp" (use http or https)` |
| `400` Bad Request | SSRF guard blocked the target or a redirect | `refusing to connect to <ip> (private/loopback/link-local)` |
| `413` Payload Too Large | Download/extraction exceeds a size cap | `download exceeds limit (33554432 bytes)` |
| `422` Unprocessable Entity | Repo resolution issue (no/ambiguous chart, missing `index.yaml`) | `chart <name> not in repo. Available: ...`, `repo has <n> charts; specify one (e.g. ...)`, `no index.yaml at <url>: ...` |
| `422` Unprocessable Entity | Unsupported format or missing `Chart.yaml` after extraction | `unsupported archive format (need .tgz, .tar.gz, or .zip)`, `archive missing Chart.yaml` |
| `502` Bad Gateway | Upstream HTTP error / fetch failure | `upstream HTTP 404` |
| `405` Method Not Allowed | Non-POST method | _(empty body; `Allow: POST`)_ |

### curl

```bash
# Direct archive
curl -sS -X POST http://localhost:8080/api/import \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/charts/hello-0.1.0.tgz"}'

# Helm repo base URL (auto-picks the single chart, or 422 lists all)
curl -sS -X POST http://localhost:8080/api/import \
  -H 'content-type: application/json' \
  -d '{"url":"https://charts.example.com/"}'
```

---

## Catch-all

Any path other than the three above returns `404`. In local dev (`cmd/dev`) the
body is `{"error":"not found","path":"<requested-path>"}`. On the self-hosted
server (`cmd/server`), unmatched `/api/*` paths return `{"error":"not found"}`,
while every other unknown path falls back to the SPA's `index.html`.
