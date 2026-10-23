/**
 * MakiSend has one account: its super admin, created at the first connection to the dashboard
 * (email + password). Once it exists, no other account can be created, by any path.
 *
 * The rule is enforced on account creation itself (`databaseHooks.user.create.before`), not on
 * the sign-up route, so a future creation path (another Better Auth endpoint, a server-side
 * `auth.api.*` call) cannot bypass it.
 *
 * D1 has no transaction across Better Auth's inserts, so "count users, then insert" would let two
 * concurrent first sign-ups both succeed. Instead each creation claims the single row of
 * `instance_owner` with one conditional UPSERT; only one statement can win it.
 */

/** A claim whose account was never created (the insert failed after the claim) is freed after this. */
export const OWNER_CLAIM_TTL_MS = 30_000;

export const SETUP_COMPLETE_MESSAGE = "This MakiSend instance already has its administrator. Sign in instead.";

/**
 * Claims the instance for the account about to be created. Returns false when it is already
 * owned: an account exists, or another creation claimed it less than OWNER_CLAIM_TTL_MS ago.
 */
export async function claimOwnership(db: D1Database, now: number = Date.now()): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO "instance_owner" ("id", "claimed_at")
       SELECT 1, ?1 WHERE NOT EXISTS (SELECT 1 FROM "user")
       ON CONFLICT ("id") DO UPDATE SET "claimed_at" = excluded."claimed_at"
       WHERE "instance_owner"."claimed_at" < ?2`,
    )
    .bind(now, now - OWNER_CLAIM_TTL_MS)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Frees the instance (the account is being deleted): the next connection sets it up again. */
export async function releaseOwnership(db: D1Database): Promise<void> {
  await db.prepare(`DELETE FROM "instance_owner" WHERE "id" = 1`).run();
}

/** True while the instance has no account: the dashboard sends every visitor to the set-up page. */
export async function needsSetup(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT EXISTS (SELECT 1 FROM "user") AS "taken"`).first<{ taken: number }>();
  return !row?.taken;
}
