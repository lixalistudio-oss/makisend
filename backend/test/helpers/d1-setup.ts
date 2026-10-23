import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

/**
 * Reads all Drizzle migration SQL files from the drizzle/ directory
 * and concatenates them into a single string. This way when you add
 * a new table and run `pnpm drizzle-kit generate`, the test helper
 * picks it up automatically — no manual SQL updates needed.
 */
function loadMigrationSql(): string {
  const migrationDir = join(import.meta.dirname, "../../drizzle");
  const files = readdirSync(migrationDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((f) => readFileSync(join(migrationDir, f), "utf-8")).join("\n");
}

/**
 * Creates a real Miniflare D1 database with the full schema applied.
 * Returns the Miniflare instance (for cleanup), the raw D1 handle,
 * and a Drizzle instance for type-safe queries.
 */
export async function createTestD1() {
  // Spin up a real workerd process — same engine as Cloudflare production
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["makisend_db"],
  });

  // Get the D1 database handle from workerd
  const d1 = await mf.getD1Database("makisend_db");

  // Load and execute all migration SQL from drizzle/ directory
  const migrationSql = loadMigrationSql();
  // Drizzle Kit separates statements with "--> statement-breakpoint" comments
  // Split on that, clean up whitespace, convert backticks to double quotes (D1 uses double quotes)
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((s) => s.trim().replace(/`/g, '"'))
    .filter((s) => s.length > 0);

  // Execute each CREATE TABLE / CREATE INDEX statement individually
  for (const stmt of statements) {
    await d1.prepare(stmt).run();
  }

  // Wrap D1 in a Drizzle instance with schema for type-safe queries
  const db = drizzle(d1, { schema });
  return { mf, d1, db };
}

/**
 * Shuts down the Miniflare workerd process.
 * try/catch handles the case where the test already disposed it.
 */
export async function cleanupTestD1(mf: Miniflare | undefined) {
  if (mf) {
    try {
      await mf.dispose();
    } catch {
      // Already disposed
    }
  }
}
