# syntax=docker/dockerfile:1
#
# Charthouse — single self-contained image: the Go server embeds the built SPA,
# so there is no separate web server and no external dependency to run it.

# ---- 1. build the frontend (Vite -> dist/) ----
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- 2. build the static Go binary (embeds dist/ via cmd/server) ----
FROM golang:1.26-alpine AS api
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Bring in the freshly built SPA so //go:embed all:dist picks up real assets.
COPY --from=web /app/dist ./dist
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/charthouse ./cmd/server
# Pre-create the share dir owned by the runtime user, so a mounted named volume
# inherits nonroot ownership and the file store can write to it.
RUN mkdir -p /data/shares

# ---- 3. minimal runtime (static distroless, nonroot) ----
FROM gcr.io/distroless/static-debian12:nonroot AS run
COPY --from=api /out/charthouse /charthouse
COPY --from=api --chown=65532:65532 /data /data
# Defaults suit `docker run`; docker-compose overrides SHARE_STORE to "file".
ENV PORT=8080 \
    SHARE_STORE=memory \
    SHARE_DIR=/data/shares
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/charthouse"]
