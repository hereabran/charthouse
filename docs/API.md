# API Reference

The backend HTTP contract for helm-playground. Three functional endpoints, all
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

The same three handlers serve both local dev and production — **the paths are
identical** (`/api/render`, `/api/share`, `/api/import`).

- **Local dev**: `cmd/dev/main.go` builds an `http.ServeMux`, registers the three
  exact paths, and listens on `API_PORT` (default `5174`). Any other path returns
  `404` with JSON `{"error":"not found","path":"<requested-path>"}`. The Vite dev
  server (port `5173`) proxies `/api` → `http://localhost:5174`; the Go server
  itself does **not** serve the frontend, does **not** proxy to Vite, and sets
  **no CORS headers**.
- **Production (Vercel)**: each file under `api/` (`api/render/index.go`,
  `api/share/index.go`, `api/import/index.go`) is deployed as a Go serverless
  function exporting `Handler`, mapped to the matching `/api/*` route by Vercel.

All handlers set these response headers on their JSON replies:

```
content-type: application/json; charset=utf-8
cache-control: no-store
```

> Helm rendering is done **in-process** via the Helm v4 Go SDK
> (`helm.sh/helm/v4`). There is no `helm` binary exec and no CLI subcommand. See
> [ARCHITECTURE.md](ARCHITECTURE.md) for details.

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
curl -sS -X POST http://localhost:5174/api/render \
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

## POST /api/share

Creates a short-share row in Supabase and returns its id. Persists via the
Supabase PostgREST REST API (`POST <SUPABASE_URL>/rest/v1/helm_playground_shares`)
using the service-role key — **no** Postgres driver.

**Method**: `POST` (this section). Any method other than `GET`/`POST` returns
`405` with header `Allow: GET, POST`.

**Requires configuration**: both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
must be set. If either is empty, the handler returns **`503`** (see below) and the
SPA falls back to a self-contained `#h=` hash URL.

### Request body

`Content-Type: application/json`. Max body **256 KiB**.

```json
{ "payload": { "...": "..." } }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `payload` | JSON object | yes | Stored verbatim. Must be a JSON object (raw text must start with `{`). |

The frontend sends `payload` as `{ files, releaseName, namespace }`, but the
handler stores whatever JSON object it receives.

### Success response — `200 OK`

```json
{ "id": "abc23xyz" }
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Newly generated 8-char id over alphabet `23456789abcdefghjkmnpqrstuvwxyz` (`crypto/rand`). Used to build `/s/<id>`. |

### Error responses

POST errors return `{"error":"<message>"}`.

| Status | When | `error` example |
| --- | --- | --- |
| `400` Bad Request | JSON decode failure | `bad request: <err>` |
| `400` Bad Request | Empty payload or not a JSON object | `payload required` |
| `502` Bad Gateway | Supabase unreachable | `supabase unreachable: <err>` |
| `502` Bad Gateway | Supabase responded `>= 400` | `supabase <code>: <body>` |
| `500` Internal Server Error | id generation / marshal failure | `<err>` |
| `503` Service Unavailable | Sharing not configured (missing env) | `sharing not configured: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY` |

Upstream Supabase call timeout is **8 seconds**.

### curl

```bash
curl -sS -X POST http://localhost:5174/api/share \
  -H 'content-type: application/json' \
  -d '{"payload":{"files":{"Chart.yaml":"apiVersion: v2\nname: hello\nversion: 0.1.0\n"},"releaseName":"demo","namespace":"default"}}'
```

---

## GET /api/share?id=&lt;id&gt;

Loads a previously shared payload by id. Reads via PostgREST
(`GET <SUPABASE_URL>/rest/v1/helm_playground_shares?id=eq.<id>&select=payload&limit=1`)
with `apikey` + `Authorization: Bearer` (the service-role key).

**Method**: `GET` (this section). See the method note above for `405`.

**Requires configuration**: same `503` behavior as POST when Supabase env is unset.

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
| `404` Not Found | No row for that id | `not found` |
| `502` Bad Gateway | Supabase unreachable / `>= 400` / decode failure | `supabase unreachable: <err>` |
| `500` Internal Server Error | Request construction failure | `<err>` |
| `503` Service Unavailable | Sharing not configured (missing env) | `sharing not configured: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY` |

### curl

```bash
curl -sS 'http://localhost:5174/api/share?id=abc23xyz'
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
curl -sS -X POST http://localhost:5174/api/import \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/charts/hello-0.1.0.tgz"}'

# Helm repo base URL (auto-picks the single chart, or 422 lists all)
curl -sS -X POST http://localhost:5174/api/import \
  -H 'content-type: application/json' \
  -d '{"url":"https://charts.example.com/"}'
```

---

## Catch-all

Any path other than the three above returns `404`. In local dev the body is
`{"error":"not found","path":"<requested-path>"}`.
