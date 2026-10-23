import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { Miniflare } from "miniflare";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import type { Database } from "@/db/connection";
import { TemplateRepository } from "@/templates/templates.repository";

describe("TemplateRepository", () => {
  let mf: Miniflare;
  let db: Database;
  let repo: TemplateRepository;

  const userId = "user-templates-1";

  beforeAll(async () => {
    const created = await createTestD1();
    mf = created.mf;
    db = created.db as unknown as Database;
    repo = new TemplateRepository(db);
  }, 60_000);

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  beforeEach(async () => {
    await db.run(sql`delete from templates`);
    await db.run(sql`delete from user`);
    await db.run(sql`insert into user (id, name, email, email_verified, created_at, updated_at)
                     values (${userId}, 'u', 'u@example.com', 1, 0, 0)`);
  });

  it("persists the legacy format by default", async () => {
    const created = await repo.create(userId, {
      name: "Legacy",
      subject: "Hi {{name}}",
      html: "<p>Hi {{name}}</p>",
      text: "Hi {{name}}",
    });

    expect(created.format).toBe("legacy");
    expect(created.editorJson).toBeNull();

    const found = await repo.findById(created.id);
    expect(found?.format).toBe("legacy");
    expect(found?.editorJson).toBeNull();
  });

  it("round-trips pasted React Email source", async () => {
    const source = "export default function Email() { return <p>Hi</p>; }";
    const created = await repo.create(userId, {
      name: "Code",
      subject: "Hi",
      format: "react-email-code",
      source,
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(created.format).toBe("react-email-code");
    expect(created.source).toBe(source);
    expect(created.editorJson).toBeNull();

    const found = await repo.findById(created.id);
    expect(found?.source).toBe(source);
  });

  it("round-trips the React Email document and exported content", async () => {
    const editorJson = JSON.stringify({ type: "doc", content: [] });
    const created = await repo.create(userId, {
      name: "Visual",
      subject: "Hi {{name}}",
      format: "react-email",
      editorJson,
      html: "<p>Hi {{name}}</p>",
      text: "Hi {{name}}",
    });

    expect(created.format).toBe("react-email");
    expect(created.editorJson).toBe(editorJson);

    const updated = await repo.update(created.id, {
      editorJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      html: "<p>Updated</p>",
    });

    expect(updated.format).toBe("react-email");
    expect(updated.html).toBe("<p>Updated</p>");
    expect(updated.editorJson).toContain("paragraph");
  });
});
