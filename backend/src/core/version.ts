/**
 * Version of this MakiSend build. Must equal `version` in the root package.json, which the
 * release workflow (.github/workflows/release.yml) turns into the `v<version>` tag and GitHub
 * release; test/unit/updates/version.test.ts fails when the two drift apart.
 */
export const APP_VERSION = "0.2.1";

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string | null;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses `1.2.3`, `v1.2.3`, `1.2.3-beta.1` (build metadata ignored). `null` when it is not semver. */
export function parseVersion(value: string): ParsedVersion | null {
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/** Normalised `x.y.z[-pre]`, without the `v` prefix. `null` when it is not semver. */
export function normalizeVersion(value: string): string | null {
  const parsed = parseVersion(value);
  if (!parsed) return null;
  const core = parsed.core.join(".");
  return parsed.prerelease ? `${core}-${parsed.prerelease}` : core;
}

/**
 * Semver ordering: negative when `a < b`, 0 when equal, positive when `a > b`. A prerelease
 * sorts before its release (`1.0.0-rc.1 < 1.0.0`); prerelease identifiers compare numerically
 * when both are numbers, as strings otherwise. Throws on a value that is not semver.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Not a semantic version: ${!left ? a : b}`);

  for (let i = 0; i < 3; i++) {
    const diff = left.core[i] - right.core[i];
    if (diff !== 0) return diff;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;

  const l = left.prerelease.split(".");
  const r = right.prerelease.split(".");
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    if (l[i] === undefined) return -1;
    if (r[i] === undefined) return 1;
    const ln = /^\d+$/.test(l[i]) ? Number(l[i]) : null;
    const rn = /^\d+$/.test(r[i]) ? Number(r[i]) : null;
    if (ln !== null && rn !== null) {
      if (ln !== rn) return ln - rn;
    } else if (ln !== null) {
      return -1;
    } else if (rn !== null) {
      return 1;
    } else if (l[i] !== r[i]) {
      return l[i] < r[i] ? -1 : 1;
    }
  }
  return 0;
}
