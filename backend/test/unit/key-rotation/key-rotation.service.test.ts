import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";

import { decrypt, encrypt, keyId } from "@/core/crypto";
import { ENCRYPTED_COLUMNS, KeyRotationRepository, KeyRotationService } from "@/key-rotation";
import { cleanupTestD1, createTestD1 } from "../../helpers/d1-setup";

const OLD_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NEW_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const KEYS = { current: NEW_KEY, previous: [OLD_KEY] };

async function legacyCiphertext(plainText: string, keyHex: string): Promise<string> {
  const { iv, data } = JSON.parse(await encrypt(plainText, keyHex)) as { iv: string; data: string };
  return JSON.stringify({ iv, data });
}

describe("KeyRotationService (real D1)", () => {
  let mf: Miniflare;
  let d1: D1Database;

  beforeAll(async () => {
    ({ mf, d1 } = await createTestD1());
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  beforeEach(async () => {
    await d1.batch([
      d1.prepare(`DELETE FROM "email_contents"`),
      d1.prepare(`DELETE FROM "email_logs"`),
      d1.prepare(`DELETE FROM "smtp_config"`),
      d1.prepare(`DELETE FROM "user"`),
    ]);
    await d1
      .prepare(`INSERT INTO "user" (id, email, email_verified, created_at, updated_at) VALUES ('u1', 'a@b.c', 1, 0, 0)`)
      .run();
  });

  async function seed() {
    await d1
      .prepare(
        `INSERT INTO "smtp_config" (id, user_id, smtphostname, smtpusername, smtppassword, sender_email)
         VALUES ('s1', 'u1', ?1, ?2, ?3, ?4)`,
      )
      .bind(
        await legacyCiphertext("smtp.example.com", OLD_KEY),
        await encrypt("user", OLD_KEY),
        await legacyCiphertext("p@ss", OLD_KEY),
        await encrypt("from@example.com", NEW_KEY),
      )
      .run();
    await d1
      .prepare(`INSERT INTO "email_logs" ("internalId", user_id, "to", subject, created_at) VALUES ('e1', 'u1', ?1, 'Hi', '2026-01-01T00:00:00Z')`)
      .bind(await legacyCiphertext("to@example.com", OLD_KEY))
      .run();
    await d1
      .prepare(`INSERT INTO "email_contents" (email_id, text_body, html_body, created_at) VALUES ('e1', ?1, '', '2026-01-01T00:00:00Z')`)
      .bind(await legacyCiphertext("Hello", OLD_KEY))
      .run();
  }

  const service = (batchSize?: number) =>
    new KeyRotationService(new KeyRotationRepository(d1), KEYS, ENCRYPTED_COLUMNS, batchSize);

  it("re-encrypts every stale value with the current key and leaves the plaintext unchanged", async () => {
    await seed();

    const report = await service().run();

    expect(report).toEqual({ reEncrypted: 5, failed: 0, remaining: 0 });
    const smtp = await d1.prepare(`SELECT * FROM "smtp_config" WHERE id = 's1'`).first<Record<string, string>>();
    const log = await d1.prepare(`SELECT "to" FROM "email_logs" WHERE "internalId" = 'e1'`).first<{ to: string }>();
    const content = await d1
      .prepare(`SELECT text_body, html_body FROM "email_contents" WHERE email_id = 'e1'`)
      .first<{ text_body: string; html_body: string }>();
    const kid = await keyId(NEW_KEY);

    for (const value of [smtp!.smtphostname, smtp!.smtpusername, smtp!.smtppassword, smtp!.sender_email, log!.to, content!.text_body]) {
      expect(JSON.parse(value).kid).toBe(kid);
    }
    // Only the new key is needed from now on.
    expect(await decrypt(smtp!.smtphostname, NEW_KEY)).toBe("smtp.example.com");
    expect(await decrypt(smtp!.smtppassword, NEW_KEY)).toBe("p@ss");
    expect(await decrypt(log!.to, NEW_KEY)).toBe("to@example.com");
    expect(await decrypt(content!.text_body, NEW_KEY)).toBe("Hello");
    expect(content!.html_body).toBe("");
  });

  it("is idempotent: a second run has nothing to do", async () => {
    await seed();
    await service().run();

    expect(await service().run()).toEqual({ reEncrypted: 0, failed: 0, remaining: 0 });
  });

  it("works through the backlog in batches and reports what remains", async () => {
    for (const id of ["l1", "l2", "l3"]) {
      await d1
        .prepare(`INSERT INTO "email_logs" ("internalId", user_id, "to", subject, created_at) VALUES (?1, 'u1', ?2, 'Hi', '2026-01-01T00:00:00Z')`)
        .bind(id, await legacyCiphertext(`${id}@example.com`, OLD_KEY))
        .run();
    }

    expect(await service(0).run()).toEqual({ reEncrypted: 0, failed: 0, remaining: 3 });
    expect(await service(2).run()).toEqual({ reEncrypted: 2, failed: 0, remaining: 1 });
    expect(await service(2).run()).toEqual({ reEncrypted: 1, failed: 0, remaining: 0 });
  });

  it("leaves a value no key can decrypt untouched and counts it as failed", async () => {
    await seed();
    const foreign = await encrypt("unknown", "bb".repeat(32));
    await d1.prepare(`UPDATE "email_logs" SET "to" = ?1 WHERE "internalId" = 'e1'`).bind(foreign).run();

    const report = await service().run();

    expect(report).toEqual({ reEncrypted: 4, failed: 1, remaining: 1 });
    const log = await d1.prepare(`SELECT "to" FROM "email_logs" WHERE "internalId" = 'e1'`).first<{ to: string }>();
    expect(log!.to).toBe(foreign);
  });

  it("never overwrites a value changed after it was read", async () => {
    await seed();
    const repository = new KeyRotationRepository(d1);
    const column = ENCRYPTED_COLUMNS.find((c) => c.column === "smtppassword")!;
    const [stale] = await repository.findStale(column, `{"kid":"${await keyId(NEW_KEY)}"%`, 10);
    const edited = await encrypt("new-password", NEW_KEY);
    await d1.prepare(`UPDATE "smtp_config" SET smtppassword = ?1 WHERE id = 's1'`).bind(edited).run();

    expect(await repository.replace(column, stale.id, stale.value, await encrypt("p@ss", NEW_KEY))).toBe(false);
    const row = await d1.prepare(`SELECT smtppassword FROM "smtp_config" WHERE id = 's1'`).first<{ smtppassword: string }>();
    expect(row!.smtppassword).toBe(edited);
  });
});
