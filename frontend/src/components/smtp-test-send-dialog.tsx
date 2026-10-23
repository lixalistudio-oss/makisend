import { useRef, useState } from "react"
import { CheckCircleIcon, LoaderIcon, PaperclipIcon, SendIcon, XCircleIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { fetchApi } from "@/lib/api"
import { isSendResult, type SendResult } from "@/lib/smtp-form"
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  addAttachments,
  formatBytes,
  toPayload,
  type PickedAttachment,
} from "@/lib/attachments"

const DEFAULT_SUBJECT = "MakiSend test email"
const DEFAULT_TEXT = "This is a test email sent from your MakiSend SMTP configuration."

interface Props {
  /** The saved configuration to send with; null closes the dialog. */
  config: { id: string; smtpHostname: string; senderEmail: string } | null
  onClose: () => void
}

/**
 * Sends one real email through a saved SMTP configuration, to an address the person types.
 * Meant for trying a configuration and for reading what the provider says when it refuses.
 * The sender is always the configuration's own address: it is shown, not editable.
 */
export function SmtpTestSendDialog({ config, onClose }: Props) {
  return (
    <Dialog open={config !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85dvh] gap-3 sm:max-w-[460px] sm:gap-4">
        {/* A new key per configuration: the form starts from its defaults every time. */}
        {config && <TestSendForm key={config.id} config={config} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function TestSendForm({ config, onClose }: { config: NonNullable<Props["config"]>; onClose: () => void }) {
  const [to, setTo] = useState("")
  const [subject, setSubject] = useState(DEFAULT_SUBJECT)
  const [text, setText] = useState(DEFAULT_TEXT)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [errors, setErrors] = useState<{ to?: string; subject?: string; text?: string; attachments?: string }>({})
  const [attachments, setAttachments] = useState<PickedAttachment[]>([])
  const [reading, setReading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const pickFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (fileInput.current) fileInput.current.value = ""
    if (files.length === 0) return
    setReading(true)
    setResult(null)
    try {
      const added = await addAttachments(attachments, files)
      setAttachments(added.attachments)
      setErrors((prev) => ({ ...prev, attachments: added.error ?? undefined }))
    } catch {
      setErrors((prev) => ({ ...prev, attachments: "A file could not be read." }))
    } finally {
      setReading(false)
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
    setErrors((prev) => ({ ...prev, attachments: undefined }))
    setResult(null)
  }

  const send = async () => {
    setSending(true)
    setResult(null)
    setErrors({})
    try {
      const res = await fetchApi(`/smtp-config/${config.id}/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          subject,
          text,
          ...(attachments.length > 0 ? { attachments: toPayload(attachments) } : {}),
        }),
      })
      const data: unknown = await res.json().catch(() => null)
      if (res.status === 400) {
        const raw = (data as { details?: { fieldErrors?: Record<string, string[] | undefined> } } | null)?.details?.fieldErrors
        setErrors({ to: raw?.to?.[0], subject: raw?.subject?.[0], text: raw?.text?.[0], attachments: raw?.attachments?.[0] })
        return
      }
      if (!res.ok || !isSendResult(data)) throw new Error("send failed")
      setResult(data)
    } catch {
      setResult({ ok: false, reason: "unreachable", message: "The send itself could not run. Try again." })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Send a test email</DialogTitle>
        <DialogDescription>
          Sends one real email through {config.smtpHostname}, to see it arrive.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="max-h-[calc(85dvh-16rem)] overflow-y-auto py-1 pr-1 gap-1.5 sm:gap-2">
        <Field>
          <FieldLabel htmlFor="test-from">From</FieldLabel>
          <Input id="test-from" value={config.senderEmail} readOnly disabled />
          <FieldDescription className="text-xs leading-snug sm:text-sm">
            Always the configuration's sender address.
          </FieldDescription>
        </Field>
        <Field data-invalid={!!errors.to}>
          <FieldLabel htmlFor="test-to">To</FieldLabel>
          <Input
            id="test-to"
            type="email"
            placeholder="you@example.com"
            autoComplete="off"
            value={to}
            onChange={(e) => { setTo(e.target.value); setResult(null) }}
            aria-invalid={!!errors.to}
          />
          {errors.to && <FieldError>{errors.to}</FieldError>}
        </Field>
        <Field data-invalid={!!errors.subject}>
          <FieldLabel htmlFor="test-subject">Subject</FieldLabel>
          <Input
            id="test-subject"
            value={subject}
            onChange={(e) => { setSubject(e.target.value); setResult(null) }}
            aria-invalid={!!errors.subject}
          />
          {errors.subject && <FieldError>{errors.subject}</FieldError>}
        </Field>
        <Field data-invalid={!!errors.text}>
          <FieldLabel htmlFor="test-text">Message</FieldLabel>
          <textarea
            id="test-text"
            rows={3}
            value={text}
            onChange={(e) => { setText(e.target.value); setResult(null) }}
            aria-invalid={!!errors.text}
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
          />
          {errors.text && <FieldError>{errors.text}</FieldError>}
        </Field>
        <Field data-invalid={!!errors.attachments}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="test-attachments">Attachments</FieldLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reading || attachments.length >= MAX_ATTACHMENTS}
              onClick={() => fileInput.current?.click()}
            >
              {reading ? <LoaderIcon className="animate-spin" /> : <PaperclipIcon />}
              {reading ? "Reading..." : "Add files"}
            </Button>
          </div>
          <input
            ref={fileInput}
            id="test-attachments"
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => void pickFiles(e.target.files)}
          />
          <FieldDescription className="text-xs leading-snug sm:text-sm">
            Optional. Up to {MAX_ATTACHMENTS} files, {formatBytes(MAX_ATTACHMENT_BYTES)} each.
          </FieldDescription>
          {errors.attachments && <FieldError>{errors.attachments}</FieldError>}
          {attachments.length > 0 && (
            <ul className="flex flex-col gap-1">
              {attachments.map((file, index) => (
                <li
                  key={`${file.filename}-${index}`}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${file.filename}`}
                    onClick={() => removeAttachment(index)}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </FieldGroup>

      {result && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${result.ok ? "border-green-600/40 text-green-700" : "border-destructive/40 text-destructive"}`}
        >
          {result.ok ? <CheckCircleIcon className="mt-0.5 size-4 shrink-0" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0" />}
          <span>
            {result.ok
              ? "The server accepted the message. Check the inbox, and the spam folder if it is not there."
              : result.message}
          </span>
        </div>
      )}

      <DialogFooter className="flex-row justify-end">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={send} disabled={!to.trim() || !subject.trim() || !text.trim() || sending || reading}>
          {sending ? <LoaderIcon className="animate-spin" /> : <SendIcon />}
          {sending ? "Sending..." : "Send test email"}
        </Button>
      </DialogFooter>
    </>
  )
}
