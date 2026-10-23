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
  DEFAULT_UPSTREAM_REPOSITORY,
  GitHubReleaseSource,
  MANUAL_CHECK_MIN_INTERVAL_MS,
  MAX_RELEASE_NOTES,
  UpdateCheckRepository,
  UpdateService,
  parseRepository,
  resolveUpdateSettings,
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
      upstreamRepository: DEFAULT_UPSTREAM_REPOSITORY,
      ownRepository: null,
    });
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
  const settings: UpdateSettings = { enabled: true, upstreamRepository: DEFAULT_UPSTREAM_REPOSITORY, ownRepository: null };
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
