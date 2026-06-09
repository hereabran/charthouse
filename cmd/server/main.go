// Command server is the vendor-neutral, self-hostable Charthouse binary: it
// serves the three API handlers plus the built SPA (embedded at compile time),
// so a single static binary — or the Docker image — needs no external service.
package main

import (
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"strings"

	"charthouse"
	importchart "charthouse/api/import"
	"charthouse/api/render"
	"charthouse/api/share"
)

func main() {
	port := getenv("PORT", "8080")

	mux := http.NewServeMux()
	mux.HandleFunc("/api/render", render.Handler)
	mux.HandleFunc("/api/share", share.Handler)
	mux.HandleFunc("/api/import", importchart.Handler)

	sub, err := fs.Sub(charthouse.DistFS, "dist")
	if err != nil {
		log.Fatalf("embed dist: %v", err)
	}
	mux.Handle("/", spaHandler(sub))

	log.Printf("[charthouse] listening on http://localhost:%s (SHARE_STORE=%s)",
		port, getenv("SHARE_STORE", "memory"))
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// spaHandler serves embedded static assets and falls back to index.html for any
// unknown path, so client-side routes such as /s/<id> resolve in the SPA.
// Unmatched /api/* paths get a JSON 404 instead of HTML.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("content-type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}

		clean := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if clean == "" {
			serveIndex(w, fsys)
			return
		}

		f, err := fsys.Open(clean)
		if err != nil {
			serveIndex(w, fsys) // unknown path -> SPA route
			return
		}
		stat, statErr := f.Stat()
		f.Close()
		if statErr != nil || stat.IsDir() {
			serveIndex(w, fsys)
			return
		}

		if strings.HasPrefix(clean, "assets/") {
			w.Header().Set("cache-control", "public, max-age=31536000, immutable")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func serveIndex(w http.ResponseWriter, fsys fs.FS) {
	data, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		http.Error(w, "frontend not built — run `pnpm build`", http.StatusNotFound)
		return
	}
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.Header().Set("cache-control", "no-cache")
	_, _ = w.Write(data)
}
