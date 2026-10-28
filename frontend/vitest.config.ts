import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Unit tests for the dashboard's pure modules (src/lib, src/i18n). No DOM: components are checked in the browser.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
