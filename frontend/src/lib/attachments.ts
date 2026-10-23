// Files picked in the dashboard, turned into the `attachments` shape the API takes (Resend's:
// `{ filename, content (base64), content_type? }`). The limits mirror
// backend/src/send-email/attachments.ts: checked here so the person sees why before sending,
// and enforced again by the API.

export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENT_BYTES = 512 * 1024

export interface AttachmentPayload {
  filename: string
  content: string
  content_type?: string
}

export interface PickedAttachment extends AttachmentPayload {
  size: number
}

/** The MIME types the API accepts: `type/subtype`, no parameter. */
const CONTENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/

/** Standard base64, no line breaks, in chunks so large files do not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Adds the picked files to the current list. Returns the new list and, if some files were left
 * out, one sentence that says why: the person learns it before sending, not after a 400.
 */
export async function addAttachments(
  current: PickedAttachment[],
  files: File[],
): Promise<{ attachments: PickedAttachment[]; error: string | null }> {
  const next = [...current]
  const refused: string[] = []

  for (const file of files) {
    if (next.length >= MAX_ATTACHMENTS) {
      refused.push(`at most ${MAX_ATTACHMENTS} files`)
      break
    }
    if (file.size === 0) {
      refused.push(`${file.name} is empty`)
      continue
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      refused.push(`${file.name} is over ${formatBytes(MAX_ATTACHMENT_BYTES)}`)
      continue
    }
    const type = file.type.split(";")[0]?.trim() ?? ""
    next.push({
      filename: file.name,
      content: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      size: file.size,
      ...(CONTENT_TYPE.test(type) ? { content_type: type } : {}),
    })
  }

  return {
    attachments: next,
    error: refused.length > 0 ? `Not added: ${refused.join(", ")}.` : null,
  }
}

/** The request body part: the size is only for the list on screen. */
export function toPayload(attachments: PickedAttachment[]): AttachmentPayload[] {
  return attachments.map(({ size: _size, ...payload }) => payload)
}
