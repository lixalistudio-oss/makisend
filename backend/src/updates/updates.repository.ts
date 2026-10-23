import { eq } from "drizzle-orm";
import type { Database } from "@/db/connection";
import { updateCheck } from "@/db/schema";
import type { IUpdateCheckRepository, UpdateCheckRecord } from "./updates.types";

/** The table holds one row: the result of the last check. */
const ROW_ID = "latest";

export class UpdateCheckRepository implements IUpdateCheckRepository {
  constructor(private readonly db: Database) {}

  async get(): Promise<UpdateCheckRecord | null> {
    const [row] = await this.db.select().from(updateCheck).where(eq(updateCheck.id, ROW_ID)).limit(1);
    if (!row) return null;
    return {
      latestVersion: row.latestVersion,
      releaseName: row.releaseName,
      releaseUrl: row.releaseUrl,
      releaseNotes: row.releaseNotes,
      publishedAt: row.publishedAt,
      checkedAt: row.checkedAt,
      error: row.error,
    };
  }

  async save(record: UpdateCheckRecord): Promise<void> {
    const values = { id: ROW_ID, ...record };
    await this.db
      .insert(updateCheck)
      .values(values)
      .onConflictDoUpdate({ target: updateCheck.id, set: record });
  }
}
