// Package charthouse (the module root) embeds the built single-page app so the
// self-hosted server (cmd/server) can serve the whole product from one binary.
//
// Embed directives are relative to the file's directory and cannot reference
// parents, so this lives at the repo root next to dist/. The all: prefix
// includes dist/.gitkeep, letting this compile before `pnpm build` runs.
package charthouse

import "embed"

//go:embed all:dist
var DistFS embed.FS
