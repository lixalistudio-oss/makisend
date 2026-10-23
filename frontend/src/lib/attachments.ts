/**
 * Attachments as the dashboard sends them: Resend's shape, the same one `POST /send-email`
 * takes. The limits must match the backend's (`backend/src/send-email/attachments.ts`):
 * they are checked here first so a file that would be refused is named before the send.
 */
import type { Params, UiKey } from "@/i18n"

/** A message to show, as a translation key and its parameters: translated where it is rendered. */
export interface LocalizedMessage {
  key: UiKey
  params?: Params
}

export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENT_BYTES = 512 * 1024
export const MAX_ATTACHMENT_FILENAME_LENGTH = 200

export interface AttachmentPayload {
  filename: string
  /** The file as base64 (standard alphabet, no line break). */
  content: string
  content_type?: string
}

/** `type/subtype` with no parameter: what the backend accepts as `content_type`. */
const CONTENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/

/** Why a file cannot be attached, in words a person can act on; null when it can. */
export function attachmentProblem(file: { name: string; size: number }, alreadyAttached: number): LocalizedMessage | null {
  if (alreadyAttached >= MAX_ATTACHMENTS) return { key: "smtp.attachmentTooMany", params: { max: MAX_ATTACHMENTS } }
  if (file.size === 0) return { key: "smtp.attachmentEmpty", params: { name: file.name } }
  if (file.size > MAX_ATTACHMENT_BYTES) return { key: "smtp.attachmentTooLarge", params: { name: file.name } }
  if (file.name.length > MAX_ATTACHMENT_FILENAME_LENGTH) return { key: "smtp.attachmentNameTooLong", params: { name: file.name.slice(0, 40) } }
  return null
}

/** Base64 of raw bytes, chunked: spreading a large array into `fromCharCode` overflows the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * A browser `File` → the JSON entry. The type is only sent when it is a plain MIME type: a
 * browser may report "" or one with parameters, and the backend then uses its default.
 */
export async function toAttachmentPayload(file: File): Promise<AttachmentPayload> {
  const content = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
  return {
    filename: file.name,
    content,
    ...(CONTENT_TYPE.test(file.type) ? { content_type: file.type } : {}),
  }
}

/** The number is formatted in the page's locale (`1,5 Ko` in French). */
export function formatSize(bytes: number, locale: string): LocalizedMessage {
  if (bytes < 1024) return { key: "smtp.sizeBytes", params: { size: bytes.toLocaleString(locale, { useGrouping: false }) } }
  const digits = bytes < 10 * 1024 ? 1 : 0
  const size = (bytes / 1024).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
  return { key: "smtp.sizeKb", params: { size } }
}
