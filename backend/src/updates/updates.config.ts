import type { UpdateSettings, UpdateSource } from "./updates.types";

/** Where official MakiSend releases are published. */
export const DEFAULT_UPSTREAM_REPOSITORY = "lixalistudio-oss/makisend";
/** Where the self-hosting image is published (.github/workflows/docker-publish.yml). */
export const DEFAULT_UPSTREAM_IMAGE = "ghcr.io/lixalistudio-oss/makisend";

const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
/** A registry host has a dot or a port, or is `localhost`: Docker's own rule. */
const REGISTRY_HOST = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?=:))(?::\d{1,5})?$/;
const IMAGE_SEGMENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const IMAGE_TAG = /:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export interface UpdateBindings {
  UPDATE_CHECK?: string;
  UPDATE_SOURCE?: string;
  UPDATE_SOURCE_REPOSITORY?: string;
  UPDATE_SOURCE_IMAGE?: string;
  MAKISEND_REPOSITORY?: string;
}

/** Accepts `owner/name` or a GitHub URL (`https://github.com/owner/name(.git)`). */
export function parseRepository(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const path = trimmed
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  return REPOSITORY.test(path) ? path : null;
}

/**
 * Accepts an image reference the way `docker pull` reads it: `ghcr.io/owner/name`, `owner/name`
 * (Docker Hub), `name` (a Docker Hub official image). A tag or a digest is dropped: the check reads
 * every tag. Answers `host/path`, with Docker Hub spelled `docker.io` and its official images under
 * `library/`. `null` when the value is not an image reference.
 */
export function parseImage(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const segments = trimmed.split("@")[0].split("/");
  const last = segments.length - 1;
  segments[last] = segments[last].replace(IMAGE_TAG, "");

  let host = "docker.io";
  if (segments.length > 1 && REGISTRY_HOST.test(segments[0].toLowerCase())) {
    host = segments.shift()!.toLowerCase();
    if (host === "index.docker.io" || host === "registry-1.docker.io") host = "docker.io";
  }
  if (!segments.every((segment) => IMAGE_SEGMENT.test(segment))) return null;
  if (host === "docker.io" && segments.length === 1) segments.unshift("library");
  return `${host}/${segments.join("/")}`;
}

/**
 * - `UPDATE_CHECK=off` turns the check off: no outbound request, the dashboard shows nothing.
 * - `UPDATE_SOURCE=registry` reads the newest version tag of the image (`UPDATE_SOURCE_IMAGE`,
 *   default the official one) instead of the latest GitHub release. The self-hosting image sets it,
 *   so a release is only announced once its image can be pulled. Anything else, or unset: GitHub.
 * - `UPDATE_SOURCE_REPOSITORY` reads releases (and, with the registry, the release notes) from
 *   another repository (a company fork).
 * - `MAKISEND_REPOSITORY` is the instance's own copy, used to link to its sync workflow. The Deploy
 *   button pre-fills it with the official repository: equal to the upstream, it is not a copy (its
 *   owner cannot run that workflow), so it counts as unset.
 * An invalid repository or image value falls back to the default rather than breaking the dashboard.
 */
export function resolveUpdateSettings(env: UpdateBindings): UpdateSettings {
  const upstreamRepository = parseRepository(env.UPDATE_SOURCE_REPOSITORY) ?? DEFAULT_UPSTREAM_REPOSITORY;
  const ownRepository = parseRepository(env.MAKISEND_REPOSITORY);
  const source: UpdateSource = env.UPDATE_SOURCE?.trim().toLowerCase() === "registry" ? "registry" : "github";
  return {
    enabled: env.UPDATE_CHECK?.trim().toLowerCase() !== "off",
    source,
    upstreamRepository,
    upstreamImage: parseImage(env.UPDATE_SOURCE_IMAGE) ?? DEFAULT_UPSTREAM_IMAGE,
    ownRepository: ownRepository?.toLowerCase() === upstreamRepository.toLowerCase() ? null : ownRepository,
  };
}
