/**
 * Shared limits for request payloads.
 *
 * Values are deliberately generous for normal use but bounded so a single
 * request cannot turn into an oversized queue message, a broken email header,
 * or an unbounded database row.
 */
export const MAX_EMAIL_LENGTH = 320;
export const MAX_SUBJECT_LENGTH = 500;
export const MAX_ID_LENGTH = 128;
export const MAX_NAME_LENGTH = 100;
export const MAX_TEXT_LENGTH = 20_000;
export const MAX_HTML_LENGTH = 100_000;

export const MAX_SMTP_HOSTNAME_LENGTH = 253;
export const MAX_SMTP_USERNAME_LENGTH = 320;
export const MAX_SMTP_PASSWORD_LENGTH = 4_096;

export const MAX_TEMPLATE_VARIABLES = 50;
export const MAX_TEMPLATE_VARIABLE_NAME_LENGTH = 64;
export const MAX_TEMPLATE_VARIABLE_VALUE_LENGTH = 10_000;

/** Header values must never contain CR/LF: a newline would let a variable or a
 * template create additional SMTP headers. */
export function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}
