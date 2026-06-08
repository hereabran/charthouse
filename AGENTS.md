# AGENTS.md

helm-playground: a real-time Helm template rendering UI (Vite + React + TypeScript
frontend; Go serverless handlers under `api/` rendering charts in-process via the
Helm v4 Go SDK).

This file is a short, tool-agnostic pointer for any coding agent. The **canonical,
full agent instructions live in [CLAUDE.md](./CLAUDE.md)** — read it first.

## Critical rules (read before doing anything)

1. **Run `./init.sh` first.** It sets up the environment and prints the current
   state. Do not start work until it has run.
2. **Read [claude-progress.md](./claude-progress.md) and [feature_list.json](./feature_list.json)**
   before writing code. They hold the state-of-record and the scoped work.
3. **One feature at a time.** Pick a single feature from `feature_list.json`, meet
   its explicit definition of done, then stop — do not bundle unrelated changes.
4. **Verify before commit.** Run `pnpm typecheck` and `pnpm build`; confirm the
   render smoke test returns `ok: true`. Do NOT add `pnpm lint` to verification —
   the `lint` script exists but eslint is not installed, so it fails (known debt).
   Commit only when the user asks.

## Local dev (quick reference)

- `pnpm install` then `pnpm dev` — Vite frontend on `:5173`, Go dev API on `:5174`
  (Vite proxies `/api/*` to it). Endpoints: `/api/render`, `/api/share`, `/api/import`.

## Docs

- [CLAUDE.md](./CLAUDE.md) — full agent manual (start here)
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — setup, architecture, verification details
- [feature_list.json](./feature_list.json) — scope: features + definitions of done
- [claude-progress.md](./claude-progress.md) — current state-of-record
- [clean-state-checklist.md](./clean-state-checklist.md) — end-of-session clean-state checklist
- [README.md](./README.md) — human-facing overview
