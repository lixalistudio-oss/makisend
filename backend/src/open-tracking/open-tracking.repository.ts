import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { emailLogs } from "@/db/schema";
import type { Database } from "@/db/connection";

/** At most one recorded open per email every 30 seconds; the requests in between are not counted. */
export const OPEN_WRITE_THROTTLE_MS = 30_000;

export interface IOpenTrackingRepository {
  /**
   * Records one open of the email carrying `token`, unless its last recorded open is less than
   * `OPEN_WRITE_THROTTLE_MS` old. Returns whether a row was updated: false for an unknown token, an
   * untracked email, or a throttled request.
   */
  recordOpen(token: string, now: Date): Promise<boolean>;
}

export class OpenTrackingRepository implements IOpenTrackingRepository {
  constructor(private readonly db: Database) {}

  async recordOpen(token: string, now: Date): Promise<boolean> {
    const openedAt = now.toISOString();
    // Same toISOString() format as last_opened_at, so the text comparison orders correctly.
    const throttledUntil = new Date(now.getTime() - OPEN_WRITE_THROTTLE_MS).toISOString();

    // One statement, no read first: the throttle lives in the WHERE clause, so two opens arriving
    // together cannot both pass it, and the counter is incremented by SQLite itself.
    const updated = await this.db
      .update(emailLogs)
      .set({
        openCount: sql`${emailLogs.openCount} + 1`,
        firstOpenedAt: sql`coalesce(${emailLogs.firstOpenedAt}, ${openedAt})`,
        lastOpenedAt: openedAt,
      })
      .where(
        and(
          eq(emailLogs.trackingToken, token),
          eq(emailLogs.trackingEnabled, true),
          or(isNull(emailLogs.lastOpenedAt), lte(emailLogs.lastOpenedAt, throttledUntil)),
        ),
      )
      .returning({ internalId: emailLogs.internalId });

    return updated.length > 0;
  }
}
