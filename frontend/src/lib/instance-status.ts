import { fetchApi } from "@/lib/api"

/**
 * The Worker cannot run without a valid `ENCRYPTION_KEY`. Every API call then answers 500 with
 * one of these codes, and `GET /api/setup-status` reports it as `configError`: the dashboard
 * sends the owner to `ENCRYPTION_KEY_PAGE`, which explains how to generate a key, rather than
 * to a sign-in form that can only fail.
 */
export type ConfigErrorCode = "ENCRYPTION_KEY_MISSING" | "ENCRYPTION_KEY_INVALID"

export interface ConfigError {
  code: ConfigErrorCode
  /** Names of the offending secrets (never their values). */
  variables: string[]
}

export interface SetupStatus {
  needsSetup: boolean
  configError?: ConfigError
}

export const ENCRYPTION_KEY_PAGE = "/encryption-key"

const CONFIG_ERROR_CODES: readonly string[] = ["ENCRYPTION_KEY_MISSING", "ENCRYPTION_KEY_INVALID"]

export function isConfigErrorCode(code: unknown): code is ConfigErrorCode {
  return typeof code === "string" && CONFIG_ERROR_CODES.includes(code)
}

/** `null` when the status cannot be read (network error, older backend). */
export async function fetchSetupStatus(): Promise<SetupStatus | null> {
  try {
    const res = await fetchApi("/api/setup-status")
    if (!res.ok) return null
    return (await res.json()) as SetupStatus
  } catch {
    return null
  }
}

export function goToEncryptionKeyPage() {
  window.location.replace(ENCRYPTION_KEY_PAGE)
}

/**
 * For an API error body (`{ error, code }`): sends the owner to the encryption key page when the
 * failure comes from the key. Returns true when it redirected.
 */
export function redirectOnConfigError(body: unknown): boolean {
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined
  if (!isConfigErrorCode(code)) return false
  goToEncryptionKeyPage()
  return true
}
