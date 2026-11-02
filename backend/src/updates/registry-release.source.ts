import { compareVersions, parseVersion } from "@/core/version";
import { USER_AGENT, type Fetcher } from "./github-release.source";
import type { IReleaseSource, ReleaseInfo } from "./updates.types";

/** Tags per page asked of the registry, and pages read at most (`edge`/`sha-*` tags pile up). */
export const REGISTRY_PAGE_SIZE = 1000;
export const REGISTRY_MAX_PAGES = 20;

/** Release notes for a version, read elsewhere (GitHub): the registry only knows tags. */
export interface IReleaseDetails {
  byTag(tag: string): Promise<ReleaseInfo | null>;
}

interface TagList {
  tags?: unknown;
}

interface TokenResponse {
  token?: unknown;
  access_token?: unknown;
}

/** Docker Hub's API does not live on `docker.io`. */
const apiHost = (host: string): string => (host === "docker.io" ? "registry-1.docker.io" : host);

/** `Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:o/n:pull"` → params. */
function parseChallenge(header: string | null): Record<string, string> | null {
  if (!header || !/^bearer\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const match of header.slice(7).matchAll(/([a-z_]+)="([^"]*)"/gi)) {
    params[match[1].toLowerCase()] = match[2];
  }
  return params.realm ? params : null;
}

/** `</v2/o/n/tags/list?last=0.4.0&n=5>; rel="next"` → absolute URL of the next page. */
function nextPage(link: string | null, base: string): string | null {
  const match = link ? /<([^>]+)>\s*;\s*rel="?next"?/i.exec(link) : null;
  return match ? new URL(match[1], base).toString() : null;
}

/** A stable `x.y.z` (or `vx.y.z`) tag: `latest`, `edge`, `sha-*`, `0.4` and prereleases do not count. */
function stableVersion(tag: string): string | null {
  const parsed = parseVersion(tag);
  return parsed && parsed.prerelease === null && !tag.includes("+") ? parsed.core.join(".") : null;
}

/**
 * Reads the image's tags from its registry (OCI Distribution API, `GET /v2/<name>/tags/list`) and
 * answers the highest stable version tag. A version is only announced once its image exists, so
 * `docker compose pull` gets it. Public images only: the registry's anonymous pull token is asked
 * when it answers 401 (ghcr.io, Docker Hub and most registries do this).
 *
 * The registry knows no release notes: they are read from the matching GitHub release when
 * `details` is given, and their absence (or a GitHub failure) never fails the check.
 */
export class RegistryReleaseSource implements IReleaseSource {
  private readonly host: string;
  private readonly name: string;

  constructor(
    image: string,
    private readonly repository: string,
    private readonly details: IReleaseDetails | null = null,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {
    const slash = image.indexOf("/");
    this.host = image.slice(0, slash);
    this.name = image.slice(slash + 1);
  }

  async latest(): Promise<ReleaseInfo | null> {
    const tags = await this.listTags();
    let latest: string | null = null;
    for (const tag of tags) {
      const version = stableVersion(tag);
      if (version && (latest === null || compareVersions(version, latest) > 0)) latest = version;
    }
    if (latest === null) return null;

    const fallback: ReleaseInfo = {
      version: latest,
      name: null,
      url: `https://github.com/${this.repository}/releases/tag/v${latest}`,
      notes: null,
      publishedAt: null,
    };
    if (!this.details) return fallback;
    try {
      const release = await this.details.byTag(`v${latest}`);
      return release && release.version === latest ? release : fallback;
    } catch {
      // Release notes are a nicety: GitHub down or rate-limited must not hide a pullable image.
      return fallback;
    }
  }

  private async listTags(): Promise<string[]> {
    const base = `https://${apiHost(this.host)}`;
    let url: string | null = `${base}/v2/${this.name}/tags/list?n=${REGISTRY_PAGE_SIZE}`;
    let token: string | null = null;
    const tags: string[] = [];

    for (let page = 0; url && page < REGISTRY_MAX_PAGES; page++) {
      let res = await this.get(url, token);
      if (res.status === 401 && token === null) {
        token = await this.anonymousToken(res.headers.get("www-authenticate"));
        res = await this.get(url, token);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`${this.image} is private or the registry refused anonymous access (HTTP ${res.status})`);
      }
      if (res.status === 404) throw new Error(`${this.image} was not found on ${this.host}`);
      if (res.status === 429) throw new Error(`${this.host} rate limit reached (HTTP 429), retrying at the next check`);
      if (!res.ok) throw new Error(`${this.host} answered HTTP ${res.status}`);

      const body = (await res.json()) as TagList;
      if (Array.isArray(body.tags)) {
        for (const tag of body.tags) if (typeof tag === "string") tags.push(tag);
      }
      url = nextPage(res.headers.get("link"), base);
    }
    return tags;
  }

  private get image(): string {
    return `${this.host}/${this.name}`;
  }

  private get(url: string, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT };
    if (token) headers.Authorization = `Bearer ${token}`;
    return this.fetcher(url, { headers });
  }

  /** Follows the registry's `WWW-Authenticate: Bearer realm=...` challenge without credentials. */
  private async anonymousToken(header: string | null): Promise<string> {
    const challenge = parseChallenge(header);
    if (!challenge) throw new Error(`${this.host} asked for credentials it did not describe (HTTP 401)`);
    const realm = new URL(challenge.realm);
    if (realm.protocol !== "https:") throw new Error(`${this.host} token endpoint is not HTTPS`);
    if (challenge.service) realm.searchParams.set("service", challenge.service);
    realm.searchParams.set("scope", challenge.scope ?? `repository:${this.name}:pull`);

    const res = await this.fetcher(realm.toString(), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`${this.host} refused an anonymous pull token (HTTP ${res.status})`);
    const body = (await res.json()) as TokenResponse;
    const token = typeof body.token === "string" ? body.token : body.access_token;
    if (typeof token !== "string" || !token) throw new Error(`${this.host} returned no pull token`);
    return token;
  }
}
