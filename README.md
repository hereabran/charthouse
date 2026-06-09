# Charthouse

⎈ A realtime Helm chart playground: render templates live, explore resource
topology, and share charts — self-hostable and vendor-neutral.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## What & why

Charthouse is a browser-based playground for Helm charts. Edit chart files on the
left, tweak `values.yaml` in the middle, and watch the rendered Kubernetes
manifests update live on the right — no cluster, no `helm` binary, and nothing
stored server-side. Rendering happens in-process through the Helm Go SDK, so
results match what `helm template` would produce. It's built to be easy to
self-host: a single Go binary (with the UI embedded) or a one-command Docker
container, with no required external services.

## Screenshots

![Realtime render — three-column editor](./docs/screenshot-render.png)

![Resource topology graph](./docs/screenshot-topology.png)

> These images are placeholders and still need to be added.

## Features

- **3-column realtime render** — file tree + editor, values + override, and live
  rendered output, updating as you type.
- **Two editing modes** — full **Chart mode** (a real chart with a file tree) and
  a lightweight **Single-file mode** for one template against one set of values.
- **Interactive resource topology** — render manifests into a Kubernetes resource
  graph and click any node to inspect its rendered YAML.
- **Bring your own chart** — upload a chart as a folder, `.zip`, or `.tgz`.
- **Import from a URL** — pull a chart straight from a direct archive link or a
  Helm repo.
- **Values + override with schema validation** — `values.yaml` plus a separate
  `values.override.yaml` (applied on top), with inline JSON-schema validation
  when `values.schema.json` is present.
- **Shareable links** — one click reproduces the exact chart, release name, and
  namespace.
- **Gruvbox theme** — light/dark toggle, accent colors, and rounded/sharp corners.
- **Ephemeral by design** — no accounts and nothing persisted server-side, except
  opt-in shared links.

## Quickstart

### Docker (recommended)

```sh
docker compose up --build
```

Then open <http://localhost:8080>.

### Run from source (local dev)

Prerequisites: Node 22+, pnpm, and Go 1.26+. The Helm CLI is **not** required —
rendering uses the Helm Go SDK in-process.

```sh
pnpm install
pnpm dev
```

Then open <http://localhost:5173>.

`pnpm dev` runs the Vite frontend (port 5173) and the Go dev API (port 5174)
together; Vite proxies `/api/*` to the dev API.

## Self-hosting as a single binary

The production server embeds the built UI at compile time and serves the SPA plus
all API routes from one binary. Build the UI first, then build and run the binary:

```sh
pnpm build
go build -o charthouse ./cmd/server
./charthouse
```

The server listens on <http://localhost:8080>.

## Configuration

All configuration is via environment variables; every value is optional.

| Variable                    | Default          | Meaning                                                                 |
| --------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `PORT`                      | `8080`           | HTTP port for the self-hosted server (`cmd/server`).                    |
| `SHARE_STORE`               | `memory`         | Share-link backend: `memory`, `file`, or `supabase`.                    |
| `SHARE_DIR`                 | `./data/shares`  | Directory for the `file` store (used only when `SHARE_STORE=file`).     |
| `SUPABASE_URL`              | _(unset)_        | Supabase project URL (used only when `SHARE_STORE=supabase`).           |
| `SUPABASE_SERVICE_ROLE_KEY` | _(unset)_        | Supabase service-role key — **server-only**, never expose to the browser. |

The `memory` store is ephemeral (links are lost on restart); the `file` and
`supabase` stores are durable. The service-role key is a server-only secret —
keep it out of the client bundle and out of version control.

## How sharing works

The Share button always produces a URL that reproduces the current chart, release
name, and namespace. When a share store is configured (or the default `memory`
store is active), the payload is saved and you get a short `/s/<id>` link. If
sharing is unavailable (for example, `SHARE_STORE=supabase` without its
credentials), Charthouse falls back to encoding the whole chart in a `#h=` URL
hash — a longer link that needs no backend at all.

## Deployment options

- **Docker / Compose (recommended)** — `docker compose up --build`. The bundled
  compose file uses the durable `file` store with a named volume.
- **Single binary** — `pnpm build && go build -o charthouse ./cmd/server`, then
  run `./charthouse`. The binary serves the embedded UI and all API routes.
- **Vercel + Supabase (optional)** — set `SHARE_STORE=supabase`, provide the two
  Supabase variables, and apply the migration in `supabase/migrations/`.

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for details.

## Tech stack

| Layer      | Tools                                            |
| ---------- | ------------------------------------------------ |
| Frontend   | React 19, Vite, TypeScript                       |
| Styling    | Tailwind CSS (Gruvbox theme)                     |
| Editor     | Monaco                                            |
| Topology   | React Flow                                        |
| Backend    | Go                                               |
| Rendering  | Helm v4 Go SDK (in-process)                      |
| Tooling    | pnpm                                             |

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how the frontend, dev server,
  and Go handlers fit together; the render pipeline and data flow.
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — local setup, scripts, ports, and
  conventions.
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — Docker, the single binary, and the
  optional Vercel + Supabase path.
- [docs/API.md](./docs/API.md) — the `/api/render`, `/api/share`, and
  `/api/import` HTTP contracts, limits, and status codes.
- **For AI agents:** start with [CLAUDE.md](./CLAUDE.md) — the agent-facing map of
  the repo, verification commands, and workflow.

## Contributing

Contributions are welcome. Before opening a pull request, please run the
verification commands:

```sh
pnpm typecheck && pnpm test && pnpm build
go build ./... && go vet ./...
```

Note: ESLint is referenced by the `lint` script but is not yet wired into
`devDependencies`, so `pnpm lint` does not currently run — treat it as known debt
rather than a runnable check.

## License

Charthouse is released under the [MIT License](./LICENSE).

## Acknowledgements

Charthouse is built on [Helm](https://helm.sh) and the broader Kubernetes
ecosystem. "Helm" and "Kubernetes" are trademarks of their respective owners;
they are used here nominatively only. Charthouse is an independent, community
project and is not affiliated with, sponsored by, or endorsed by the Linux
Foundation, the CNCF, or the Helm or Kubernetes projects.
