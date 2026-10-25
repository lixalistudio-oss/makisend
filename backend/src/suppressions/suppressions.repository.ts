import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "@/db/connection";
import { emailLogs, suppressions } from "@/db/schema";
import type { ISuppressionRepository, NewSuppressionRow, SuppressionRow } from "./suppressions.types";

export class SuppressionRepository implements ISuppressionRepository {
  constructor(private readonly db: Database) {}

  async findByHashes(userId: string, hashes: string[]): Promise<SuppressionRow | null> {
    if (hashes.length === 0) return null;
    const [row] = await this.db
      .select()
      .from(suppressions)
      .where(and(eq(suppressions.userId, userId), inArray(suppressions.recipientHash, hashes)))
      .limit(1);
    return row ?? null;
  }

  async insertIfAbsent(row: NewSuppressionRow): Promise<boolean> {
    const inserted = await this.db
      .insert(suppressions)
      .values(row)
      .onConflictDoNothing({ target: [suppressions.userId, suppressions.recipientHash] })
      .returning({ id: suppressions.id });
    return inserted.length > 0;
  }

  async listByUser(userId: string, limit: number): Promise<SuppressionRow[]> {
    return this.db
      .select()
      .from(suppressions)
      .where(eq(suppressions.userId, userId))
      .orderBy(desc(suppressions.createdAt))
      .limit(limit);
  }

  async deleteByIdAndUser(id: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(suppressions)
      .where(and(eq(suppressions.id, id), eq(suppressions.userId, userId)))
      .returning({ id: suppressions.id });
    return deleted.length > 0;
  }

  async findEmailRecipient(emailId: string): Promise<{ userId: string; to: string } | null> {
    const [row] = await this.db
      .select({ userId: emailLogs.userId, to: emailLogs.to })
      .from(emailLogs)
      .where(eq(emailLogs.internalId, emailId))
      .limit(1);
    return row ?? null;
  }

  async findStaleHashes(currentKid: string, limit: number): Promise<SuppressionRow[]> {
    return this.db.select().from(suppressions).where(ne(suppressions.hashKid, currentKid)).limit(limit);
  }

  async countStaleHashes(currentKid: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(suppressions).where(ne(suppressions.hashKid, currentKid));
    return row?.n ?? 0;
  }

  async replaceHash(id: string, previousHash: string, nextHash: string, kid: string): Promise<boolean> {
    const updated = await this.db
      .update(suppressions)
      .set({ recipientHash: nextHash, hashKid: kid })
      .where(and(eq(suppressions.id, id), eq(suppressions.recipientHash, previousHash)))
      .returning({ id: suppressions.id });
    return updated.length > 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(suppressions).where(eq(suppressions.id, id));
  }
}
