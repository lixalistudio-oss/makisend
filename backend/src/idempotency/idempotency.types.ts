export interface IdempotencyRecord {
  id: string;
  userId: string;
  route: string;
  key: string;
  requestHash: string;
  statusCode: number | null;
  responseBody: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreateIdempotencyRecordInput {
  userId: string;
  route: string;
  key: string;
  requestHash: string;
  expiresAt: Date;
}

export interface IIdempotencyRepository {
  find(userId: string, route: string, key: string): Promise<IdempotencyRecord | null>;
  /** Returns the new row id, or null when another request reserved the key first. */
  createPending(input: CreateIdempotencyRecordInput): Promise<string | null>;
  complete(id: string, statusCode: number, responseBody: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export type IdempotencyDecision =
  | { type: "proceed"; recordId: string }
  | { type: "replay"; statusCode: number; responseBody: string }
  | { type: "conflict"; message: string };
