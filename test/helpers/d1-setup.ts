import { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

const tables = [
  `CREATE TABLE IF NOT EXISTS "account" ("id" text PRIMARY KEY NOT NULL, "account_id" text NOT NULL, "provider_id" text NOT NULL, "user_id" text NOT NULL, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" integer, "refresh_token_expires_at" integer, "scope" text, "password" text, "created_at" integer NOT NULL, "updated_at" integer NOT NULL, FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade)`,
  `CREATE TABLE IF NOT EXISTS "apikey" ("id" text PRIMARY KEY NOT NULL, "config_id" text DEFAULT 'default' NOT NULL, "name" text, "start" text, "reference_id" text NOT NULL, "prefix" text, "key" text NOT NULL, "refill_interval" integer, "refill_amount" integer, "last_refill_at" integer, "enabled" integer DEFAULT true, "rate_limit_enabled" integer DEFAULT true, "rate_limit_time_window" integer DEFAULT 86400000, "rate_limit_max" integer DEFAULT 10, "request_count" integer DEFAULT 0, "remaining" integer, "last_request" integer, "expires_at" integer, "created_at" integer NOT NULL, "updated_at" integer NOT NULL, "permissions" text, "metadata" text)`,
  `CREATE TABLE IF NOT EXISTS "email_histories" ("id" text PRIMARY KEY NOT NULL, "email_id" text NOT NULL, "status" text NOT NULL, "error" text, "created_at" text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "email_logs" ("internalId" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "to" text NOT NULL, "subject" text NOT NULL, "smtp_id" text NOT NULL, "sent_at" text NOT NULL, "email_processing_time" integer)`,
  `CREATE TABLE IF NOT EXISTS "session" ("id" text PRIMARY KEY NOT NULL, "expires_at" integer NOT NULL, "token" text NOT NULL UNIQUE, "created_at" integer NOT NULL, "updated_at" integer NOT NULL, "ip_address" text, "user_agent" text, "user_id" text NOT NULL, FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade)`,
  `CREATE TABLE IF NOT EXISTS "user" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "smtp_username" text NOT NULL, "smtp_password" text NOT NULL, "smpt_hostname" text NOT NULL, "sender_email" text NOT NULL, "email_verified" integer DEFAULT false NOT NULL, "image" text, "created_at" integer NOT NULL, "updated_at" integer NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "verification" ("id" text PRIMARY KEY NOT NULL, "identifier" text NOT NULL, "value" text NOT NULL, "expires_at" integer NOT NULL, "created_at" integer NOT NULL, "updated_at" integer NOT NULL)`,
];

export async function createTestD1() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["makisend_db"],
  });

  const d1 = await mf.getD1Database("makisend_db");
  for (const stmt of tables) {
    await d1.exec(stmt);
  }

  const db = drizzle(d1, { schema });
  return { mf, d1, db };
}

export async function cleanupTestD1(mf: Miniflare | undefined) {
  if (mf) {
    try {
      await mf.dispose();
    } catch {
      // Already disposed
    }
  }
}
