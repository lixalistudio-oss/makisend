import { resolveEncryptionKeys } from "@/config/config";
import { pinoLogger } from "@/core/logger";
import type { Bindings } from "@/index";
import { ENCRYPTED_COLUMNS, KeyRotationRepository } from "./key-rotation.repository";
import { KeyRotationService } from "./key-rotation.service";

export { ENCRYPTED_COLUMNS, KeyRotationRepository } from "./key-rotation.repository";
export { KeyRotationService, DEFAULT_BATCH_SIZE } from "./key-rotation.service";

/** Hourly cron expression of the rotation job (wrangler.jsonc `triggers.crons`). */
export const KEY_ROTATION_CRON = "17 * * * *";
export type * from "./key-rotation.types";

/**
 * Cron entrypoint (`triggers.crons` in wrangler.jsonc). Logs one line per run; once
 * `remaining` is 0 and `failed` is 0, ENCRYPTION_KEY_PREVIOUS (and the legacy
 * AES_256_KEY) can be deleted from the Worker.
 */
export async function runKeyRotation(env: Bindings): Promise<void> {
  const service = new KeyRotationService(
    new KeyRotationRepository(env.makisend_db),
    resolveEncryptionKeys(env),
    ENCRYPTED_COLUMNS,
  );
  const report = await service.run();
  if (report.failed > 0) {
    pinoLogger.error(report, "key-rotation: some values could not be decrypted with any configured key");
  } else {
    pinoLogger.info(report, "key-rotation: run complete");
  }
}
