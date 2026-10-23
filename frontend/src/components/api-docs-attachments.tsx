import { PaperclipIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@/lib/attachments"

/**
 * The `attachments` field of POST /send-email, for the API reference page. Kept apart from the
 * page itself so the page does not grow; the limits come from `lib/attachments.ts`, the same
 * numbers the test-send dialog enforces.
 */
const example = (origin: string) => `curl -X POST ${origin}/send-email \\
  -H "x-api-key: mk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "buyer@example.com",
    "subject": "Your receipt REC-1",
    "text": "Thanks for your purchase. The receipt is attached.",
    "html": "<p>Thanks for your purchase. The receipt is attached.</p>",
    "attachments": [
      { "filename": "receipt-REC-1.pdf", "content": "JVBERi0xLjQK...", "content_type": "application/pdf" }
    ]
  }'`

const rules: [string, string][] = [
  ["filename", "1 to 200 characters. No control character (a line break would add a header) and no / or \\."],
  ["content", `The file as base64, standard alphabet, no line break. At most ${MAX_ATTACHMENT_BYTES / 1024} KB once decoded.`],
  ["content_type", "Optional. A MIME type without parameter (application/pdf); application/octet-stream otherwise."],
  ["path", "Refused. Resend accepts a URL to fetch; MakiSend fetches no URL on your behalf."],
]

export function AttachmentsDoc({ origin, CodeBlock }: { origin: string; CodeBlock: (props: { code: string; label: string }) => React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PaperclipIcon className="size-4" />
          Attachments
        </CardTitle>
        <CardDescription>
          Optional on both shapes (inline content and templateId). The same JSON as Resend&apos;s API, so a client
          written for Resend sends it unchanged. At most {MAX_ATTACHMENTS} files per email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CodeBlock code={example(origin)} label="attachments example" />
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {rules.map(([field, rule]) => (
            <li key={field}>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{field}</code> {rule}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Files are stored encrypted, never travel through the queue and are deleted with the email. To try one before
          integrating, open <span className="font-medium text-foreground">SMTP Config → Send test email</span> and
          attach it: the same limits apply.
        </p>
      </CardContent>
    </Card>
  )
}
