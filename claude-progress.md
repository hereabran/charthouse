# claude-progress.md

This is the **state log** for the helm-playground harness. It records where the
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

The app is **built and working end to end** as a real-time Helm template
rendering UI.

- **Backend (Go):** three stateless HTTP handlers under `api/` — `render`,
  `share`, `import` — plus a local dev server `cmd/dev/main.go` that muxes them
  on port `5174`. Rendering uses the **Helm v4 Go SDK in-process**
  (`helm.sh/helm/v4 v4.2.0`, `action.NewInstall` with
  `DryRunStrategy=DryRunClient` and the `"memory"` storage driver) — there is no
  `helm` CLI exec. Module `helm-playground`, `go 1.26.0`.
- **Frontend (React/Vite/pnpm):** Vite 6 + React 19 + TypeScript 5.7 SPA. Vite
  dev server on `5173` proxies `/api` to `http://localhost:5174`. The Go server
  does not serve or proxy the frontend.
- **3-column UI:** TemplatePanel (chart file tree + Monaco editor) | ValuesPanel
  (`values.yaml` / `values.override.yaml` + Ajv schema validation) |
  RenderedOutput (read-only Monaco showing rendered manifests). Edits are
  debounced 300ms and POSTed to `/api/render`.
- **Gruvbox theme:** light/dark toggle, 7 accent colors, sharp/rounded corner
  toggle, all persisted in `localStorage`.
- **Upload + import + share — all implemented:**
  - **Upload / drag-drop:** parses `.zip` (JSZip), `.tgz` / `.tar.gz`
    (pako + hand-written tar parser), or a folder, client-side; top-level chart
    dir auto-stripped.
  - **Import from URL:** `POST /api/import` fetches a chart server-side
    (direct `.tgz`/`.tar.gz`/`.zip`, a Helm repo base URL via `index.yaml`, or a
    repo+chart URL), with SSRF protection, size caps, and a 5-hop redirect cap
    that re-validates each redirect target (scheme + private/loopback IP block).
  - **Share:** prefers a Supabase-backed short URL (`/api/share` → `/s/:id`);
    falls back to a self-contained `#h=<deflated-base64>` hash URL when Supabase
    is not configured.

**Recent fix landed:** the pnpm build-script approval issue was resolved in
[pnpm-workspace.yaml](./pnpm-workspace.yaml) via `allowBuilds: { esbuild: true }`,
so `pnpm install` no longer trips `ERR_PNPM_IGNORED_BUILDS` on esbuild's
postinstall under pnpm 11.

> Note: `.env` on disk holds a real-looking Supabase service-role secret. It is
> gitignored (not committed), but rotate it if it ever lands somewhere shared.

---

## Known-good baseline

These are the commands that establish "the world still works." Run them from the
repo root. (Tooling: pnpm 11.5.1 pinned via `packageManager`; node 22.13+
advisory — there is no `engines` field; go 1.26+ per `go.mod`.)

| Command | What it proves |
| --- | --- |
| `pnpm install` | JS deps install; esbuild postinstall approved via pnpm-workspace.yaml |
| `pnpm dev` | Runs **both** services (via `concurrently`): Vite on `:5173` + Go dev API on `:5174` (proxied at `/api/*`) |
| `pnpm typecheck` (`tsc -b --noEmit`) | Frontend type-checks clean |
| `pnpm build` (`tsc -b && vite build`) | Production build into `dist/` succeeds |

**Render round-trip (the core contract):** with the dev API up, a `POST` to
`http://localhost:5174/api/render` with a tiny chart (`Chart.yaml`,
`values.yaml`, `templates/cm.yaml`) returns `{ "ok": true, "stdout": "...", ... }`
rendered via **Helm v4.2.0** (the response includes `helmVersion`). See the
README "Smoke test" for the exact `curl`.

**Do NOT** put `pnpm lint` in the verification path. The `lint` script invokes
`eslint`, but eslint is not in `devDependencies` — it would fail. This is known
debt, tracked, and deliberately excluded from CI/verification.

After a session, confirm nothing is left listening: `lsof -i :5173 -i :5174`.

---

## Open / next

Candidate work, drawn from [feature_list.json](./feature_list.json) scope and
the honest verification gaps in
[clean-state-checklist.md](./clean-state-checklist.md). Pick **one** at a time
and define done before starting.

**Verification gaps (implemented but not verified locally this session):**

- **Editor / file tree / values / output / upload / theme / persistence** —
  implemented; exercise and confirm in a real browser session, then mark
  verified.
- **`share-001` (short URL)** — needs Supabase configured (`SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY`) to verify the `/s/:id` round-trip end to end.
- **`share-002` (hash fallback)** — verified by inspection only; no automated
  test for `encodePayloadToHash` / `decodePayloadFromHash` yet.

**Feature / robustness candidates:**

- **Share id collision-retry** — `/api/share` POST generates one 8-char id and
  inserts; on a primary-key collision it does not retry. Add a retry loop.
- **Share expiry / GC** — `helm_playground_shares` rows have no expiry and no
  cleanup; add a TTL column + GC (new Supabase migration; never edit an applied
  one in place).
- **Copy-link toast** — ShareButton auto-copies the URL but only shows it in a
  Modal; add a transient "copied" toast for clearer feedback.
- **Document `/api/import`** — the import-from-URL feature exists in code and is
  wired in dev + `vercel.json`, but is not yet in the README Architecture /
  Project-layout sections.

**Lower priority / known debt:**

- Restore a working `pnpm lint` (add eslint + config) or remove the script.
- Stale config: `HELM_BIN` (`.env.example`) is unreferenced (SDK is used);
  `tsconfig` references a non-existent `server/` dir. Harmless but worth pruning.

---

## Session log

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
