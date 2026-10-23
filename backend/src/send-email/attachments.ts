import { z } from "zod";

/**
 * Attachments on `POST /send-email`, in **Resend's shape** (`attachments[]` with `filename`,
 * `content` as base64 and an optional `content_type`), so a client written for Resend's API
 * sends the same JSON here. Only inline content is accepted: Resend's `path` (a URL to fetch)
 * is refused, MakiSend never fetches a third-party URL on a caller's behalf.
 *
 * The decoded bytes are stored AES-GCM encrypted in D1 (`email_attachments`), never in the
 * queue or in workflow state, like the bodies. The cap keeps one attachment row under D1's
 * 2 MB row limit: the file is stored as base64 (x4/3), then encrypted as hex (x2), so
 * 512 KB raw becomes ~1.37 MB.
 */
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_ATTACHMENT_FILENAME_LENGTH = 200;
export const DEFAULT_ATTACHMENT_CONTENT_TYPE = "application/octet-stream";

/** Strict base64 (standard alphabet, optional padding). Whitespace is not tolerated. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** A MIME type: `type/subtype`, no parameters, no spaces, no line break. */
const CONTENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

/** Bytes a base64 string decodes to, without decoding it. */
export function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

export const AttachmentDto = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1, { message: "Attachment filename cannot be empty." })
      .max(MAX_ATTACHMENT_FILENAME_LENGTH, {
        message: `Attachment filename must be at most ${MAX_ATTACHMENT_FILENAME_LENGTH} characters.`,
      })
      // A filename lands in a MIME header: a control character (CR/LF above all) could add a
      // header, a slash names a path. Refused, not cleaned: the caller learns its name is wrong.
      .refine((value) => ![...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || ch === "/" || ch === "\\"), {
        message: "Attachment filename must not contain control characters or path separators.",
      }),
    content: z
      .string()
      .min(1, { message: "Attachment content cannot be empty." })
      .refine((value) => value.length % 4 === 0 && BASE64.test(value), {
        message: "Attachment content must be base64.",
      })
      .refine((value) => decodedLength(value) <= MAX_ATTACHMENT_BYTES, {
        message: `Attachment must be at most ${MAX_ATTACHMENT_BYTES} bytes.`,
      }),
    content_type: z
      .string()
      .trim()
      .max(255)
      .refine((value) => CONTENT_TYPE.test(value), {
        message: "Attachment content_type must be a MIME type such as application/pdf.",
      })
      .optional(),
  })
  .strict();

export const AttachmentsDto = z
  .array(AttachmentDto)
  .max(MAX_ATTACHMENTS, { message: `At most ${MAX_ATTACHMENTS} attachments per email.` });

export type AttachmentDto = z.infer<typeof AttachmentDto>;

/** A decoded attachment, as the transports take it. */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A validated DTO entry → the transports' shape (bytes, a content type always set). */
export function toEmailAttachment(dto: AttachmentDto): EmailAttachment {
  return {
    filename: dto.filename,
    contentType: dto.content_type ?? DEFAULT_ATTACHMENT_CONTENT_TYPE,
    content: decodeBase64(dto.content),
  };
}
