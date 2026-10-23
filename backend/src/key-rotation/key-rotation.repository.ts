import type { EncryptedColumn, IKeyRotationRepository } from "./key-rotation.types";

/**
 * Every encrypted column in the database. A new encrypted column MUST be added here,
 * or a rotation would leave it on the old key (and break it once that key is deleted).
 * Identifiers are constants, never user input: they are interpolated into the SQL.
 */
export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [
  { table: "smtp_config", primaryKey: "id", column: "smtphostname" },
  { table: "smtp_config", primaryKey: "id", column: "smtpusername" },
  { table: "smtp_config", primaryKey: "id", column: "smtppassword" },
  { table: "smtp_config", primaryKey: "id", column: "sender_email" },
  { table: "email_logs", primaryKey: "internalId", column: "to" },
  { table: "email_contents", primaryKey: "email_id", column: "text_body" },
  { table: "email_contents", primaryKey: "email_id", column: "html_body" },
  // The file as base64, encrypted (POST /send-email `attachments`).
  { table: "email_attachments", primaryKey: "id", column: "content" },
];

const quote = (identifier: string) => `"${identifier}"`;

export class KeyRotationRepository implements IKeyRotationRepository {
  constructor(private readonly db: D1Database) {}

  async findStale(target: EncryptedColumn, currentPrefix: string, limit: number) {
    const { table, primaryKey, column } = target;
    const { results } = await this.db
      .prepare(
        `SELECT ${quote(primaryKey)} AS id, ${quote(column)} AS value FROM ${quote(table)}
         WHERE ${quote(column)} <> '' AND ${quote(column)} NOT LIKE ?1 LIMIT ?2`,
      )
      .bind(currentPrefix, limit)
      .all<{ id: string; value: string }>();
    return results;
  }

  async countStale(target: EncryptedColumn, currentPrefix: string): Promise<number> {
    const { table, column } = target;
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${quote(table)}
         WHERE ${quote(column)} <> '' AND ${quote(column)} NOT LIKE ?1`,
      )
      .bind(currentPrefix)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /**
   * Compare-and-swap: only writes when the cell still holds the value that was
   * re-encrypted, so an edit made in between (e.g. a new SMTP password) is never lost.
   */
  async replace(target: EncryptedColumn, id: string, previous: string, next: string): Promise<boolean> {
    const { table, primaryKey, column } = target;
    const result = await this.db
      .prepare(
        `UPDATE ${quote(table)} SET ${quote(column)} = ?1
         WHERE ${quote(primaryKey)} = ?2 AND ${quote(column)} = ?3`,
      )
      .bind(next, id, previous)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }
}
