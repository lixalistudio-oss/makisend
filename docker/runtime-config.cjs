// Build step of docker/Dockerfile: derives the image's wrangler config from backend/wrangler.jsonc, so
// bindings, queues, workflow and crons never drift from production. The Worker is already bundled
// (`wrangler deploy --dry-run`), so the runtime config points at the bundle, with no bundling at start-up.
// Usage: node docker/runtime-config.cjs <backend dir> <out file>
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

/** JSONC to JSON: drops // and /* *\/ comments and trailing commas, leaving string contents alone. */
function stripJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const [backend, out] = process.argv.slice(2);
const parsedConfig = JSON.parse(stripJsonc(readFileSync(join(backend, "wrangler.jsonc"), "utf8")));

const { env: _preview, $schema: _schema, ...config } = parsedConfig;
config.main = "worker/index.js";
config.no_bundle = true;
config.assets = { ...config.assets, directory: "./assets" };
config.d1_databases = config.d1_databases.map((db) => ({ ...db, migrations_dir: "./drizzle" }));
// Cloudflare-only: tracing and log forwarding mean nothing under a local workerd.
delete config.observability;

writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
