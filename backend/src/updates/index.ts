import { pinoLogger } from "@/core/logger";
import { createDatabase } from "@/db/connection";
import type { Bindings } from "@/index";
import { GitHubReleaseSource } from "./github-release.source";
import { resolveUpdateSettings } from "./updates.config";
import { UpdateCheckRepository } from "./updates.repository";
import { UpdateService } from "./updates.service";

export { UpdateService, CHECK_MAX_AGE_MS, MANUAL_CHECK_MIN_INTERVAL_MS } from "./updates.service";
export { UpdateCheckRepository } from "./updates.repository";
export { GitHubReleaseSource, MAX_RELEASE_NOTES } from "./github-release.source";
export { resolveUpdateSettings, parseRepository, DEFAULT_UPSTREAM_REPOSITORY } from "./updates.config";
export { createUpdatesController } from "./updates.controller";
export type * from "./updates.types";

/** Builds the service from the Worker bindings (entrypoint and cron only). */
export function createUpdateService(env: Bindings): UpdateService {
  const settings = resolveUpdateSettings(env);
  return new UpdateService(
    new UpdateCheckRepository(createDatabase(env.makisend_db)),
    new GitHubReleaseSource(settings.upstreamRepository),
    settings,
  );
}

/** Daily cron: refreshes the stored "latest release" so the dashboard opens without waiting. */
export async function runUpdateCheck(env: Bindings): Promise<void> {
  const record = await createUpdateService(env).scheduledCheck();
  if (!record) return;
  if (record.error) {
    pinoLogger.warn({ error: record.error }, "update-check: could not read the latest release");
  } else {
    pinoLogger.info({ latest: record.latestVersion }, "update-check: done");
  }
}
