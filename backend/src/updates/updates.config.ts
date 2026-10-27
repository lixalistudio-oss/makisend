import type { UpdateSettings } from "./updates.types";

/** Where official MakiSend releases are published. */
export const DEFAULT_UPSTREAM_REPOSITORY = "lixalistudio-oss/makisend";

const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export interface UpdateBindings {
  UPDATE_CHECK?: string;
  UPDATE_SOURCE_REPOSITORY?: string;
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
 * - `UPDATE_CHECK=off` turns the check off: no request to GitHub, the dashboard shows nothing.
 * - `UPDATE_SOURCE_REPOSITORY` reads releases from another repository (a company fork).
 * - `MAKISEND_REPOSITORY` is the instance's own copy, used to link to its sync workflow. The Deploy
 *   button pre-fills it with the official repository: equal to the upstream, it is not a copy (its
 *   owner cannot run that workflow), so it counts as unset.
 * An invalid repository value falls back to the default rather than breaking the dashboard.
 */
export function resolveUpdateSettings(env: UpdateBindings): UpdateSettings {
  const upstreamRepository = parseRepository(env.UPDATE_SOURCE_REPOSITORY) ?? DEFAULT_UPSTREAM_REPOSITORY;
  const ownRepository = parseRepository(env.MAKISEND_REPOSITORY);
  return {
    enabled: env.UPDATE_CHECK?.trim().toLowerCase() !== "off",
    upstreamRepository,
    ownRepository: ownRepository?.toLowerCase() === upstreamRepository.toLowerCase() ? null : ownRepository,
  };
}
