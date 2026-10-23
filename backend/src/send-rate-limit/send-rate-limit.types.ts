/** A parsed `SEND_RATE_LIMIT`: at most `max` sends per API key in each `windowMs` window. */
export interface SendRateLimit {
  max: number;
  windowMs: number;
  /** As written in the variable, for messages: "100/min". */
  label: string;
}

/** The counter after one more send has been counted. */
export interface SendRateLimitHit {
  count: number;
  windowStart: number;
}

export interface ISendRateLimitRepository {
  /**
   * Counts one send for `apiKeyId`, atomically: starts a new window when the current one
   * is over (or none exists), otherwise increments it. Returns the counter after the hit.
   */
  hit(apiKeyId: string, now: number, windowMs: number): Promise<SendRateLimitHit>;
}
