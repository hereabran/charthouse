# claude-progress.md

This is the **state log** for the charthouse harness. It records where the
project actually is, what has been verified, and what to pick up next — so any
session (human or agent) can resume without re-deriving the state of the world.

This file is the source of truth for *progress*. For *how to work here* see
[CLAUDE.md](./CLAUDE.md); for *what to work on* (one feature at a time, with a
definition of done) see [feature_list.json](./feature_list.json).

## Update protocol

At the **end of every session**, append a dated entry to the
[Session log](#session-log) at the bottom of this file. Do not rewrite history;
only append. Each entry uses `YYYY-MM-DD` dates and covers:

- **Changed** — what you actually modified (files, behavior).
- **Verified** — what you ran and what passed (cite the real command + result).
  Never mark something done that you did not verify. "Implemented" and "verified"
  are different states — say which.
- **Left / next** — what is unfinished or untested, with enough detail to resume.
- **Handoff** — anything the next session needs to know (running processes, env,
  gotchas, decisions made).

Then refresh the [Current status](#current-status) snapshot below so the top of
this file always reflects the latest known-good state.

---

## Current status

**Charthouse** — a "Helm chart playground" — is **built and working end to end**
as a real-time Helm template rendering UI. (The name is nautical; "Helm" is a
trademark of the CNCF/Linux Foundation and is used nominatively only.) The
project was rebranded this cycle from `helm-playground` to `charthouse` and is
**MIT-licensed** (`LICENSE`: "Copyright (c) 2026 the Charthouse authors"). The Go
module is `charthouse` (`go.mod`), the npm package is `charthouse`
(`package.json`), and the toolbar wordmark is "⎈ Charthouse".

- **Backend (Go):** three stateless HTTP handlers under `api/` — `render`,
  `share`, `import`. Rendering uses the **Helm v4 Go SDK in-process**
  (`helm.sh/helm/v4 v4.2.0`, `action.NewInstall` with
  `DryRunStrategy=DryRunClient` and the `"memory"` storage driver) — there is no
  `helm` CLI exec. The render response includes `helmVersion` reported as
  e.g. `"v4.2.0 sdk"`. Module `charthouse`, `go 1.26.0`. Render limits: 5 MiB
  request body, 500 files, 256 KiB/file, 4 MiB total, 10s timeout.
- **Two servers:**
  - `cmd/dev/main.go` — dev-only, muxes the three handlers on port `5174`.
    Unchanged.
  - `cmd/server/main.go` — the **production single self-contained binary**. It
    serves `/api/render`, `/api/share`, `/api/import` **and** the built SPA,
    embedded at compile time via `//go:embed all:dist`. The embed lives in the
    repo-root package (`embed.go`, `package charthouse`) because `go:embed`
    cannot reference parent dirs. SPA fallback: unknown non-asset paths return
    `index.html` (so client routes like `/s/<id>` work); unmatched `/api/*`
    return JSON 404; `/assets/*` get a long immutable cache; HTML is no-cache.
    Binds `PORT` (default `8080`). Build order matters: `pnpm build` must run
    before `go build ./cmd/server` (the Dockerfile enforces this). `dist/` must
    exist for the embed to compile — `dist/.gitkeep` is committed and
    `.gitignore` un-ignores it (`!dist/.gitkeep`).
- **Frontend (React/Vite/pnpm):** Vite 6 + React 19 + TypeScript 5.7 SPA. In
  dev, Vite serves `:5173` and proxies `/api` to `http://localhost:5174`. In
  production, the embedded SPA is served by `cmd/server` on `:8080`.
- **Two editing modes (Chart | Single file):** the toolbar has a segmented
  toggle (`src/components/layout/Toolbar.tsx`); `chart-store`
  (`src/store/chart-store.ts`) tracks `mode` plus `singleTemplate` (the scratch
  template), persisted in `localStorage` key `hp:chart`. **Values
  (`values.yaml` / `values.override.yaml`) are shared across both modes via
  `files`** — single mode owns only its template, so switching modes never
  overwrites or loses values (`ValuesPanel` is mode-agnostic). `buildRenderFiles`
  wraps **single** mode into a synthesized minimal chart (`Chart.yaml` +
  `templates/template.yaml` = `singleTemplate` + the shared `values.yaml`/override
  from `files`); **chart** mode passes files through unchanged. The left column
  swaps TemplatePanel (chart) vs `SingleTemplatePanel` (single). Share round-trips
  the mode (`SharePayload` gained optional `mode` + `single{template}`; values
  travel in `files`; legacy shares with no `mode` load as chart).
- **3-column UI:** Template (chart file tree + Monaco, or single-template editor)
  | Values (`values.yaml` / `values.override.yaml` + Ajv schema validation) |
  RenderedOutput (read-only Monaco showing rendered manifests). Edits are
  debounced 300ms and POSTed to `/api/render`.
- **Resource topology viewer:** a pure-TS engine under `src/lib/topology/`
  (`types`, `parse`, `infer`, `index`). `buildTopology(stdout, defaultNamespace)`
  parses the rendered multi-doc YAML (js-yaml) and infers relationships from the
  manifests **with no cluster** — Service→workload (selector), Ingress→Service /
  Ingress→Secret (tls), workload→ConfigMap/Secret/ServiceAccount/PVC, HPA→workload,
  PDB/NetworkPolicy→workload, RoleBinding/ClusterRoleBinding→ServiceAccount+Role,
  and `ownerReferences`. Dangling refs become faded "external" nodes; output is
  deterministic. The UI (`src/components/topology/`: TopologyModal, TopologyGraph,
  ResourceNode, ResourcePanel + `layout.ts` dagre top-down + `groupTheme.ts`)
  uses React Flow (`@xyflow/react` v12) + dagre, opens as a full-window overlay
  from a "topology" button in the RenderedOutput header (disabled at 0 docs),
  and shows a clicked node's rendered YAML in a read-only Monaco side panel. The
  modal is `lazy()`-loaded behind `Suspense` so React Flow/dagre stay in a
  separate chunk.
- **Pluggable share store (vendor-neutral):** `api/share/store/`
  (`store.go`, `memory.go`, `file.go`, `supabase.go`). `store.New()` reads
  `SHARE_STORE` = `memory` | `file` | `supabase` (**default `memory`**).
  `memory` = in-process (ephemeral, links lost on restart); `file` = atomic JSON
  files under `SHARE_DIR` (default `./data/shares`), durable; `supabase` =
  PostgREST table `charthouse_shares` via the service-role key. Shared
  constants: 8-char ids over `23456789abcdefghjkmnpqrstuvwxyz`, `IDPattern`
  `^[a-z0-9]{6,16}$`, `MaxPayloadBytes` 256 KiB. `api/share/index.go` uses the
  store via `sync.Once`: `GET ?id` → 200 `{id,payload}` / 404 / 502;
  `POST {payload}` → 200 `{id}`. It returns **503 only on explicit
  misconfiguration** (e.g. `SHARE_STORE=supabase` with missing
  `SUPABASE_URL`/key, or an unknown `SHARE_STORE`). With the default memory
  store, short links work out of the box; the SPA's `#h=` hash fallback
  (`src/lib/share-client.ts`) now only triggers on that rare 503.
- **Docker / self-host (primary path):** multi-stage `Dockerfile`
  (`node:22-alpine` + `pnpm build` → `golang:1.26-alpine` `CGO_ENABLED=0` build
  embedding `dist` → `gcr.io/distroless/static-debian12:nonroot`, `EXPOSE 8080`,
  `ENV PORT=8080 SHARE_STORE=memory SHARE_DIR=/data/shares`, runs as nonroot).
  `.dockerignore` present. `docker-compose.yaml`: one service `charthouse`,
  `build .`, ports `8080:8080`, `SHARE_STORE=file` + `SHARE_DIR=/data/shares` +
  named volume `charthouse-data:/data` for durable links (commented Supabase
  passthrough).
- **Vercel/Supabase still work, but are now OPTIONAL:** `vercel.json` unchanged
  (rewrites `/s/:id` → `/`, declares the three Go functions); `api/*/index.go`
  `Handler` exports unchanged; Supabase is just `SHARE_STORE=supabase` + the
  migration under `supabase/migrations/` (table `charthouse_shares`).
- **Gruvbox theme:** light/dark toggle, accent colors, sharp/rounded corner
  toggle, and a **CRT scanlines** toggle (`src/store/crt-store.ts` → `html.crt`;
  a fixed, click-through `body::after` overlay in `globals.css` with scanlines +
  faint RGB grille + slow flicker, flicker disabled under
  `prefers-reduced-motion`). All persisted in `localStorage`
  (`hp:theme`/`hp:accent`/`hp:border`/`hp:crt`) and applied pre-paint from
  `index.html` to avoid a flash.
- **Mobile / responsive:** the whole UI works down to ~360px and on touch. The
  Toolbar wraps and its buttons + mode toggle go icon-only below `sm`; below
  `lg` the 3-pane body becomes a **tabbed single-panel view** (Chart/Template ·
  Values · Rendered) so Monaco gets full height. Hover-only affordances have
  touch paths (file-tree row actions forced visible under `@media (hover:none)`;
  Upload menu closes on outside tap). The topology overlay shows a selected node
  in a dismissible bottom sheet below `lg` (the desktop side panel is hidden),
  legend hidden below `md`, minimap hidden ≤640px.
- **Upload + import + share:**
  - **Upload / drag-drop:** parses `.zip` (JSZip), `.tgz` / `.tar.gz`
    (pako + hand-written tar parser), or a folder, client-side; top-level chart
    dir auto-stripped.
  - **Import from URL:** `POST /api/import` fetches a chart server-side
    (direct `.tgz`/`.tar.gz`/`.zip`, a Helm repo base URL via `index.yaml`, or a
    repo+chart URL), with SSRF protection, size caps, and a 5-hop redirect cap
    that re-validates each redirect target (scheme + private/loopback IP block).
  - **Share:** prefers a store-backed short URL (`/api/share` → `/s/:id`); falls
    back to a self-contained `#h=<deflated-base64>` hash URL only on a 503.
- **Docs:** a public `README.md` (titled "Charthouse") plus a synced `docs/`
  set — `API.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `DEVELOPMENT.md`.
- **Tests:** `src/lib/topology/infer.test.ts` (Vitest, 10 passing). Script
  `pnpm test` runs `vitest run`.

> Note: `.env` on disk holds a real-looking Supabase service-role secret. It is
> gitignored (not committed), but rotate it if it ever lands somewhere shared.
> `HELM_BIN` has been removed from `.env.example` (the SDK is used; no CLI).

---

## Known-good baseline

These are the commands that establish "the world still works." Run them from the
repo root. (Tooling: pnpm `11.5.1` pinned via `packageManager`; node 22+; go
1.26+ per `go.mod`. The Helm CLI is **not** required — render uses the SDK.)

| Command | What it proves |
| --- | --- |
| `pnpm install` | JS deps install; esbuild postinstall approved via pnpm-workspace.yaml |
| `pnpm dev` | Runs **both** dev services (via `concurrently`): Vite on `:5173` + Go dev API on `:5174` (proxied at `/api/*`) |
| `pnpm typecheck` (`tsc -b --noEmit`) | Frontend type-checks clean |
| `pnpm test` (`vitest run`) | Topology inference unit tests pass (10/10) |
| `pnpm build` (`tsc -b && vite build`) | Production build into `dist/` succeeds (topology lazy-split into its own chunk) |
| `pnpm serve` (`go run ./cmd/server`) | Production single binary serves the embedded SPA + API on `:8080` |
| `go build ./...` / `go vet ./...` | Go compiles and vets clean |

**Render round-trip (the core contract):** a `POST` to `/api/render` with a tiny
chart returns `{ "ok": true, "stdout": "...", ... }` rendered via **Helm
v4.2.0** (the response includes `helmVersion` = `"v4.2.0 sdk"`). Against the dev
API this is `http://localhost:5174/api/render`; against the production server it
is `http://localhost:8080/api/render`. See the README "Smoke test" for the exact
`curl`.

**Share round-trip:** with `SHARE_STORE=memory` (default) or `file`, `POST
/api/share` returns `{id}` and `GET /api/share?id=…` returns the payload. The
file store survives a server restart; memory does not.

**Do NOT** put `pnpm lint` in the verification path. The `lint` script invokes
`eslint`, but eslint is **not** in `devDependencies` — `pnpm lint` currently
fails. This is known debt; do not present it as runnable.

**Docker note:** `docker build` / `docker compose up` are written but have **not
been run on the dev machine** (docker is not installed here). Treat the
Dockerfile/compose as implemented-but-unbuilt until someone with Docker verifies.

After a dev session, confirm nothing is left listening: `lsof -i :5173 -i :5174`
(and `:8080` if `pnpm serve` was used).

---

## Open / next

Candidate work, drawn from [feature_list.json](./feature_list.json) scope and
the honest verification gaps in
[clean-state-checklist.md](./clean-state-checklist.md). Pick **one** at a time
and define done before starting.

**Verification gaps (implemented but not verified this way):**

- **Docker image** — `docker build` and `docker compose up` were never run here
  (no docker on the dev machine). Build the image, hit `:8080`, and confirm the
  `file` store volume gives durable links.
- **Editor / file tree / values / output / upload / theme / persistence** and
  the **two-mode toggle** and **topology overlay** — exercise and confirm in a
  real browser session, then mark verified.
- **Supabase share backend (`SHARE_STORE=supabase`)** — exercised only by
  inspection; needs a real `SUPABASE_URL` + service-role key + the
  `charthouse_shares` migration to verify the `/s/:id` round-trip.

**Feature / robustness candidates:**

- **README screenshots** — the README is public but has no screenshots/GIFs of
  the UI, the two modes, or the topology viewer. Add some.
- **Restore a working `pnpm lint`** — add `eslint` + a flat config to
  `devDependencies` (or remove the dead `lint` script).
- **Share id collision-retry** — `/api/share` POST generates one id and inserts;
  on a collision it does not retry. Add a small retry loop (matters most for the
  `file` and `supabase` stores).
- **Share expiry / GC** — share entries (file + `charthouse_shares`) have no
  expiry and no cleanup; add a TTL + GC (for Supabase, a new migration — never
  edit an applied one in place).
- **Copy-link toast** — ShareButton auto-copies the URL but surfaces it in a
  Modal; a transient "copied" toast would be clearer.

---

## Session log

### 2026-06-24 — Mobile-responsive UI everywhere + CRT scanlines theme toggle

- **Changed:**
  - **CRT scanlines toggle.** New `src/store/crt-store.ts` (mirrors
    `border-store`: boolean → `html.crt`, persists `hp:crt`). Added the effect to
    `src/styles/globals.css` as a fixed, `pointer-events:none`
    `html.crt body::after` overlay (scanlines + faint RGB aperture grille + a
    slow `ch-crt-flicker`), `z-index` above modals/splash; flicker disabled under
    `prefers-reduced-motion`. Wired a "CRT lines on/off" entry (ScanLine icon)
    into `ThemeButton`. `index.html` pre-paint now also applies `sharp` + `crt`
    classes (no flash) and the viewport meta gained `viewport-fit=cover`.
  - **Mobile-responsive across every surface.**
    - `ThreeColumnLayout`: below `lg`, the tall vertical stack is replaced by a
      **tabbed single-panel view** (tab bar Chart/Template · Values · Rendered;
      one full-height panel at a time) so Monaco gets real height. Desktop
      resizable grid unchanged. `App.tsx` passes mode-aware tab labels. A
      `useIsDesktop()` matchMedia hook (with a `window` `resize` fallback) gates
      the two layouts in JS so **only the active branch mounts** — each panel's
      Monaco editor exists once (was twice: both branches were CSS-toggled).
    - `Toolbar`: `flex-wrap`; action buttons + mode toggle collapse to icon-only
      below `sm`; release/namespace inputs shrink. No 360px overflow.
    - Touch fixes: file-tree row actions tagged `ch-row-actions` and forced
      visible under `@media (hover:none)`; `UploadButton` menu now closes on
      outside tap (was `onMouseLeave`-only).
    - `RenderedOutput` header compacts (topology label + helmVersion chip hidden
      below `sm`). `TopologyModal` shows a selected node in a dismissible bottom
      sheet below `lg` (desktop side panel hidden), legend hidden below `md`,
      React Flow minimap hidden ≤640px. `Modal` footer wraps. `SplashScreen`
      scrolls on short screens. Body gets `-webkit-tap-highlight-color:transparent`
      + `overscroll-behavior:none`.
  - Labels on `ImportButton` / `ShareButton` / `ThemeButton` hidden below `sm`
    (icon-only) for the compact mobile toolbar.
- **Verified (commands run this session, all passed):**
  - `pnpm typecheck` → 0 errors. `pnpm test` → 10/10. `pnpm build` → OK
    (topology still split into its own lazy chunk).
  - `go build ./...` / `go vet ./...` → clean.
  - **Browser (cmd/server embedded SPA via `pnpm serve`):** screenshotted at
    **375×812** — splash, tabbed editor (CHART), live-rendered output (Service +
    Deployment via Helm v4.2.0 SDK), topology graph + the new node bottom sheet —
    and at **1280×820** confirming the desktop resizable 3-column grid is
    unregressed. Toggled **CRT on** (visible scanlines, `html` class `dark crt`,
    `hp:crt=crt`) and off. No console errors. Confirmed the built CSS contains
    the `@media (hover:none) .ch-row-actions`, `html.crt body::after`, and
    `ch-crt-flicker` rules.
  - An adversarial multi-agent review workflow swept all surfaces for missed
    mobile/CRT cases and desktop regressions; it confirmed 3 findings, all
    fixed: (a) file-tree row-action icon buttons had ~12px tap targets — added
    `.ch-icon-btn` (≥28px hit box under `@media (hover:none)`); (b) accent
    swatches were 20px — bumped to 24px (`w-6 h-6`) in a wider menu; (c) the two
    layout branches both mounted, doubling Monaco to 6 editors — fixed via the
    `useIsDesktop` JS gate. Re-verified live: `monaco.editor.getEditors().length`
    is now 3 at both 375px (tabbed) and 1280px (grid).
- **Left / next:** Real-device touch pass (the preview is a desktop browser, so
  `@media (hover:none)` and pinch-zoom on the topology canvas were verified by
  rule-presence + emulation, not on hardware). Docker image still unbuilt here.
- **Handoff:** Theme/border/CRT all live in tiny zustand stores applied via
  `html` classes and pre-painted from `index.html`; add future toggles the same
  way. The mobile/desktop layout split keys off Tailwind `lg` (1024px) via a
  `useIsDesktop()` matchMedia hook in `ThreeColumnLayout` — only the active
  branch mounts (so each panel/Monaco editor exists once). If you add a third
  layout, gate it through the same hook rather than CSS `hidden` toggles, or
  you'll re-introduce duplicate editors.

### 2026-06-09 — Charthouse: rebrand, two modes, topology viewer, single-binary server + pluggable shares + Docker

- **Changed:**
  - **Rebrand → Charthouse (MIT).** Renamed the project end to end: `go.mod`
    module `charthouse`, `package.json` name `charthouse`, `index.html` title and
    toolbar wordmark ("⎈ Charthouse"), and a new MIT `LICENSE`
    ("Copyright (c) 2026 the Charthouse authors").
  - **Two editing modes.** Added a "Chart | Single file" toggle
    (`Toolbar.tsx`); extended `chart-store.ts` with `mode` + single-file state
    and `buildRenderFiles()` that synthesizes a minimal chart for single mode;
    added `SingleTemplatePanel.tsx`; made ValuesPanel mode-aware; extended
    `SharePayload` (`types/chart.ts`) to round-trip the mode (legacy shares load
    as chart).
  - **Resource topology viewer.** New pure-TS engine `src/lib/topology/`
    (`types`/`parse`/`infer`/`index`) + UI `src/components/topology/`
    (TopologyModal/TopologyGraph/ResourceNode/ResourcePanel + `layout.ts` dagre +
    `groupTheme.ts`), using React Flow + dagre, triggered from RenderedOutput and
    lazy-loaded behind Suspense. Added `infer.test.ts`.
  - **Vendor-neutral backend.** Refactored `/api/share` onto a pluggable store
    (`api/share/store/{store,memory,file,supabase}.go`) selected by `SHARE_STORE`
    (default `memory`); `api/share/index.go` now uses it via `sync.Once` and only
    503s on explicit misconfiguration.
  - **Single self-contained server + embed.** Added `cmd/server/main.go` (serves
    API + embedded SPA on `PORT`/8080, SPA fallback for `/s/:id`) and `embed.go`
    at the repo root (`//go:embed all:dist`); committed `dist/.gitkeep` and the
    `.gitignore` un-ignore so the embed compiles. `cmd/dev/main.go` unchanged.
  - **Docker.** Added a multi-stage `Dockerfile` (node build → go embed build →
    distroless nonroot), `.dockerignore`, and `docker-compose.yaml` (file store +
    named volume for durable links). Vercel/Supabase paths kept working as
    optional.
  - **Config / scripts / docs.** Removed dead `HELM_BIN` from `.env.example` and
    documented `PORT` / `SHARE_STORE` / `SHARE_DIR` / `SUPABASE_*`; added
    `serve` (`go run ./cmd/server`) and `test` (`vitest run`) scripts; published
    a public README and synced `docs/` (API/ARCHITECTURE/DEPLOYMENT/DEVELOPMENT).
- **Verified (commands run this session, all passed):**
  - `pnpm typecheck` → 0 errors.
  - `pnpm test` → 10/10 passing (topology inference).
  - `pnpm build` → OK; the topology code split into its own lazy chunk.
  - `go build ./...` and `go vet ./...` → OK.
  - `cmd/server` smoke → embedded SPA served at `/`; unknown route `/s/:id`
    falls back to `index.html`; unmatched `/api/*` returns JSON 404; render
    works (`helmVersion` `"v4.2.0 sdk"`); share round-trip works on the
    **memory** store **and** on the **file** store, where links survived a
    server restart.
- **Not verified this session:** **Docker** — `docker build` /
  `docker compose up` were not run (docker is not installed on the dev machine).
  The Dockerfile and compose file are written but **unbuilt** here. The
  **Supabase** share backend was only inspected, not exercised against a real
  project.
- **Left / next:** Build and run the Docker image; browser-verify the UI
  (two-mode toggle, topology overlay, editor/values/upload/theme/persistence);
  verify the Supabase share backend with real credentials; add README
  screenshots; restore a working `pnpm lint`. See [Open / next](#open--next).
- **Handoff:** Default share backend is `memory` (zero-config, ephemeral); use
  `SHARE_STORE=file` (with `SHARE_DIR`) or compose for durable links. The
  production server is `cmd/server` on `:8080`; the dev server is `cmd/dev` on
  `:5174` (Vite `:5173` proxies `/api`). `pnpm build` MUST precede
  `go build ./cmd/server` (the embed needs a populated `dist/`). `pnpm lint`
  still fails (eslint missing) — keep it out of the verify path.

### 2026-06-09 — Harness bootstrap + pnpm build fix

- **Changed:** Generated the harness/state docs for this repo — the
  Instructions/State/Scope subsystems (CLAUDE.md, this claude-progress.md,
  feature_list.json) alongside the existing
  [clean-state-checklist.md](./clean-state-checklist.md) and README. Confirmed
  the pnpm build-script approval fix is in place in
  [pnpm-workspace.yaml](./pnpm-workspace.yaml) (`allowBuilds: { esbuild: true }`),
  which silences `ERR_PNPM_IGNORED_BUILDS` for esbuild under pnpm 11.
- **Verified:** App is built and working per the verified codebase facts —
  Go backend renders via the Helm v4.2.0 SDK; the React/Vite/pnpm frontend,
  3-column UI, Gruvbox theme, and upload/import/share flows are all present in
  source. (Baseline `pnpm typecheck` / `pnpm build` and the render smoke are the
  designated verify commands; re-run them next session and record results here.)
- **Left / next:** Browser-level verification of editor/tree/values/output/
  upload/theme/persistence; Supabase-backed share (`share-001`) round-trip;
  automated coverage for the hash fallback (`share-002`). See
  [Open / next](#open--next).
- **Handoff:** No background processes started in this session. Sharing is
  unconfigured by default in local dev, so nothing is written to Supabase. The
  `/api/import` feature is real but undocumented in the README — fold it in when
  docs are refreshed.

### 2026-06-09 — Fix: single-mode clobbered chart values.yaml

- **Bug:** Switching Chart → Single overwrote `values.yaml`, and switching back
  did not restore it (same after import). Root cause: `ValuesPanel` stayed
  mounted across mode switches and drove one Monaco model (`path="values.yaml"`)
  from two different buffers (chart `files['values.yaml']` vs a separate
  `singleValues`), desyncing the controlled value so a later keystroke wrote the
  wrong buffer into `files`.
- **Fix:** Values are now **shared** across modes. Removed `singleValues` /
  `singleOverride` from `chart-store`; single mode keeps only `singleTemplate`.
  `ValuesPanel` reverted to mode-agnostic (always edits `files`).
  `buildRenderFiles` single mode reuses `files['values.yaml']` / override.
  `SharePayload.single` is now `{ template }` (values travel in `files`); old
  shares still load. Updated ARCHITECTURE/feature_list/this log to match.
- **Verified:** `pnpm typecheck` 0, `pnpm test` 10/10, `pnpm build` OK. Backwards
  compatible with persisted `hp:chart` and prior single-mode share links.
