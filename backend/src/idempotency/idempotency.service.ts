import type {
  IdempotencyDecision,
  IdempotencyRecord,
  IIdempotencyRepository,
} from "./idempotency.types";

/** Completed responses are replayable for 24 hours. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface BeginIdempotentRequestInput {
  userId: string;
  route: string;
  key: string;
  requestHash: string;
}

export class IdempotencyService {
  constructor(
    private readonly repository: IIdempotencyRepository,
    private readonly ttlMs: number = IDEMPOTENCY_TTL_MS,
  ) {}

  /**
   * Reserves the key or returns the stored response. Two attempts cover the
   * race between `find()` and `createPending()`: the unique index lets exactly
   * one request insert, and the loser re-reads the winner's row.
   */
  async begin(input: BeginIdempotentRequestInput): Promise<IdempotencyDecision> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.repository.find(
        input.userId,
        input.route,
        input.key,
      );
      if (existing) {
        return this.inspect(existing, input.requestHash);
      }

      const recordId = await this.repository.createPending({
        userId: input.userId,
        route: input.route,
        key: input.key,
        requestHash: input.requestHash,
        expiresAt: new Date(Date.now() + this.ttlMs),
      });

      if (recordId) {
        return { type: "proceed", recordId };
      }
    }

    return {
      type: "conflict",
      message: "A request with this Idempotency-Key is already in progress.",
    };
  }

  async complete(
    recordId: string,
    statusCode: number,
    responseBody: string,
  ): Promise<void> {
    await this.repository.complete(recordId, statusCode, responseBody);
  }

  /** A 5xx/aborted request must not poison the key: allow the client to retry. */
  async abandon(recordId: string): Promise<void> {
    await this.repository.remove(recordId);
  }

  private inspect(
    record: IdempotencyRecord,
    requestHash: string,
  ): IdempotencyDecision {
    if (record.requestHash !== requestHash) {
      return {
        type: "conflict",
        message:
          "This Idempotency-Key was already used with a different request body.",
      };
    }

    if (record.statusCode === null || record.responseBody === null) {
      return {
        type: "conflict",
        message: "A request with this Idempotency-Key is already in progress.",
      };
    }

    return {
      type: "replay",
      statusCode: record.statusCode,
      responseBody: record.responseBody,
    };
  }
}
