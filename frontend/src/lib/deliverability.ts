import type { Params, UiKey } from "@/i18n"

/** GET /smtp-config/:id/dns-check (backend/src/smtp-config/dns-check.ts). */
export type DnsCheckStatus = "pass" | "warn" | "fail" | "unknown"

export interface DnsCheckItem {
  status: DnsCheckStatus
  code: string
  message: string
  record?: string
  selector?: string
  policy?: string
  recordDomain?: string
}

export interface DnsCheckResult {
  domain: string
  spf: DnsCheckItem
  dkim: DnsCheckItem
  dmarc: DnsCheckItem
  mx: DnsCheckItem
  checkedAt: string
}

export const DNS_RECORDS = [
  { id: "spf", label: "deliverability.recordSpf" },
  { id: "dkim", label: "deliverability.recordDkim" },
  { id: "dmarc", label: "deliverability.recordDmarc" },
  { id: "mx", label: "deliverability.recordMx" },
] as const satisfies readonly { id: keyof Omit<DnsCheckResult, "domain" | "checkedAt">; label: UiKey }[]

export const STATUS_LABELS = {
  pass: "deliverability.statusPass",
  warn: "deliverability.statusWarn",
  fail: "deliverability.statusFail",
  unknown: "deliverability.statusUnknown",
} as const satisfies Record<DnsCheckStatus, UiKey>

/** Status colors from the design tokens, always shown with their word. */
export const STATUS_CLASSES: Record<DnsCheckStatus, string> = {
  pass: "text-success",
  warn: "text-warning",
  fail: "text-destructive",
  unknown: "text-muted-foreground",
}

const CODE_KEYS = {
  spf_ok: "deliverability.code.spf_ok",
  spf_missing: "deliverability.code.spf_missing",
  spf_multiple: "deliverability.code.spf_multiple",
  spf_allows_all: "deliverability.code.spf_allows_all",
  spf_weak: "deliverability.code.spf_weak",
  dkim_ok: "deliverability.code.dkim_ok",
  dkim_missing: "deliverability.code.dkim_missing",
  dkim_revoked: "deliverability.code.dkim_revoked",
  dkim_selector_unknown: "deliverability.code.dkim_selector_unknown",
  dmarc_ok: "deliverability.code.dmarc_ok",
  dmarc_missing: "deliverability.code.dmarc_missing",
  dmarc_monitoring: "deliverability.code.dmarc_monitoring",
  dmarc_invalid: "deliverability.code.dmarc_invalid",
  mx_ok: "deliverability.code.mx_ok",
  mx_missing: "deliverability.code.mx_missing",
  lookup_failed: "deliverability.code.lookup_failed",
} as const satisfies Record<string, UiKey>

/**
 * The translated explanation of a check, or the backend's English message for a code this
 * build does not know yet (a newer backend): never an empty line.
 */
export function describeCheck(
  item: DnsCheckItem,
  domain: string,
  t: (key: UiKey, params?: Params) => string,
): string {
  const key = (CODE_KEYS as Record<string, UiKey | undefined>)[item.code]
  if (!key) return item.message
  return t(key, { selector: item.selector ?? "", policy: item.policy ?? "", domain })
}

/** The DNS name a record lives at, to publish or fix it (MX has none to show). */
export function recordHost(id: (typeof DNS_RECORDS)[number]["id"], result: DnsCheckResult): string | null {
  switch (id) {
    case "spf":
      return result.domain
    case "dkim":
      return result.dkim.selector ? `${result.dkim.selector}._domainkey.${result.domain}` : null
    case "dmarc":
      return `_dmarc.${result.dmarc.recordDomain ?? result.domain}`
    default:
      return null
  }
}

export function isDnsCheckResult(value: unknown): value is DnsCheckResult {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.domain === "string" && DNS_RECORDS.every(({ id }) => typeof (v[id] as DnsCheckItem | undefined)?.status === "string")
}

/** Same rule as the backend DTO: one or more DNS labels. */
export const DKIM_SELECTOR_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/

/** GET /suppressions. */
export interface Suppression {
  id: string
  email: string
  source: "bounce" | "manual"
  reason: string
  emailId: string | null
  createdAt: string
}

/** Default reason the backend stores for a manual entry without one (MANUAL_SUPPRESSION_REASON). */
export const MANUAL_DEFAULT_REASON = "Added from the dashboard"

/** The status codes of a bounce reason ("... (550 5.1.1)."), or null. */
export function bounceCodes(reason: string): string | null {
  return /\(([0-9. ]+)\)\.?$/.exec(reason)?.[1]?.trim() || null
}

/** A suppression's reason in the person's language; a reason typed by hand is shown as written. */
export function describeSuppression(entry: Suppression, t: (key: UiKey, params?: Params) => string): string {
  if (entry.source === "bounce") {
    const codes = bounceCodes(entry.reason)
    return codes ? t("deliverability.bounceReason", { codes }) : t("deliverability.bounceReasonNoCodes")
  }
  return entry.reason === MANUAL_DEFAULT_REASON ? t("deliverability.manualReason") : entry.reason
}
