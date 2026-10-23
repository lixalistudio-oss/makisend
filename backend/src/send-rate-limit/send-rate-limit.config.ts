import { AppError } from "@/core/errors";
import type { SendRateLimit } from "./send-rate-limit.types";

const UNITS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
};

const FORMAT = /^(\d+)\s*\/\s*([a-z]+)$/i;

export const INVALID_SEND_RATE_LIMIT =
  "SEND_RATE_LIMIT must look like 100/min (a positive count, then s, min, hour or day)";

/**
 * Parses the optional `SEND_RATE_LIMIT` variable: `<count>/<unit>`, e.g. `100/min`,
 * `5000/day`. Unset or empty means no quota (the default: a self-hosted instance has a
 * single owner). A malformed value fails loudly instead of silently sending unlimited.
 */
export function parseSendRateLimit(raw: string | undefined): SendRateLimit | null {
  const value = raw?.trim();
  if (!value) return null;

  const match = FORMAT.exec(value);
  const max = match ? Number(match[1]) : NaN;
  const windowMs = match ? UNITS[match[2].toLowerCase()] : undefined;
  if (!windowMs || !Number.isSafeInteger(max) || max < 1) {
    throw new AppError(500, INVALID_SEND_RATE_LIMIT);
  }
  return { max, windowMs, label: value.replace(/\s+/g, "") };
}
