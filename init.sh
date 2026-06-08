#!/usr/bin/env bash
#
# init.sh — environment health check + bootstrap for helm-playground.
#
# Session Lifecycle step: INIT. Run this once at the start of a session to
# confirm the toolchain is present, install JS dependencies, and print how to
# start the dev servers. Idempotent and safe to re-run — it only reports state
# and runs `pnpm install` (which is itself idempotent). It does NOT delete,
# overwrite, or reset anything.
#
# Usage:
#   bash init.sh        # or: ./init.sh   (after: chmod +x init.sh)

set -euo pipefail

# --- locate repo root (the dir this script lives in) ------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR"

# --- pretty output ----------------------------------------------------------
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"
  GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"; CYAN="$(printf '\033[36m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi

ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
err()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; }
note() { printf '    %s%s%s\n' "$DIM" "$1" "$RESET"; }

MISSING=0

# Report a REQUIRED tool: prints version or records a failure.
require() {
  # $1 = command, $2 = version flag, $3 = human hint on how to install
  local cmd="$1" flag="$2" hint="$3" ver
  if command -v "$cmd" >/dev/null 2>&1; then
    ver="$("$cmd" "$flag" 2>&1 | head -n 1)"
    ok "$cmd  ${DIM}${ver}${RESET}"
  else
    err "$cmd not found — $hint"
    MISSING=1
  fi
}

# Report an OPTIONAL tool: prints version or a soft note (never fails).
optional() {
  # $1 = command, $2 = version flag, $3 = why it's optional
  local cmd="$1" flag="$2" why="$3" ver
  if command -v "$cmd" >/dev/null 2>&1; then
    ver="$("$cmd" "$flag" 2>&1 | head -n 1)"
    ok "$cmd  ${DIM}${ver}${RESET}"
  else
    warn "$cmd not found (optional) — $why"
  fi
}

# --- banner -----------------------------------------------------------------
printf '\n%shelm-playground — environment check%s\n' "$BOLD" "$RESET"
printf '%sreal-time Helm template rendering UI%s\n\n' "$DIM" "$RESET"

# --- required tools ---------------------------------------------------------
printf '%sRequired tools%s\n' "$BOLD" "$RESET"
require node "--version" "install Node 22.13+ (https://nodejs.org)"
require pnpm "--version" "enable via corepack: 'corepack enable && corepack prepare pnpm@11.5.1 --activate' (or https://pnpm.io)"
require go   "version"   "install Go 1.26+ (https://go.dev/dl) — needed for the /api render backend"

# --- optional tools ---------------------------------------------------------
printf '\n%sOptional tools%s\n' "$BOLD" "$RESET"
# NOTE: the render backend uses the Helm Go SDK (helm.sh/helm/v4) IN-PROCESS,
# so a `helm` CLI binary is NOT required to run this app. It's only handy for
# packaging/inspecting charts locally.
optional helm "version" "render uses the Helm Go SDK in-process; CLI not required"
optional supabase "--version" "only needed to deploy/manage the share store (sharing falls back to URL-hash payloads without it)"

# --- bail out if a required tool is missing ---------------------------------
if [ "$MISSING" -ne 0 ]; then
  printf '\n%sMissing required tooling — install the items marked ✗ above, then re-run this script.%s\n\n' "$RED" "$RESET"
  exit 1
fi

# --- install JS dependencies (idempotent) -----------------------------------
printf '\n%sInstalling JS dependencies%s\n' "$BOLD" "$RESET"
note "running: pnpm install"
pnpm install
ok "dependencies installed"

# --- next steps -------------------------------------------------------------
printf '\n%sNext steps%s\n' "$BOLD" "$RESET"

# Sharing via Supabase is OPTIONAL. We only point at .env.example; we never
# overwrite an existing .env and never write secrets.
if [ -f .env ]; then
  ok ".env present (sharing config picked up by the dev API)"
elif [ -f .env.example ]; then
  warn "no .env yet — sharing is optional (Share falls back to URL-hash payloads)"
  note "to enable Supabase-backed short URLs: cp .env.example .env  then fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
else
  note "(no .env.example found — sharing config is optional)"
fi

printf '\n%sStart the dev servers:%s\n' "$BOLD" "$RESET"
printf '  %spnpm dev%s\n' "$CYAN" "$RESET"
note "Vite frontend -> http://localhost:5173   (proxies /api to the Go dev server)"
note "Go dev API    -> http://localhost:5174   (/api/render, /api/share, /api/import)"
note "open http://localhost:5173 — the sample chart renders immediately"

printf '\n%sEnvironment ready.%s\n\n' "$GREEN" "$RESET"
