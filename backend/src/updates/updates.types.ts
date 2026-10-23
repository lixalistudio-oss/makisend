/** The latest published MakiSend release, as read from the upstream repository. */
export interface ReleaseInfo {
  /** Normalised semver, without the `v` prefix (`0.2.0`). */
  version: string;
  name: string | null;
  url: string;
  notes: string | null;
  publishedAt: string | null;
}

/** Stored result of the last check (table `update_check`, one row). */
export interface UpdateCheckRecord {
  latestVersion: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  /** Epoch milliseconds. */
  checkedAt: number;
  /** Why the last check failed, `null` when it succeeded. The previous release is kept. */
  error: string | null;
}

export interface IUpdateCheckRepository {
  get(): Promise<UpdateCheckRecord | null>;
  save(record: UpdateCheckRecord): Promise<void>;
}

export interface IReleaseSource {
  /** `null` when the repository has published no release yet. Throws on any other failure. */
  latest(): Promise<ReleaseInfo | null>;
}

export interface UpdateSettings {
  /** `false` when the instance owner turned the check off (`UPDATE_CHECK=off`). */
  enabled: boolean;
  /** Upstream repository the releases are read from, `owner/name`. */
  upstreamRepository: string;
  /** The instance's own copy of the repository (`MAKISEND_REPOSITORY`), when it is known. */
  ownRepository: string | null;
}

/** What `GET /updates/status` answers. */
export interface UpdateStatus {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseName: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  /** ISO date of the last check, `null` when none ran yet. */
  checkedAt: string | null;
  error: string | null;
  upstreamRepository: string;
  /** Page that runs the sync workflow in the instance's own repository, when it is known. */
  syncWorkflowUrl: string | null;
}
