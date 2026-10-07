import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

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
        "/api": "http://localhost:8787",
        "/smtp-config": "http://localhost:8787",
        "/api-keys": "http://localhost:8787",
        "/email-logs": "http://localhost:8787",
        "/dashboard/stats": "http://localhost:8787",
        "/dashboard/by-config": "http://localhost:8787",
        "/dashboard/recent": "http://localhost:8787",
        "/dashboard/errors": "http://localhost:8787",
      },
    },
  },
});
