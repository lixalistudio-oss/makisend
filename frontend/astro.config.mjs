import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// Backend Worker URL. In Docker, compose sets BACKEND_URL=http://backend:8787;
// on the host, the default keeps working unchanged.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8787";

export default defineConfig({
  integrations: [react()],
  devToolbar: {
    enabled: false,
  },
  server: {
    port: 4321,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/api": backendUrl,
        "/smtp-config": backendUrl,
        "/api-keys": backendUrl,
        "/email-logs": backendUrl,
        "/templates": backendUrl,
        "/dashboard/stats": backendUrl,
        "/dashboard/by-config": backendUrl,
        "/dashboard/recent": backendUrl,
        "/dashboard/errors": backendUrl,
      },
    },
  },
});
