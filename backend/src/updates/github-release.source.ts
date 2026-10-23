import { APP_VERSION, normalizeVersion } from "@/core/version";
import type { IReleaseSource, ReleaseInfo } from "./updates.types";

/** Release notes are shown in a dashboard dialog: keep the row and the response small. */
export const MAX_RELEASE_NOTES = 4000;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/**
 * Reads `GET /repos/{repo}/releases/latest` from the public GitHub API: the newest release
 * that is neither a draft nor a prerelease. No token: the repository must be public, and the
 * call is unauthenticated (60 requests per hour per IP), which is why the result is stored
 * and refreshed at most daily.
 */
export class GitHubReleaseSource implements IReleaseSource {
  constructor(
    private readonly repository: string,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}

  async latest(): Promise<ReleaseInfo | null> {
    const res = await this.fetcher(`https://api.github.com/repos/${this.repository}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        // GitHub refuses requests without a User-Agent.
        "User-Agent": `MakiSend/${APP_VERSION} (update check)`,
      },
    });

    // 404: no published release yet (or a private repository, which looks the same).
    if (res.status === 404) return null;
    if (!res.ok) {
      const limited = res.status === 403 || res.status === 429;
      throw new Error(
        limited
          ? `GitHub rate limit reached (HTTP ${res.status}), retrying at the next check`
          : `GitHub answered HTTP ${res.status}`,
      );
    }

    const release = (await res.json()) as GitHubRelease;
    const tag = asString(release.tag_name);
    const version = tag ? normalizeVersion(tag) : null;
    if (!version) {
      throw new Error(`Latest release tag is not a semantic version: ${tag ?? "(none)"}`);
    }

    const notes = asString(release.body);
    return {
      version,
      name: asString(release.name),
      url: asString(release.html_url) ?? `https://github.com/${this.repository}/releases/tag/${tag}`,
      notes: notes && notes.length > MAX_RELEASE_NOTES ? `${notes.slice(0, MAX_RELEASE_NOTES)}…` : notes,
      publishedAt: asString(release.published_at),
    };
  }
}
