import { and, eq } from "drizzle-orm";
import { idempotencyKeys } from "@/db/schema";
import type { Database } from "@/db/connection";
import type {
  CreateIdempotencyRecordInput,
  IdempotencyRecord,
  IIdempotencyRepository,
} from "./idempotency.types";

export class IdempotencyRepository implements IIdempotencyRepository {
  constructor(private readonly db: Database) {}

  async find(
    userId: string,
    route: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const [row] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.route, route),
          eq(idempotencyKeys.key, key),
        ),
      )
      .limit(1);

    if (!row) return null;

    if (row.expiresAt.getTime() <= Date.now()) {
      await this.remove(row.id);
      return null;
    }

    return row;
  }

  async createPending(
    input: CreateIdempotencyRecordInput,
  ): Promise<string | null> {
    const [row] = await this.db
      .insert(idempotencyKeys)
      .values({
        userId: input.userId,
        route: input.route,
        key: input.key,
        requestHash: input.requestHash,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    return row?.id ?? null;
  }

  async complete(
    id: string,
    statusCode: number,
    responseBody: string,
  ): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ statusCode, responseBody })
      .where(eq(idempotencyKeys.id, id));
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
  }
}
