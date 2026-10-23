import { sql } from "drizzle-orm";
import type { Database } from "@/db/connection";
import { sendRateLimit } from "@/db/schema";
import type { ISendRateLimitRepository, SendRateLimitHit } from "./send-rate-limit.types";

export class SendRateLimitRepository implements ISendRateLimitRepository {
  constructor(private readonly db: Database) {}

  /** One UPSERT: concurrent sends on the same key cannot both read the same count. */
  async hit(apiKeyId: string, now: number, windowMs: number): Promise<SendRateLimitHit> {
    const expired = sql`${sendRateLimit.windowStart} + ${windowMs} <= ${now}`;
    const [row] = await this.db
      .insert(sendRateLimit)
      .values({ apiKeyId, windowStart: now, count: 1 })
      .onConflictDoUpdate({
        target: sendRateLimit.apiKeyId,
        set: {
          windowStart: sql`CASE WHEN ${expired} THEN ${now} ELSE ${sendRateLimit.windowStart} END`,
          count: sql`CASE WHEN ${expired} THEN 1 ELSE ${sendRateLimit.count} + 1 END`,
        },
      })
      .returning({ count: sendRateLimit.count, windowStart: sendRateLimit.windowStart });
    return row;
  }
}
