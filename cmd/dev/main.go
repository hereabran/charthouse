package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	importchart "helm-playground/api/import"
	"helm-playground/api/render"
	"helm-playground/api/share"
)

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "5174"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/render", render.Handler)
	mux.HandleFunc("/api/share", share.Handler)
	mux.HandleFunc("/api/import", importchart.Handler)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": "not found",
			"path":  r.URL.Path,
		})
	})

	log.Printf("[helm-playground] dev API listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
