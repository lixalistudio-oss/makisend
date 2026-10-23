import { Fragment, type ReactNode } from "react"
import { PaperclipIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@/lib/attachments"
import { useTranslation, type UiKey } from "@/i18n"

/**
 * Fills the `{name}` placeholders of a translated sentence with React nodes, so inline code
 * (`<code>202</code>`, a link) stays verbatim inside prose that changes with the language.
 */
export function richText(template: string, nodes: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1]
    return <Fragment key={index}>{name !== undefined && name in nodes ? nodes[name] : part}</Fragment>
  })
}

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

const rules: [string, UiKey][] = [
  ["filename", "apiDocs.attachments.ruleFilename"],
  ["content", "apiDocs.attachments.ruleContent"],
  ["content_type", "apiDocs.attachments.ruleContentType"],
  ["path", "apiDocs.attachments.rulePath"],
]

export function AttachmentsDoc({ origin, CodeBlock }: { origin: string; CodeBlock: (props: { code: string; label: string }) => React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PaperclipIcon className="size-4" />
          {t("apiDocs.attachments.title")}
        </CardTitle>
        <CardDescription>
          {t("apiDocs.attachments.description", { count: MAX_ATTACHMENTS })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CodeBlock code={example(origin)} label={t("apiDocs.attachments.exampleLabel")} />
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {rules.map(([field, rule]) => (
            <li key={field}>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{field}</code>{" "}
              {t(rule, { size: MAX_ATTACHMENT_BYTES / 1024 })}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          {richText(t("apiDocs.attachments.storage"), {
            path: <span className="font-medium text-foreground">{t("apiDocs.attachments.testPath")}</span>,
          })}
        </p>
      </CardContent>
    </Card>
  )
}
