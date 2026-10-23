import { APP_VERSION, compareVersions } from "@/core/version";
import type {
  IReleaseSource,
  IUpdateCheckRepository,
  ReleaseInfo,
  UpdateCheckRecord,
  UpdateSettings,
  UpdateStatus,
} from "./updates.types";

/** A stored result younger than this is served as is; older, the dashboard refreshes it. */
export const CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** "Check now" cannot hit GitHub more often than this (unauthenticated: 60 requests/hour/IP). */
export const MANUAL_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Tells the instance owner when a newer MakiSend release is published. Knows nothing about
 * Hono or GitHub's HTTP API: the release source and the storage are injected.
 */
export class UpdateService {
  constructor(
    private readonly repository: IUpdateCheckRepository,
    private readonly source: IReleaseSource,
    private readonly settings: UpdateSettings,
    private readonly currentVersion: string = APP_VERSION,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Asks the release source and stores the answer. A failure is stored too (with the
   * previously known release kept), so the dashboard can say why it could not check.
   */
  async check(): Promise<UpdateCheckRecord> {
    const previous = await this.repository.get();
    let record: UpdateCheckRecord;
    try {
      const release = await this.source.latest();
      record = toRecord(release, this.now());
    } catch (error) {
      record = {
        latestVersion: previous?.latestVersion ?? null,
        releaseName: previous?.releaseName ?? null,
        releaseUrl: previous?.releaseUrl ?? null,
        releaseNotes: previous?.releaseNotes ?? null,
        publishedAt: previous?.publishedAt ?? null,
        checkedAt: this.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await this.repository.save(record);
    return record;
  }

  /** Cron entrypoint: checks unless the owner turned the check off. */
  async scheduledCheck(): Promise<UpdateCheckRecord | null> {
    if (!this.settings.enabled) return null;
    return this.check();
  }

  /**
   * What the dashboard shows. Serves the stored result, refreshing it first when there is
   * none or it is older than a day; `force` ("Check now") refreshes unless the last check
   * is less than five minutes old.
   */
  async getStatus(options: { force?: boolean } = {}): Promise<UpdateStatus> {
    if (!this.settings.enabled) return this.toStatus(null);

    let record = await this.repository.get();
    const age = record ? this.now() - record.checkedAt : Infinity;
    const stale = age >= CHECK_MAX_AGE_MS;
    const forced = options.force === true && age >= MANUAL_CHECK_MIN_INTERVAL_MS;
    if (stale || forced) record = await this.check();

    return this.toStatus(record);
  }

  private toStatus(record: UpdateCheckRecord | null): UpdateStatus {
    const latest = record?.latestVersion ?? null;
    return {
      enabled: this.settings.enabled,
      currentVersion: this.currentVersion,
      latestVersion: latest,
      updateAvailable: latest !== null && isNewer(latest, this.currentVersion),
      releaseName: record?.releaseName ?? null,
      releaseUrl: record?.releaseUrl ?? null,
      releaseNotes: record?.releaseNotes ?? null,
      publishedAt: record?.publishedAt ?? null,
      checkedAt: record ? new Date(record.checkedAt).toISOString() : null,
      error: record?.error ?? null,
      upstreamRepository: this.settings.upstreamRepository,
      syncWorkflowUrl: this.settings.ownRepository
        ? `https://github.com/${this.settings.ownRepository}/actions/workflows/sync-upstream.yml`
        : null,
    };
  }
}

function toRecord(release: ReleaseInfo | null, checkedAt: number): UpdateCheckRecord {
  return {
    latestVersion: release?.version ?? null,
    releaseName: release?.name ?? null,
    releaseUrl: release?.url ?? null,
    releaseNotes: release?.notes ?? null,
    publishedAt: release?.publishedAt ?? null,
    checkedAt,
    error: null,
  };
}

/** A stored value that is not semver never claims an update. */
function isNewer(latest: string, current: string): boolean {
  try {
    return compareVersions(latest, current) > 0;
  } catch {
    return false;
  }
}
