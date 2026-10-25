import { decrypt, encrypt, keyedHash, keyedHashes, keyId, type EncryptionKeys } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import type {
  ISuppressionRepository,
  RehashReport,
  Suppression,
  SuppressionMatch,
  SuppressionRow,
  SuppressionSource,
} from "./suppressions.types";

/** Domain-separation label of the recipient hash (core/crypto keyedHash). */
export const SUPPRESSION_HASH_PURPOSE = "suppression-recipient";
/** The dashboard lists at most this many entries, newest first. */
export const MAX_LISTED_SUPPRESSIONS = 1000;
export const DEFAULT_REHASH_BATCH = 200;

/** Addresses compare case-insensitively: the hash is computed on the trimmed, lower-cased form. */
export function normalizeRecipient(email: string): string {
  return email.trim().toLowerCase();
}

function toMatch(row: SuppressionRow): SuppressionMatch {
  return { id: row.id, source: row.source, reason: row.reason, createdAt: row.createdAt };
}

export class SuppressionService {
  constructor(
    private readonly repository: ISuppressionRepository,
    private readonly keys: EncryptionKeys,
  ) {}

  /** Checked before a send is accepted. Hashes under every configured key, so a rotation in progress still matches. */
  async findSuppression(userId: string, email: string): Promise<SuppressionMatch | null> {
    const hashes = await keyedHashes(normalizeRecipient(email), this.keys, SUPPRESSION_HASH_PURPOSE);
    const row = await this.repository.findByHashes(userId, hashes);
    return row ? toMatch(row) : null;
  }

  /** Adds `email` for `userId`. Returns false when it was already suppressed (the first reason is kept). */
  async add(
    userId: string,
    email: string,
    entry: { source: SuppressionSource; reason: string; emailId?: string | null },
  ): Promise<boolean> {
    const normalized = normalizeRecipient(email);
    if (await this.findSuppression(userId, normalized)) return false;
    const [recipient, recipientHash, hashKid] = await Promise.all([
      encrypt(normalized, this.keys),
      keyedHash(normalized, this.keys.current, SUPPRESSION_HASH_PURPOSE),
      keyId(this.keys.current),
    ]);
    return this.repository.insertIfAbsent({
      userId,
      recipient,
      recipientHash,
      hashKid,
      source: entry.source,
      reason: entry.reason,
      emailId: entry.emailId ?? null,
    });
  }

  /** Called by the send workflow when the recipient's server rejected the address of `emailId`. */
  async suppressBouncedEmail(emailId: string, reason: string): Promise<boolean> {
    const logged = await this.repository.findEmailRecipient(emailId);
    if (!logged) throw new AppError(404, `Email ${emailId} not found`);
    const to = await decrypt(logged.to, this.keys);
    const added = await this.add(logged.userId, to, { source: "bounce", reason, emailId });
    pinoLogger.info({ emailId, added }, "Recipient added to the suppression list after a hard bounce");
    return added;
  }

  async list(userId: string): Promise<Suppression[]> {
    const rows = await this.repository.listByUser(userId, MAX_LISTED_SUPPRESSIONS);
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        email: await decrypt(row.recipient, this.keys),
        source: row.source,
        reason: row.reason,
        emailId: row.emailId,
        createdAt: row.createdAt,
      })),
    );
  }

  async remove(id: string, userId: string): Promise<void> {
    // A foreign id answers the same 404 as an unknown one.
    if (!(await this.repository.deleteByIdAndUser(id, userId))) {
      throw new AppError(404, "Suppression not found");
    }
  }

  /**
   * Key rotation: re-computes with the current key the hashes made with a previous one, so
   * lookups keep working once the previous key is deleted. The address column itself is
   * re-encrypted by the generic rotation (ENCRYPTED_COLUMNS).
   */
  async rehashStale(limit: number = DEFAULT_REHASH_BATCH): Promise<RehashReport> {
    const currentKid = await keyId(this.keys.current);
    const report: RehashReport = { rehashed: 0, failed: 0, remaining: 0 };

    for (const row of await this.repository.findStaleHashes(currentKid, limit)) {
      let next: string;
      try {
        next = await keyedHash(normalizeRecipient(await decrypt(row.recipient, this.keys)), this.keys.current, SUPPRESSION_HASH_PURPOSE);
      } catch {
        report.failed++;
        continue;
      }
      try {
        if (await this.repository.replaceHash(row.id, row.recipientHash, next, currentKid)) report.rehashed++;
      } catch {
        // The same address already has a row under the current key: the stale one is a duplicate.
        await this.repository.delete(row.id);
        report.rehashed++;
      }
    }

    report.remaining = await this.repository.countStaleHashes(currentKid);
    return report;
  }
}
