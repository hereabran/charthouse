# Clean State Checklist

Run through this before ending a session. The goal: the next session can pick up
without manual repair, and nothing is presented as done that wasn't verified.

## Startup still works

- [ ] `pnpm install` then `pnpm dev` boots cleanly (concurrently runs `dev:vite` + `dev:api`).
- [ ] Vite is reachable at `http://localhost:5173`; the Go dev API answers at `http://localhost:5174` (proxied at `/api/*`).
- [ ] Opening `http://localhost:5173` renders the sample chart immediately.
- [ ] Go is installed locally — the entire API (render + share) is Go; render uses the Helm Go SDK, share talks to Supabase via PostgREST.

## Verification still runs

- [ ] `pnpm typecheck` (`tsc -b --noEmit`) passes.
- [ ] `pnpm build` (`tsc -b && vite build`) passes.
- [ ] Render smoke passes: with the dev API up, `POST /api/render` with a tiny chart returns `ok: true`.
      (See README "Smoke test", or the `curl` against `http://localhost:5174/api/render`.)
- [ ] Do NOT add `pnpm lint` to the verification path — eslint is not installed (the `lint` script would fail). Known debt.

## State of record is updated

- [ ] Current progress is recorded in the progress log.
- [ ] `feature_list` reflects what is actually passing versus unverified — mirror the honest statuses:
  - passing: `baseline-000` (typecheck + build green), `render-001` (live render, verified on Helm SDK v4.2.0).
  - in_progress / unverified-this-session: editor, tree, values, output, upload, theme, persistence.
  - implemented but UNVERIFIED locally: `share-001` (short URL needs Supabase configured), `share-002` (hash fallback, no automated test yet).
- [ ] No half-finished step is left undocumented; never mark unverified work as done.

## Nothing to clean up server-side

- [ ] Charts are localStorage-only (`hp:chart`, plus `hp:theme`). No charts are persisted server-side, so there is nothing to clean there.
- [ ] If Supabase was exercised, remember short-share rows in `helm_playground_shares` have no expiry/GC — but local dev runs without Supabase by default, so usually nothing was written.
- [ ] Schema lives in `supabase/migrations/`. If you changed the shares table, add a new migration (`supabase migration new <name>`) and `supabase db push` against the linked project. Never edit a previously-applied migration in place.

## No stray processes left behind

- [ ] No background dev servers still listening on ports 5173 (Vite) or 5174 (Go dev API).
      Check: `lsof -i :5173 -i :5174` — kill anything left over (e.g. a detached `pnpm dev`).

## Handoff

- [ ] The next session can continue without manual repair.
