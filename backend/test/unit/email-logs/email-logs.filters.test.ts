import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { Miniflare } from "miniflare";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import type { Database } from "@/db/connection";
import { EmailLogRepository } from "@/email-logs/email-logs.repository";
import type { EmailLogFilters } from "@/email-logs/email-logs.types";

/**
 * Real workerd D1: the API key and SMTP config filters are SQL, so they run for real.
 *
 * ── Failure analysis (written before the code) ──
 *  L1  The key filter leaks another user's logs to someone who knows a key id.
 *  L2  The key filter replaces the status or configuration filter instead of narrowing it.
 *  L3  A dashboard test send (no API key) is invisible when filtering by its configuration,
 *      or shows up under another configuration, or another user's.
 */
describe("EmailLogRepository — filter by API key", () => {
  let mf: Miniflare;
  let db: Database;
  let repo: EmailLogRepository;

  const userId = "user-log-1";
  const otherUser = "user-log-2";

  beforeAll(async () => {
    const created = await createTestD1();
    mf = created.mf;
    db = created.db;
    repo = new EmailLogRepository(db);
  }, 60_000);

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  /** One page is enough here: each case writes a handful of rows. */
  async function list(owner: string, filters: EmailLogFilters = {}) {
    return (await repo.findPageByUserId(owner, filters)).logs;
  }

  beforeEach(async () => {
    await db.run(sql`delete from email_histories`);
    await db.run(sql`delete from email_logs`);
    await db.run(sql`delete from apikey`);
    await db.run(sql`delete from smtp_config`);
    await db.run(sql`delete from user`);

    await db.run(sql`insert into user (id, name, email, email_verified, created_at, updated_at)
                     values (${userId}, 'u', 'u@example.com', 1, 0, 0)`);
    await db.run(sql`insert into smtp_config (id, user_id, smtphostname, smtpusername, smtppassword,
                         sender_email, is_active, created_at, updated_at)
                     values ('cfg-1', ${userId}, 'h', 'u', 'p', 's', 1, 0, 0)`);
    await db.run(sql`insert into apikey (id, config_id, reference_id, key, created_at, updated_at, smtp_config_id)
                     values ('key-1', 'default', ${userId}, 'k1', 0, 0, 'cfg-1')`);
    await db.run(sql`insert into apikey (id, config_id, reference_id, key, created_at, updated_at)
                     values ('key-2', 'default', ${userId}, 'k2', 0, 0)`);
  });

  async function addLog(id: string, owner: string, keyId: string | null, status: string) {
    await db.run(sql`insert into email_logs (internalId, user_id, apikey_id, "to", subject, created_at)
                     values (${id}, ${owner}, ${keyId}, 'enc', 's', ${new Date().toISOString()})`);
    await db.run(sql`insert into email_histories (id, email_id, status, created_at)
                     values (${`${id}-h`}, ${id}, ${status}, ${new Date().toISOString()})`);
  }

  it("returns only the logs sent with that key", async () => {
    await addLog("l1", userId, "key-1", "sent");
    await addLog("l2", userId, "key-1", "failed");
    await addLog("l3", userId, "key-2", "sent");

    const logs = await list(userId, { apiKeyId: "key-1" });

    expect(logs.map((l) => l.internalId).sort()).toEqual(["l1", "l2"]);
    expect(logs.every((l) => l.apiKeyId === "key-1")).toBe(true);
  });

  it("combines with the status filter", async () => {
    await addLog("l1", userId, "key-1", "sent");
    await addLog("l2", userId, "key-1", "failed");
    await addLog("l3", userId, "key-2", "failed");

    const logs = await list(userId, { apiKeyId: "key-1", status: "failed" });

    expect(logs.map((l) => l.internalId)).toEqual(["l2"]);
  });

  it("combines with the SMTP config filter (that config's key is key-1)", async () => {
    await addLog("l1", userId, "key-1", "sent");
    await addLog("l2", userId, "key-2", "sent");

    expect((await list(userId, { smtpConfigId: "cfg-1", apiKeyId: "key-1" })).map((l) => l.internalId)).toEqual(["l1"]);
    // key-2 is not linked to cfg-1: the two filters together match nothing.
    expect(await list(userId, { smtpConfigId: "cfg-1", apiKeyId: "key-2" })).toEqual([]);
  });

  async function addTestLog(id: string, owner: string, configId: string, status: string) {
    await db.run(sql`insert into email_logs (internalId, user_id, apikey_id, "to", subject, source, smtp_config_id, created_at)
                     values (${id}, ${owner}, null, 'enc', 's', 'test', ${configId}, ${new Date().toISOString()})`);
    await db.run(sql`insert into email_histories (id, email_id, status, created_at)
                     values (${`${id}-h`}, ${id}, ${status}, ${new Date().toISOString()})`);
  }

  it("lists a test send, with its source and configuration", async () => {
    await addLog("api-1", userId, "key-1", "sent");
    await addTestLog("test-1", userId, "cfg-1", "sent");

    const logs = await list(userId);

    expect(logs.map((l) => [l.internalId, l.source, l.smtpConfigId]).sort()).toEqual([
      ["api-1", "api", null],
      ["test-1", "test", "cfg-1"],
    ]);
  });

  it("the SMTP config filter keeps that configuration's tests next to its keys' sends, and nothing else", async () => {
    await db.run(sql`insert into smtp_config (id, user_id, smtphostname, smtpusername, smtppassword,
                         sender_email, is_active, created_at, updated_at)
                     values ('cfg-2', ${userId}, 'h', 'u', 'p', 's', 1, 0, 0)`);
    await addLog("api-1", userId, "key-1", "sent");
    await addLog("api-2", userId, "key-2", "sent");
    await addTestLog("test-cfg1", userId, "cfg-1", "sent");
    await addTestLog("test-cfg2", userId, "cfg-2", "failed");

    expect((await list(userId, { smtpConfigId: "cfg-1" })).map((l) => l.internalId).sort()).toEqual(["api-1", "test-cfg1"]);
    // cfg-2 has no key at all: only its test matches (the old filter returned [] here).
    expect((await list(userId, { smtpConfigId: "cfg-2" })).map((l) => l.internalId)).toEqual(["test-cfg2"]);
  });

  it("another user's test never shows up, even through a configuration id they know", async () => {
    await addTestLog("theirs", otherUser, "cfg-1", "sent");
    expect(await list(userId, { smtpConfigId: "cfg-1" })).toEqual([]);
  });

  it("never returns another user's logs, even for a key id they know", async () => {
    await addLog("mine", userId, "key-1", "sent");
    await addLog("theirs", otherUser, "key-1", "sent");

    const logs = await list(userId, { apiKeyId: "key-1" });

    expect(logs.map((l) => l.internalId)).toEqual(["mine"]);
  });

  it("returns nothing for a key that sent nothing, and keeps logs of a deleted key out of the filter", async () => {
    await addLog("orphan", userId, null, "sent");
    expect(await list(userId, { apiKeyId: "key-2" })).toEqual([]);
    expect(await list(userId, { apiKeyId: "gone" })).toEqual([]);
  });
});
