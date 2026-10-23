export interface EncryptedColumn {
  table: string;
  primaryKey: string;
  column: string;
}

export interface StaleValue {
  id: string;
  value: string;
}

export interface IKeyRotationRepository {
  /** Values of `target` NOT encrypted with the current key (their `kid` differs or is missing). */
  findStale(target: EncryptedColumn, currentPrefix: string, limit: number): Promise<StaleValue[]>;
  countStale(target: EncryptedColumn, currentPrefix: string): Promise<number>;
  /** Writes `next` only if the cell still holds `previous`. Returns whether it wrote. */
  replace(target: EncryptedColumn, id: string, previous: string, next: string): Promise<boolean>;
}

export interface KeyRotationReport {
  reEncrypted: number;
  /** Values that no configured key could decrypt. They are left untouched. */
  failed: number;
  /** Values still on an old key after this run (0 = previous keys can be deleted). */
  remaining: number;
}
