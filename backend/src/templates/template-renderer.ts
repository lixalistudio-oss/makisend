/**
 * Placeholder rendering for email templates.
 *
 * Templates store `{{variable}}` markers in subject/html/text. At send time the
 * caller supplies values for exactly those names. Values are HTML-escaped in the
 * HTML rendering (a value like `<script>` must arrive as literal text; the
 * sanitize-html pass in the send pipeline is the second line of defense).
 */

import { AppError } from "@/core/errors";
import {
  hasLineBreak,
  MAX_HTML_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
} from "@/core/validation";

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export interface TemplateContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Unique variable names across all contents, in first-appearance order.
 * Used to validate the request BEFORE rendering (missing => 400).
 */
export function extractVariables(...contents: string[]): string[] {
  const names: string[] = [];
  for (const content of contents) {
    for (const match of content.matchAll(VARIABLE_PATTERN)) {
      const name = match[1];
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replace(content: string, variables: Record<string, string>, escape: boolean): string {
  return content.replace(VARIABLE_PATTERN, (marker, name: string) => {
    const value = variables[name];
    // Unknown variables stay as the raw marker: the controller validates
    // missing names first, so this only protects direct callers.
    if (value === undefined) return marker;
    return escape ? escapeHtml(value) : value;
  });
}

/** Subject and plain-text bodies: values inserted literally, no escaping. */
export function renderTemplate(content: string, variables: Record<string, string>): string {
  return replace(content, variables, false);
}

/** HTML body: values are HTML-escaped before insertion. */
export function renderHtmlTemplate(content: string, variables: Record<string, string>): string {
  return replace(content, variables, true);
}

/**
 * Renders a stored template and enforces the same limits as an inline send.
 * Used by both POST /send-email and the dashboard preview endpoint so the
 * preview and the queued message cannot drift apart.
 */
export function renderTemplateContent(
  template: TemplateContent,
  variables: Record<string, string>,
): TemplateContent {
  const declared = extractVariables(template.subject, template.html, template.text);
  const missing = declared.filter(
    (name) => !Object.prototype.hasOwnProperty.call(variables, name),
  );
  if (missing.length > 0) {
    throw new AppError(400, `Missing template variables: ${missing.join(", ")}`);
  }

  const subject = renderTemplate(template.subject, variables);
  const html = renderHtmlTemplate(template.html, variables);
  const text = renderTemplate(template.text, variables);

  if (hasLineBreak(subject)) {
    throw new AppError(400, "Rendered subject must not contain line breaks.");
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new AppError(
      400,
      `Rendered subject must be at most ${MAX_SUBJECT_LENGTH} characters.`,
    );
  }
  if (html.length > MAX_HTML_LENGTH) {
    throw new AppError(
      400,
      `Rendered HTML must be at most ${MAX_HTML_LENGTH} characters.`,
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new AppError(
      400,
      `Rendered text must be at most ${MAX_TEXT_LENGTH} characters.`,
    );
  }

  return { subject, html, text };
}
