import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import type { Miniflare } from "miniflare";
import type { Database } from "@/db/connection";
import { DashboardRepository } from "@/dashboard/dashboard.repository";

// Runs the rewritten dashboard queries against a real workerd D1 database so
// the raw SQL (aggregations + correlated subquery) is actually executed.
describe("DashboardRepository", () => {
  let mf: Miniflare;
  let db: Database;
  let repo: DashboardRepository;

  const userId = "user-dash-1";
  const otherUser = "user-dash-2";
  const since = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString();

  beforeAll(async () => {
    const created = await createTestD1();
    mf = created.mf;
    db = created.db as unknown as Database;
    repo = new DashboardRepository(db);
  }, 60_000);

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  beforeEach(async () => {
    await db.run(sql`delete from email_histories`);
    await db.run(sql`delete from email_logs`);
    await db.run(sql`delete from apikey`);
    await db.run(sql`delete from smtp_config`);
    await db.run(sql`delete from user`);

    // Minimal user + smtp config for getByConfig (FK: smtp_config.user_id)
    await db.run(sql`insert into user (id, name, email, email_verified, created_at, updated_at)
                     values (${userId}, 'u', 'u@example.com', 1, 0, 0)`);
    await db.run(sql`insert into smtp_config (id, user_id, smtphostname, smtpusername, smtppassword,
                         sender_email, is_active, created_at, updated_at)
                     values ('cfg-1', ${userId}, 'h', 'u', 'p', 'encrypted_sender', 1, 0, 0)`);
    await db.run(sql`insert into apikey (id, config_id, name, prefix, start, enabled, reference_id, key, created_at, updated_at, smtp_config_id)
                     values ('key-1', 'default', 'Production', 'mk_', 'mk_abcd', 1, ${userId}, 'k', 2, 2, 'cfg-1')`);
    await db.run(sql`insert into apikey (id, config_id, name, prefix, start, enabled, reference_id, key, created_at, updated_at)
                     values ('key-2', 'default', 'Staging', 'mk_', 'mk_wxyz', 0, ${userId}, 'k2', 1, 1)`);
  });

  async function addEmail(
    internalId: string,
    owner: string,
    statuses: string[],
    daysAgo = 0,
    keyId = "key-1",
    processingMs: number | null = null,
  ) {
    await db.run(sql`insert into email_logs (internalId, user_id, apikey_id, "to", subject, email_processing_time, created_at)
                     values (${internalId}, ${owner}, ${keyId}, 'enc_to', 's', ${processingMs}, ${since(daysAgo)})`);
    let i = 0;
    for (const status of statuses) {
      const error = status === "failed" ? "SMTP down" : null;
      await db.run(sql`insert into email_histories (id, email_id, status, error, attempts, created_at)
                       values (${`${internalId}-h${i}`}, ${internalId}, ${status}, ${error}, 1, ${since(daysAgo - i)})`);
      i += 1;
    }
  }

  describe("getStats", () => {
    it("counts sent and failed emails in SQL", async () => {
      await addEmail("e1", userId, ["received", "sent"]);
      await addEmail("e2", userId, ["received", "sent"]);
      await addEmail("e3", userId, ["received", "attempt_failed", "failed"]);
      await addEmail("e4", userId, ["received", "processing"]);
      // Another user's emails must not leak into the stats.
      await addEmail("e-other", otherUser, ["sent"]);

      const stats = await repo.getStats(userId, 7);

      expect(stats.totalSent).toBe(4);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.successRate).toBe(50);
    });

    it("does not count the dashboard's own test sends (a failed test must not lower the success rate)", async () => {
      await addEmail("api-ok", userId, ["received", "sent"]);
      await db.run(sql`insert into email_logs (internalId, user_id, apikey_id, "to", subject, source, smtp_config_id, created_at)
                       values ('test-ok', ${userId}, null, 'enc_to', 's', 'test', 'cfg-1', ${since(0)})`);
      await db.run(sql`insert into email_histories (id, email_id, status, created_at) values ('t-h1', 'test-ok', 'sent', ${since(0)})`);
      await db.run(sql`insert into email_logs (internalId, user_id, apikey_id, "to", subject, source, smtp_config_id, created_at)
                       values ('test-ko', ${userId}, null, 'enc_to', 's', 'test', 'cfg-1', ${since(0)})`);
      await db.run(sql`insert into email_histories (id, email_id, status, error, created_at) values ('t-h2', 'test-ko', 'failed', 'Authentication', ${since(0)})`);

      expect(await repo.getStats(userId, 7)).toEqual({ totalSent: 1, successCount: 1, failureCount: 0, successRate: 100 });
      expect(await repo.getErrors(userId, 7, 10), "a failed test is not an API delivery error").toEqual([]);
      // ...but it is part of the recent activity the person just did.
      expect((await repo.getRecent(userId, 20)).map((r) => r.internalId).sort()).toEqual(["api-ok", "test-ko", "test-ok"]);
    });

    it("returns zeroes for a user with no emails", async () => {
      const stats = await repo.getStats("nobody", 7);
      expect(stats).toEqual({ totalSent: 0, successCount: 0, failureCount: 0, successRate: 0 });
    });

    it("respects the days window", async () => {
      await addEmail("old", userId, ["sent"], 30);
      await addEmail("new", userId, ["sent"], 0);

      const stats = await repo.getStats(userId, 7);
      expect(stats.totalSent).toBe(1);
    });
  });

  describe("getRecent", () => {
    it("returns the latest history status per email in one query", async () => {
      await addEmail("r1", userId, ["received", "processing", "sent"]);
      await addEmail("r2", userId, ["received", "failed"], 1);
      await addEmail("r-other", otherUser, ["sent"]);

      const recent = await repo.getRecent(userId, 20);

      expect(recent).toHaveLength(2);
      expect(recent.map((r) => r.internalId)).toEqual(["r1", "r2"]);
      expect(recent.find((r) => r.internalId === "r1")?.status).toBe("sent");
      expect(recent.find((r) => r.internalId === "r2")?.status).toBe("failed");
      expect(recent.find((r) => r.internalId === "r2")?.sentAt).toBeTruthy();
    });

    it("marks emails with no history as unknown and honours limit", async () => {
      await db.run(sql`insert into email_logs (internalId, user_id, apikey_id, "to", subject, created_at)
                       values ('no-hist', ${userId}, null, 'enc_to', 's', ${since(0)})`);
      await addEmail("with-hist", userId, ["sent"], 1);

      const recent = await repo.getRecent(userId, 1);

      expect(recent).toHaveLength(1);
      expect(recent[0].internalId).toBe("no-hist");
      expect(recent[0].status).toBe("unknown");
    });
  });

  describe("getErrors", () => {
    it("groups failed emails by error message", async () => {
      await addEmail("f1", userId, ["failed"]);
      await addEmail("f2", userId, ["failed"]);
      await addEmail("f3", userId, ["sent"]);
      await addEmail("f-other", otherUser, ["failed"]);

      const errors = await repo.getErrors(userId, 7, 10);

      expect(errors).toEqual([{ error: "SMTP down", count: 2 }]);
    });

    it("falls back to a placeholder when the error is null", async () => {
      await db.run(sql`insert into email_logs (internalId, user_id, apikey_id, "to", subject, created_at)
                       values ('noerr', ${userId}, null, 'enc_to', 's', ${since(0)})`);
      await db.run(sql`insert into email_histories (id, email_id, status, error, attempts, created_at)
                       values ('noerr-h', 'noerr', 'failed', null, 5, ${since(0)})`);

      const errors = await repo.getErrors(userId, 7, 10);
      expect(errors).toEqual([{ error: "Unknown error", count: 1 }]);
    });
  });

  describe("getByConfig", () => {
    it("aggregates per SMTP config", async () => {
      await addEmail("c1", userId, ["sent"]);
      await addEmail("c2", userId, ["failed"]);
      await addEmail("c-other", otherUser, ["sent"]);

      const breakdown = await repo.getByConfig(userId, 7);

      expect(breakdown).toHaveLength(1);
      expect(breakdown[0]).toMatchObject({
        smtpConfigId: "cfg-1",
        totalSent: 2,
        successCount: 1,
        failureCount: 1,
      });
    });

    it("returns an empty breakdown when the user has no configs", async () => {
      expect(await repo.getByConfig("nobody", 7)).toEqual([]);
    });

    it("merges emails sent through several API keys of the same config", async () => {
      // key-2 (seeded above without a config) joins key-1 on cfg-1.
      await db.run(sql`update apikey set smtp_config_id = 'cfg-1' where id = 'key-2'`);
      await addEmail("m1", userId, ["sent"], 0, "key-1");
      await addEmail("m2", userId, ["sent"], 0, "key-2");

      const breakdown = await repo.getByConfig(userId, 7);

      expect(breakdown).toHaveLength(1);
      expect(breakdown[0]).toMatchObject({ smtpConfigId: "cfg-1", totalSent: 2, successCount: 2 });
    });
  });

  describe("per API key", () => {
    it("getStats can be scoped to one API key", async () => {
      await addEmail("a1", userId, ["received", "sent"], 0, "key-1");
      await addEmail("a2", userId, ["received", "sent"], 0, "key-1");
      await addEmail("b1", userId, ["received", "attempt_failed", "failed"], 0, "key-2");

      const key1 = await repo.getStats(userId, 7, "key-1");
      const key2 = await repo.getStats(userId, 7, "key-2");
      const all = await repo.getStats(userId, 7);

      expect(key1).toEqual({ totalSent: 2, successCount: 2, failureCount: 0, successRate: 100 });
      expect(key2).toEqual({ totalSent: 1, successCount: 0, failureCount: 1, successRate: 0 });
      expect(all.totalSent).toBe(3);
    });

    it("never returns another user's key data, even with a valid key id", async () => {
      await addEmail("x1", otherUser, ["sent"], 0, "key-1");
      const stats = await repo.getStats(userId, 7, "key-1");
      expect(stats.totalSent).toBe(0);
    });

    it("getErrors can be scoped to one API key", async () => {
      await addEmail("a1", userId, ["received", "failed"], 0, "key-1");
      await addEmail("b1", userId, ["received", "failed"], 0, "key-2");
      await addEmail("b2", userId, ["received", "failed"], 0, "key-2");

      expect(await repo.getErrors(userId, 7, 10, "key-1")).toEqual([{ error: "SMTP down", count: 1 }]);
      expect(await repo.getErrors(userId, 7, 10, "key-2")).toEqual([{ error: "SMTP down", count: 2 }]);
    });

    it("getByApiKey returns one row per key with its own counters", async () => {
      await addEmail("a1", userId, ["received", "sent"], 0, "key-1", 100);
      await addEmail("a2", userId, ["received", "sent"], 0, "key-1", 300);
      await addEmail("a3", userId, ["received", "attempt_failed", "failed"], 0, "key-1");
      await addEmail("old", userId, ["received", "sent"], 30, "key-1", 9999);
      await addEmail("b1", userId, ["received", "processing"], 0, "key-2");
      await addEmail("other", otherUser, ["sent"], 0, "key-1");

      const rows = await repo.getByApiKey(userId, 7);
      const byId = Object.fromEntries(rows.map((r) => [r.apiKeyId, r]));

      expect(rows).toHaveLength(2);
      expect(byId["key-1"]).toMatchObject({
        name: "Production",
        prefix: "mk_",
        start: "mk_abcd",
        enabled: true,
        totalSent: 3,
        successCount: 2,
        failureCount: 1,
        successRate: 67,
        // Average of 100 and 300 only: the 30-day-old email is outside the window and
        // the failed one has no processing time. Not skewed by the number of history rows.
        avgProcessingTimeMs: 200,
      });
      expect(byId["key-1"].lastUsedAt).toBeTruthy();
      expect(byId["key-2"]).toMatchObject({
        name: "Staging",
        enabled: false,
        totalSent: 1,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        avgProcessingTimeMs: null,
      });
    });

    it("lists a key that never sent anything, with zeroes", async () => {
      const rows = await repo.getByApiKey(userId, 7);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({ totalSent: 0, successCount: 0, failureCount: 0, successRate: 0 });
        expect(row.lastUsedAt).toBeNull();
        expect(row.avgProcessingTimeMs).toBeNull();
      }
    });

    it("does not list another user's keys", async () => {
      expect(await repo.getByApiKey("nobody", 7)).toEqual([]);
    });
  });
});
