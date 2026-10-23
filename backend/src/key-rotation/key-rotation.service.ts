import { currentKeyPrefix, reEncrypt, type EncryptionKeys } from "@/core/crypto";
import type { EncryptedColumn, IKeyRotationRepository, KeyRotationReport } from "./key-rotation.types";

/** Values re-encrypted per column and per run: keeps one cron invocation well inside the CPU limit. */
export const DEFAULT_BATCH_SIZE = 200;

/**
 * Re-encrypts with the current key every value still encrypted with a previous key
 * (or written before key ids existed). Idempotent: run it until `remaining` is 0.
 */
export class KeyRotationService {
  constructor(
    private readonly repository: IKeyRotationRepository,
    private readonly keys: EncryptionKeys,
    private readonly columns: readonly EncryptedColumn[],
    private readonly batchSize: number = DEFAULT_BATCH_SIZE,
  ) {}

  async run(): Promise<KeyRotationReport> {
    const prefix = await currentKeyPrefix(this.keys.current);
    const report: KeyRotationReport = { reEncrypted: 0, failed: 0, remaining: 0 };

    for (const column of this.columns) {
      for (const { id, value } of await this.repository.findStale(column, prefix, this.batchSize)) {
        let next: string;
        try {
          next = await reEncrypt(value, this.keys);
        } catch {
          report.failed++;
          continue;
        }
        if (await this.repository.replace(column, id, value, next)) report.reEncrypted++;
      }
      report.remaining += await this.repository.countStale(column, prefix);
    }

    return report;
  }
}
