# Clean State Checklist

The end-of-session wrap-up. Run this before you commit so the repo is left
**clean and green**: verification passes, no stray build output or secrets are
staged, and the state-of-record docs match reality. Nothing is committed as
"done" that wasn't actually verified.

This is the last step of the session lifecycle. For where things stand and what
to pick up next, see [claude-progress.md](./claude-progress.md); for the project
map and conventions, see [CLAUDE.md](./CLAUDE.md).

## 1. Verification is green

Run the real commands from `package.json`. All must pass before you commit.

- [ ] `pnpm typecheck` (`tsc -b --noEmit`) passes.
- [ ] `pnpm build` (`tsc -b && vite build`) passes — produces `dist/`.
- [ ] Render smoke passes: with the dev API up (`pnpm dev:api`, port 5174),
      `POST /api/render` with a tiny chart (`Chart.yaml` + a template) returns
      `{ "ok": true, ... }`. See the README "Smoke test" for the exact `curl`
      against `http://localhost:5174/api/render`.
- [ ] Do **NOT** run `pnpm lint` as a gate — `eslint` is not in
      `devDependencies`, so the `lint` script fails. Known debt; keep it out of
      the verification path until eslint is actually installed.

If anything fails, fix it or record it honestly in
[claude-progress.md](./claude-progress.md) — do not commit a red tree and call
it done.

## 2. State of record is updated

- [ ] [claude-progress.md](./claude-progress.md) reflects what changed this
      session, what's verified, and the next step. No half-finished work is left
      undocumented.
- [ ] `feature_list.json` statuses match reality — passing only where actually
      verified this session; everything else `in_progress` / unverified. Honest
      baseline to mirror:
  - **passing**: `baseline-000` (typecheck + build green),
    `render-001` (live render, verified on Helm SDK v4.2.0).
  - **in_progress / unverified this session**: editor, tree, values, output,
    upload, theme, persistence.
  - **implemented but UNVERIFIED locally**: `share-001` (short URL needs
    Supabase configured), `share-002` (hash fallback, no automated test yet),
    `import-001` (import chart from URL via `/api/import` — present in code and
    wired in `cmd/dev/main.go` + `vercel.json`, but verify before marking
    passing).
- [ ] Never mark unverified work as done.

## 3. No stray files

The build, the TS incremental caches, and Supabase CLI state are all
`.gitignore`d (`dist`, `*.tsbuildinfo`, `.temp`, `.supabase`, `.vercel`) — but
confirm nothing slipped through.

- [ ] `git status` shows no `dist/`, `*.tsbuildinfo`, `.temp/`, or `.supabase/`
      staged. These are generated; they should never be committed.
- [ ] No scratch files, debug logs, or one-off test charts left in the tree.
- [ ] Public assets that belong in the repo live under `public/` — don't confuse
      them with build output in `dist/`.

## 4. Secrets are not staged

- [ ] `.env` is **not** tracked and **not** staged. Confirm with
      `git ls-files .env` (must print nothing) and `git status` (must not list
      `.env`). It is matched by `.gitignore` (`.env`, `.env.local`,
      `.env.*.local`), but the file on disk holds a **live Supabase
      service-role secret** — never let it reach git.
- [ ] Only `.env.example` (placeholders) is tracked.
- [ ] No `SUPABASE_SERVICE_ROLE_KEY`, Supabase URL, or other secret is pasted
      into committed source, docs, or `vercel.json`. Server secrets
      (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are configured in the Vercel
      dashboard, not in the repo.

## 5. Working tree is intentional

- [ ] `git status` and `git diff` show only changes you meant to make. Review the
      full diff before committing.
- [ ] Unrelated or experimental edits are reverted or split out — one coherent
      change per commit.
- [ ] If you touched the shares table, you added a **new** migration
      (`supabase migration new <name>` under `supabase/migrations/`) rather than
      editing a previously-applied one. Schema lives in
      `supabase/migrations/`; never rewrite applied migrations in place.

## 6. No stray processes

- [ ] No background dev servers still listening on ports **5173** (Vite) or
      **5174** (Go dev API). Check with `lsof -i :5173 -i :5174` and kill
      anything left over (e.g. a detached `pnpm dev`, which runs both via
      `concurrently -k`).

## 7. Server-side is clean

- [ ] Charts are client-only — `localStorage` keys `hp:chart` (chart),
      `hp:theme` / `hp:accent` (theme), `hp:border` (corners),
      `hp:layout:weights` (column widths). Nothing chart-related is persisted
      server-side, so there's nothing to clean there.
- [ ] If Supabase sharing was exercised, remember rows in
      `charthouse_shares` have no expiry/GC. Local dev runs without Supabase
      by default (Share falls back to `#h=` hash URLs), so usually nothing was
      written.

## Handoff

- [ ] Verification is green, the tree is intentional, secrets are out, and
      [claude-progress.md](./claude-progress.md) + `feature_list.json` tell the
      truth. The next session can continue without manual repair.
