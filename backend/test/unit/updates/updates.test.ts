/**
 * New-release check (src/updates) and the version helpers it relies on.
 *
 * ── Failure analysis ──
 *  U1  Versions compared as strings: "0.10.0" < "0.9.0", a prerelease shown as newer than its release.
 *  U2  The build's APP_VERSION drifts from package.json `version`: release.yml tags one number,
 *      the dashboard compares another, and the banner never (or always) shows.
 *  U3  Every dashboard load calls GitHub: unauthenticated limit (60/h/IP) reached, the banner breaks.
 *  U4  "Check now" spammed: same limit reached.
 *  U5  GitHub down or rate-limited: the error replaces the known release, the banner disappears.
 *  U6  UPDATE_CHECK=off still calls GitHub.
 *  U7  The stored row is missing after a check (D1 UPSERT wrong), or a second row appears.
 *  U8  An unexpected tag (not semver) claims an update.
 *  U9  The route is reachable without a session.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { APP_VERSION, compareVersions, normalizeVersion } from "@/core/version";
import { createDatabase } from "@/db/connection";
import { updateCheck } from "@/db/schema";
import { app, type Bindings } from "@/index";
import {
  CHECK_MAX_AGE_MS,
  DEFAULT_UPSTREAM_IMAGE,
  DEFAULT_UPSTREAM_REPOSITORY,
  GitHubReleaseSource,
  MANUAL_CHECK_MIN_INTERVAL_MS,
  MAX_RELEASE_NOTES,
  REGISTRY_MAX_PAGES,
  REGISTRY_PAGE_SIZE,
  RegistryReleaseSource,
  UpdateCheckRepository,
  UpdateService,
  createReleaseSource,
  parseImage,
  parseRepository,
  resolveUpdateSettings,
  type IReleaseDetails,
  type IReleaseSource,
  type IUpdateCheckRepository,
  type ReleaseInfo,
  type UpdateCheckRecord,
  type UpdateSettings,
} from "@/updates";
import { cleanupTestD1, createTestD1 } from "../../helpers/d1-setup";

const here = dirname(fileURLToPath(import.meta.url));

describe("U1 compareVersions", () => {
  it.each([
    ["0.10.0", "0.9.0", 1],
    ["1.0.0", "1.0.0", 0],
    ["v1.2.3", "1.2.3", 0],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0-rc.2", "1.0.0-rc.10", -1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-beta", "1.0.0-alpha", 1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["2.0.0", "1.99.99", 1],
  ])("%s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });

  it("normalises tags and refuses what is not semver", () => {
    expect(normalizeVersion("v0.2.0")).toBe("0.2.0");
    expect(normalizeVersion("1.0.0-rc.1+build.5")).toBe("1.0.0-rc.1");
    expect(normalizeVersion("latest")).toBeNull();
    expect(() => compareVersions("latest", "1.0.0")).toThrow(/semantic version/);
  });
});

describe("U2 APP_VERSION", () => {
  it("equals the root package.json version that release.yml tags", () => {
    const pkg = JSON.parse(readFileSync(join(here, "../../../../package.json"), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(normalizeVersion(APP_VERSION)).toBe(APP_VERSION);
  });
});

describe("settings", () => {
  it("is on by default and reads the official repository", () => {
    expect(resolveUpdateSettings({})).toEqual({
      enabled: true,
      source: "github",
      upstreamRepository: DEFAULT_UPSTREAM_REPOSITORY,
      upstreamImage: DEFAULT_UPSTREAM_IMAGE,
      ownRepository: null,
    });
  });

  it("UPDATE_SOURCE=registry reads the image tags, any other value keeps GitHub", () => {
    expect(resolveUpdateSettings({ UPDATE_SOURCE: " Registry " }).source).toBe("registry");
    expect(resolveUpdateSettings({ UPDATE_SOURCE: "github" }).source).toBe("github");
    expect(resolveUpdateSettings({ UPDATE_SOURCE: "docker" }).source).toBe("github");
    expect(resolveUpdateSettings({ UPDATE_SOURCE_IMAGE: "acme/makisend:1.0.0" }).upstreamImage).toBe(
      "docker.io/acme/makisend",
    );
    expect(resolveUpdateSettings({ UPDATE_SOURCE_IMAGE: "Not An Image" }).upstreamImage).toBe(DEFAULT_UPSTREAM_IMAGE);
  });

  it.each([
    ["ghcr.io/lixalistudio-oss/makisend", "ghcr.io/lixalistudio-oss/makisend"],
    ["ghcr.io/lixalistudio-oss/makisend:latest", "ghcr.io/lixalistudio-oss/makisend"],
    ["GHCR.IO/acme/makisend@sha256:abc", "ghcr.io/acme/makisend"],
    ["acme/makisend", "docker.io/acme/makisend"],
    ["nginx", "docker.io/library/nginx"],
    ["index.docker.io/acme/makisend", "docker.io/acme/makisend"],
    ["localhost:5000/makisend:0.4.0", "localhost:5000/makisend"],
    ["registry.example.com:8443/team/mail/makisend", "registry.example.com:8443/team/mail/makisend"],
  ])("parseImage(%s) = %s", (value, expected) => {
    expect(parseImage(value)).toBe(expected);
  });

  it("parseImage refuses what is not an image reference", () => {
    expect(parseImage("")).toBeNull();
    expect(parseImage("Acme/MakiSend")).toBeNull();
    expect(parseImage("https://ghcr.io/acme/makisend")).toBeNull();
    expect(parseImage("ghcr.io/acme//makisend")).toBeNull();
  });

  it("UPDATE_CHECK=off turns it off, any other value keeps it on", () => {
    expect(resolveUpdateSettings({ UPDATE_CHECK: " OFF " }).enabled).toBe(false);
    expect(resolveUpdateSettings({ UPDATE_CHECK: "on" }).enabled).toBe(true);
  });

  it("accepts owner/name or a GitHub URL, ignores anything else", () => {
    expect(parseRepository("https://github.com/acme/makisend.git")).toBe("acme/makisend");
    expect(parseRepository(" acme/makisend/ ")).toBe("acme/makisend");
    expect(parseRepository("")).toBeNull();
    expect(parseRepository("acme")).toBeNull();
    expect(parseRepository("acme/makisend?x=1")).toBeNull();
    expect(resolveUpdateSettings({ UPDATE_SOURCE_REPOSITORY: "not a repo" }).upstreamRepository).toBe(
      DEFAULT_UPSTREAM_REPOSITORY,
    );
    expect(resolveUpdateSettings({ MAKISEND_REPOSITORY: "acme/mail" }).ownRepository).toBe("acme/mail");
  });

  it("treats MAKISEND_REPOSITORY equal to the upstream (the Deploy button default) as unset", () => {
    expect(resolveUpdateSettings({ MAKISEND_REPOSITORY: DEFAULT_UPSTREAM_REPOSITORY }).ownRepository).toBeNull();
    expect(
      resolveUpdateSettings({ MAKISEND_REPOSITORY: "https://github.com/LixaliStudio-OSS/MakiSend.git" }).ownRepository,
    ).toBeNull();
    expect(
      resolveUpdateSettings({ UPDATE_SOURCE_REPOSITORY: "acme/makisend", MAKISEND_REPOSITORY: "acme/makisend" })
        .ownRepository,
    ).toBeNull();
    expect(
      resolveUpdateSettings({ UPDATE_SOURCE_REPOSITORY: "acme/makisend", MAKISEND_REPOSITORY: DEFAULT_UPSTREAM_REPOSITORY })
        .ownRepository,
    ).toBe(DEFAULT_UPSTREAM_REPOSITORY);
  });

  it("the root wrangler.jsonc pre-fills MAKISEND_REPOSITORY with the official repository", () => {
    const wrangler = readFileSync(join(here, "../../../../wrangler.jsonc"), "utf8");
    expect(wrangler).toContain(`"MAKISEND_REPOSITORY": "${DEFAULT_UPSTREAM_REPOSITORY}"`);
  });
});

describe("GitHubReleaseSource", () => {
  type Call = { url: string; headers: Headers };

  function sourceAnswering(status: number, body: unknown): { source: GitHubReleaseSource; calls: Call[] } {
    const calls: Call[] = [];
    const source = new GitHubReleaseSource("acme/makisend", async (url, init) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      return new Response(JSON.stringify(body), { status });
    });
    return { source, calls };
  }

  it("reads the latest release with a User-Agent (GitHub refuses requests without one)", async () => {
    const { source, calls } = sourceAnswering(200, {
      tag_name: "v0.2.0",
      name: "MakiSend v0.2.0",
      html_url: "https://github.com/acme/makisend/releases/tag/v0.2.0",
      body: "## Changes",
      published_at: "2026-10-20T10:00:00Z",
    });

    const expected: ReleaseInfo = {
      version: "0.2.0",
      name: "MakiSend v0.2.0",
      url: "https://github.com/acme/makisend/releases/tag/v0.2.0",
      notes: "## Changes",
      publishedAt: "2026-10-20T10:00:00Z",
    };
    await expect(source.latest()).resolves.toEqual(expected);
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/makisend/releases/latest");
    expect(calls[0].headers.get("user-agent")).toContain(`MakiSend/${APP_VERSION}`);
  });

  it("answers null when nothing is published yet (404)", async () => {
    await expect(sourceAnswering(404, { message: "Not Found" }).source.latest()).resolves.toBeNull();
  });

  it("names the rate limit when GitHub refuses", async () => {
    await expect(sourceAnswering(403, {}).source.latest()).rejects.toThrow(/rate limit/);
    await expect(sourceAnswering(502, {}).source.latest()).rejects.toThrow(/HTTP 502/);
  });

  it("U8 refuses a tag that is not semver", async () => {
    await expect(sourceAnswering(200, { tag_name: "nightly" }).source.latest()).rejects.toThrow(/semantic version/);
  });

  it("truncates long release notes", async () => {
    const release = await sourceAnswering(200, { tag_name: "1.0.0", body: "x".repeat(MAX_RELEASE_NOTES + 50) }).source.latest();
    expect(release?.notes).toHaveLength(MAX_RELEASE_NOTES + 1);
  });

  it("reads one release by its tag", async () => {
    const { source, calls } = sourceAnswering(200, { tag_name: "v0.4.0", body: "notes" });
    await expect(source.byTag("v0.4.0")).resolves.toMatchObject({ version: "0.4.0", notes: "notes" });
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/makisend/releases/tags/v0.4.0");
  });
});

/**
 * A scripted registry: answers 401 + a Bearer challenge without a token, as ghcr.io and Docker Hub
 * do, hands out an anonymous token, and serves the tags in pages linked by `Link: rel="next"`.
 */
class FakeRegistry {
  calls: { url: string; authorization: string | null }[] = [];
  tokenStatus = 200;
  tagsStatus = 200;

  constructor(
    private readonly pages: string[][],
    private readonly host = "ghcr.io",
    private readonly realm = "https://ghcr.io/token",
  ) {}

  readonly fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    const authorization = new Headers(init?.headers).get("authorization");
    this.calls.push({ url, authorization });
    const parsed = new URL(url);

    if (url.startsWith(this.realm)) {
      return Response.json({ token: "anon-token" }, { status: this.tokenStatus });
    }
    if (parsed.host !== this.host || !parsed.pathname.endsWith("/tags/list")) {
      return new Response("unexpected", { status: 500 });
    }
    if (authorization !== "Bearer anon-token") {
      const scope = `repository:${parsed.pathname.slice(4, -"/tags/list".length)}:pull`;
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer realm="${this.realm}",service="${this.host}",scope="${scope}"` },
      });
    }
    if (this.tagsStatus !== 200) return new Response(null, { status: this.tagsStatus });

    const page = Number(parsed.searchParams.get("page") ?? "0");
    const headers = new Headers();
    if (page + 1 < this.pages.length) {
      headers.set("Link", `<${parsed.pathname}?n=${REGISTRY_PAGE_SIZE}&page=${page + 1}>; rel="next"`);
    }
    return Response.json({ name: parsed.pathname, tags: this.pages[page] }, { headers });
  };
}

class ScriptedDetails implements IReleaseDetails {
  tags: string[] = [];
  constructor(private readonly answer: ReleaseInfo | null | Error) {}
  async byTag(tag: string) {
    this.tags.push(tag);
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

describe("RegistryReleaseSource", () => {
  const image = DEFAULT_UPSTREAM_IMAGE;
  const repository = DEFAULT_UPSTREAM_REPOSITORY;
  const published: ReleaseInfo = {
    version: "0.10.0",
    name: "MakiSend v0.10.0",
    url: `https://github.com/${repository}/releases/tag/v0.10.0`,
    notes: "## Changes",
    publishedAt: "2026-11-01T18:32:10Z",
  };

  it("answers the highest stable version tag, read anonymously across every page", async () => {
    const registry = new FakeRegistry([
      ["edge", "sha-67bb589", "0.9.0", "0.9", "0", "latest"],
      ["0.10.0", "0.10", "0.11.0-rc.1", "v0.2.0"],
    ]);
    const source = new RegistryReleaseSource(image, repository, null, registry.fetcher);

    await expect(source.latest()).resolves.toEqual({
      version: "0.10.0",
      name: null,
      url: `https://github.com/${repository}/releases/tag/v0.10.0`,
      notes: null,
      publishedAt: null,
    });
    const token = registry.calls.find((call) => call.url.startsWith("https://ghcr.io/token"));
    expect(token?.url).toBe(
      "https://ghcr.io/token?service=ghcr.io&scope=repository%3Alixalistudio-oss%2Fmakisend%3Apull",
    );
    const pages = registry.calls.filter((call) => call.url.includes("/tags/list") && call.authorization);
    expect(pages.map((call) => new URL(call.url).searchParams.get("page"))).toEqual([null, "1"]);
  });

  it("adds the matching GitHub release notes", async () => {
    const details = new ScriptedDetails(published);
    const registry = new FakeRegistry([["0.10.0", "latest"]]);
    await expect(new RegistryReleaseSource(image, repository, details, registry.fetcher).latest()).resolves.toEqual(
      published,
    );
    expect(details.tags).toEqual(["v0.10.0"]);
  });

  it("still announces a pullable image when GitHub fails or has no such release", async () => {
    const registry = new FakeRegistry([["0.10.0"]]);
    for (const details of [new ScriptedDetails(new Error("GitHub rate limit")), new ScriptedDetails(null)]) {
      const release = await new RegistryReleaseSource(image, repository, details, registry.fetcher).latest();
      expect(release).toMatchObject({ version: "0.10.0", notes: null });
    }
  });

  it("U8 an image with no stable version tag announces nothing", async () => {
    const registry = new FakeRegistry([["edge", "latest", "sha-1", "1.0.0-rc.1"]]);
    await expect(new RegistryReleaseSource(image, repository, null, registry.fetcher).latest()).resolves.toBeNull();
  });

  it("reads Docker Hub images on registry-1.docker.io", async () => {
    const registry = new FakeRegistry([["1.0.0"]], "registry-1.docker.io", "https://auth.docker.io/token");
    const source = new RegistryReleaseSource("docker.io/acme/makisend", "acme/makisend", null, registry.fetcher);
    await expect(source.latest()).resolves.toMatchObject({ version: "1.0.0" });
    expect(registry.calls[0].url).toBe(`https://registry-1.docker.io/v2/acme/makisend/tags/list?n=${REGISTRY_PAGE_SIZE}`);
  });

  it("names why it could not read the tags", async () => {
    const read = (registry: FakeRegistry) => new RegistryReleaseSource(image, repository, null, registry.fetcher).latest();

    const missing = new FakeRegistry([[]]);
    missing.tagsStatus = 404;
    await expect(read(missing)).rejects.toThrow(/not found on ghcr\.io/);

    const privateImage = new FakeRegistry([[]]);
    privateImage.tokenStatus = 403;
    await expect(read(privateImage)).rejects.toThrow(/anonymous pull token \(HTTP 403\)/);

    const limited = new FakeRegistry([[]]);
    limited.tagsStatus = 429;
    await expect(read(limited)).rejects.toThrow(/rate limit/);
  });

  it(`stops after ${REGISTRY_MAX_PAGES} pages`, async () => {
    const registry = new FakeRegistry(Array.from({ length: REGISTRY_MAX_PAGES + 5 }, (_, i) => [`0.0.${i}`]));
    const release = await new RegistryReleaseSource(image, repository, null, registry.fetcher).latest();
    expect(release?.version).toBe(`0.0.${REGISTRY_MAX_PAGES - 1}`);
  });
});

describe("createReleaseSource", () => {
  it("picks the registry only when UPDATE_SOURCE=registry", () => {
    expect(createReleaseSource(resolveUpdateSettings({ UPDATE_SOURCE: "registry" }))).toBeInstanceOf(
      RegistryReleaseSource,
    );
    expect(createReleaseSource(resolveUpdateSettings({}))).toBeInstanceOf(GitHubReleaseSource);
  });

  it("the self-hosting image turns the registry check on", () => {
    const dockerfile = readFileSync(join(here, "../../../../docker/Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/UPDATE_SOURCE=registry/);
  });
});

/** In-memory storage and a scripted release source: the service needs nothing else. */
class MemoryRepository implements IUpdateCheckRepository {
  record: UpdateCheckRecord | null = null;
  async get() {
    return this.record;
  }
  async save(record: UpdateCheckRecord) {
    this.record = record;
  }
}

class ScriptedSource implements IReleaseSource {
  calls = 0;
  constructor(public next: ReleaseInfo | null | Error) {}
  async latest() {
    this.calls++;
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

const release = (version: string): ReleaseInfo => ({
  version,
  name: `MakiSend v${version}`,
  url: `https://github.com/lixalistudio-oss/makisend/releases/tag/v${version}`,
  notes: "notes",
  publishedAt: "2026-10-20T10:00:00Z",
});

describe("UpdateService", () => {
  const settings: UpdateSettings = {
    enabled: true,
    source: "github",
    upstreamRepository: DEFAULT_UPSTREAM_REPOSITORY,
    upstreamImage: DEFAULT_UPSTREAM_IMAGE,
    ownRepository: null,
  };
  let clock: number;
  let repository: MemoryRepository;
  let source: ScriptedSource;
  const service = (overrides: Partial<UpdateSettings> = {}, current = "0.1.0") =>
    new UpdateService(repository, source, { ...settings, ...overrides }, current, () => clock);

  beforeEach(() => {
    clock = Date.UTC(2026, 9, 23, 12);
    repository = new MemoryRepository();
    source = new ScriptedSource(release("0.2.0"));
  });

  it("reports a newer release with its link", async () => {
    const status = await service().getStatus();
    expect(status).toMatchObject({
      enabled: true,
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/lixalistudio-oss/makisend/releases/tag/v0.2.0",
      checkedAt: new Date(clock).toISOString(),
      error: null,
      syncWorkflowUrl: null,
    });
  });

  it("says nothing when the instance runs the latest release or a newer build", async () => {
    expect((await service({}, "0.2.0").getStatus()).updateAvailable).toBe(false);
    expect((await service({}, "0.3.0-rc.1").getStatus()).updateAvailable).toBe(false);
  });

  it("U3 serves the stored result for a day, then refreshes it", async () => {
    await service().getStatus();
    clock += CHECK_MAX_AGE_MS - 1;
    await service().getStatus();
    expect(source.calls).toBe(1);

    clock += 1;
    source.next = release("0.3.0");
    expect((await service().getStatus()).latestVersion).toBe("0.3.0");
    expect(source.calls).toBe(2);
  });

  it("U4 'Check now' refreshes, but not twice within five minutes", async () => {
    await service().getStatus();
    await service().getStatus({ force: true });
    expect(source.calls).toBe(1);

    clock += MANUAL_CHECK_MIN_INTERVAL_MS;
    await service().getStatus({ force: true });
    expect(source.calls).toBe(2);
  });

  it("U5 keeps the known release when a check fails, and says why", async () => {
    await service().getStatus();
    source.next = new Error("GitHub rate limit reached (HTTP 403), retrying at the next check");
    clock += CHECK_MAX_AGE_MS;

    const status = await service().getStatus();
    expect(status).toMatchObject({ latestVersion: "0.2.0", updateAvailable: true });
    expect(status.error).toMatch(/rate limit/);
  });

  it("no published release yet: no update, no error", async () => {
    source.next = null;
    expect(await service().getStatus()).toMatchObject({ latestVersion: null, updateAvailable: false, error: null });
  });

  it("U6 UPDATE_CHECK=off never calls the source, on the dashboard or from the cron", async () => {
    const off = service({ enabled: false });
    expect(await off.getStatus({ force: true })).toMatchObject({ enabled: false, updateAvailable: false, latestVersion: null });
    expect(await off.scheduledCheck()).toBeNull();
    expect(source.calls).toBe(0);
  });

  it("U8 a stored value that is not semver never claims an update", async () => {
    repository.record = {
      latestVersion: "garbage",
      releaseName: null,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      checkedAt: clock,
      error: null,
    };
    expect((await service().getStatus()).updateAvailable).toBe(false);
  });

  it("links the Update button to the instance's sync workflow when its repository is known", async () => {
    const status = await service({ ownRepository: "acme/mail" }).getStatus();
    expect(status.syncWorkflowUrl).toBe("https://github.com/acme/mail/actions/workflows/sync-upstream.yml");
  });

  it("on the Docker image, names the image and offers no sync workflow (updating means pulling)", async () => {
    const status = await service({ source: "registry", ownRepository: "acme/mail" }).getStatus();
    expect(status).toMatchObject({
      source: "registry",
      upstreamImage: DEFAULT_UPSTREAM_IMAGE,
      syncWorkflowUrl: null,
      updateAvailable: true,
    });
    expect((await service().getStatus()).upstreamImage).toBeNull();
  });
});

describe("U7 UpdateCheckRepository (real D1)", () => {
  let mf: Miniflare;
  let repository: UpdateCheckRepository;
  let d1: D1Database;

  beforeEach(async () => {
    const setup = await createTestD1();
    mf = setup.mf;
    d1 = setup.d1;
    repository = new UpdateCheckRepository(createDatabase(d1));
  });

  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  it("stores one row and overwrites it", async () => {
    expect(await repository.get()).toBeNull();

    const first: UpdateCheckRecord = {
      latestVersion: "0.2.0",
      releaseName: "MakiSend v0.2.0",
      releaseUrl: "https://example.com/r",
      releaseNotes: "notes",
      publishedAt: "2026-10-20T10:00:00Z",
      checkedAt: 1,
      error: null,
    };
    await repository.save(first);
    await repository.save({ ...first, latestVersion: "0.3.0", checkedAt: 2, error: "boom" });

    expect(await repository.get()).toEqual({ ...first, latestVersion: "0.3.0", checkedAt: 2, error: "boom" });
    expect(await createDatabase(d1).select().from(updateCheck)).toHaveLength(1);
  });
});

describe("U9 GET /updates/status", () => {
  it("requires a dashboard session", async () => {
    const mfSetup = await createTestD1();
    try {
      const env = {
        ENCRYPTION_KEY: "a".repeat(64),
        BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
        BETTER_AUTH_URL: "http://localhost:8787",
        FRONTEND_URL: "http://localhost:4321",
        RATE_LIMIT: "off",
        UPDATE_CHECK: "off",
        makisend_db: mfSetup.d1,
      } satisfies Partial<Bindings>;
      const res = await app.request("/updates/status", undefined, env);
      expect(res.status).toBe(401);
    } finally {
      await cleanupTestD1(mfSetup.mf);
    }
  });
});
