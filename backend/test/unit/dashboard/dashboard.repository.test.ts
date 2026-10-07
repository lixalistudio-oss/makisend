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
    await db.run(sql`insert into apikey (id, config_id, reference_id, key, created_at, updated_at, smtp_config_id)
                     values ('key-1', 'default', ${userId}, 'k', 0, 0, 'cfg-1')`);
  });

  async function addEmail(
    internalId: string,
    owner: string,
    statuses: string[],
    daysAgo = 0,
  ) {
    await db.run(sql`insert into email_logs (internalId, user_id, apikey_id, "to", subject, created_at)
                     values (${internalId}, ${owner}, 'key-1', 'enc_to', 's', ${since(daysAgo)})`);
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
  });
});
