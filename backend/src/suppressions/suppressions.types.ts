/** "complaint": the recipient marked an email as spam (reported by the provider's webhook). */
export type SuppressionSource = "bounce" | "complaint" | "manual";

/** A row as stored: `recipient` is encrypted, `recipientHash` a keyed HMAC of the address. */
export interface SuppressionRow {
  id: string;
  userId: string;
  recipient: string;
  recipientHash: string;
  hashKid: string;
  source: SuppressionSource;
  reason: string;
  emailId: string | null;
  createdAt: string;
}

export type NewSuppressionRow = Omit<SuppressionRow, "id" | "createdAt">;

/** API-facing suppression: the address decrypted, no hash. */
export interface Suppression {
  id: string;
  email: string;
  source: SuppressionSource;
  reason: string;
  emailId: string | null;
  createdAt: string;
}

/** What a send needs to know about a suppressed address (never the address itself). */
export interface SuppressionMatch {
  id: string;
  source: SuppressionSource;
  reason: string;
  createdAt: string;
}

export interface RehashReport {
  rehashed: number;
  /** Rows no configured key could decrypt: left untouched. */
  failed: number;
  /** Rows still hashed with a previous key after this run. */
  remaining: number;
}

/** The one thing POST /send-email needs from the suppression list. */
export interface ISuppressionLookup {
  findSuppression(userId: string, email: string): Promise<SuppressionMatch | null>;
}

export interface ISuppressionRepository {
  /** The user's suppression whose hash is one of `hashes`, if any. */
  findByHashes(userId: string, hashes: string[]): Promise<SuppressionRow | null>;
  /** Inserts unless the address is already suppressed for this user. Returns whether it inserted. */
  insertIfAbsent(row: NewSuppressionRow): Promise<boolean>;
  /** Newest first, at most `limit`. */
  listByUser(userId: string, limit: number): Promise<SuppressionRow[]>;
  deleteByIdAndUser(id: string, userId: string): Promise<boolean>;
  /** Owner and encrypted recipient of a logged email. */
  findEmailRecipient(emailId: string): Promise<{ userId: string; to: string } | null>;
  /** Rows whose hash was computed with another key than `currentKid`. */
  findStaleHashes(currentKid: string, limit: number): Promise<SuppressionRow[]>;
  countStaleHashes(currentKid: string): Promise<number>;
  /** Compare-and-swap on the hash. Returns whether it wrote. */
  replaceHash(id: string, previousHash: string, nextHash: string, kid: string): Promise<boolean>;
  delete(id: string): Promise<void>;
}
