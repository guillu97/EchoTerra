import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies API calls to the Go backend so the client can use
// relative URLs (no CORS juggling during development).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
