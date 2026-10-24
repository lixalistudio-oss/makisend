import { useEffect, useState, type ReactNode } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  InfoIcon,
  KeyRoundIcon,
  MailIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { Toaster } from "@/components/ui/sonner"
import { toast } from "sonner"
import { AttachmentsDoc, richText } from "./api-docs-attachments"
import { useTranslation, type UiKey } from "@/i18n"

type Method = "GET" | "POST" | "PUT" | "DELETE"

const SECTIONS: { id: string; labelKey: UiKey }[] = [
  { id: "overview", labelKey: "apiDocs.section.overview" },
  { id: "quickstart", labelKey: "apiDocs.section.quickstart" },
  { id: "authentication", labelKey: "apiDocs.section.authentication" },
  { id: "sending", labelKey: "apiDocs.section.sending" },
  { id: "lifecycle", labelKey: "apiDocs.section.lifecycle" },
  { id: "smtp", labelKey: "apiDocs.section.smtp" },
  { id: "templates", labelKey: "apiDocs.section.templates" },
  { id: "endpoints", labelKey: "apiDocs.section.endpoints" },
  { id: "errors", labelKey: "apiDocs.section.errors" },
  { id: "security", labelKey: "apiDocs.section.security" },
]

const METHOD_STYLES: Record<Method, string> = {
  GET: "border-border bg-muted text-muted-foreground",
  POST: "border-transparent bg-brand-subtle text-brand-strong",
  PUT: "border-transparent bg-surface-muted text-warning",
  DELETE: "border-transparent bg-surface-muted text-destructive",
}

const STATUS_STYLES: Record<string, string> = {
  received: "border-border bg-muted text-muted-foreground",
  processing: "border-transparent bg-brand-subtle text-brand-strong",
  cleaned: "border-border bg-muted text-muted-foreground",
  attempt_failed: "border-transparent bg-surface-muted text-warning",
  sent: "border-transparent bg-surface-muted text-success",
  failed: "border-transparent bg-surface-muted text-destructive",
}

type Endpoint = { method: Method; path: string; descriptionKey: UiKey }

const ENDPOINT_GROUPS: {
  titleKey: UiKey
  authKey: UiKey
  descriptionKey: UiKey
  endpoints: Endpoint[]
}[] = [
  {
    titleKey: "apiDocs.endpoints.sendingTitle",
    authKey: "apiDocs.auth.apiKey",
    descriptionKey: "apiDocs.endpoints.sendingDescription",
    endpoints: [{ method: "POST", path: "/send-email", descriptionKey: "apiDocs.endpoints.sendEmail" }],
  },
  {
    titleKey: "apiDocs.endpoints.smtpTitle",
    authKey: "apiDocs.auth.session",
    descriptionKey: "apiDocs.endpoints.smtpDescription",
    endpoints: [
      { method: "GET", path: "/smtp-config", descriptionKey: "apiDocs.endpoints.smtpList" },
      { method: "POST", path: "/smtp-config", descriptionKey: "apiDocs.endpoints.smtpCreate" },
      { method: "POST", path: "/smtp-config/check", descriptionKey: "apiDocs.endpoints.smtpCheck" },
      { method: "GET", path: "/smtp-config/{id}", descriptionKey: "apiDocs.endpoints.smtpRead" },
      { method: "PUT", path: "/smtp-config/{id}", descriptionKey: "apiDocs.endpoints.smtpUpdate" },
      { method: "DELETE", path: "/smtp-config/{id}", descriptionKey: "apiDocs.endpoints.smtpDelete" },
      { method: "POST", path: "/smtp-config/{id}/check", descriptionKey: "apiDocs.endpoints.smtpCheckSaved" },
      { method: "POST", path: "/smtp-config/{id}/test-send", descriptionKey: "apiDocs.endpoints.smtpTestSend" },
    ],
  },
  {
    titleKey: "apiDocs.endpoints.apiKeysTitle",
    authKey: "apiDocs.auth.session",
    descriptionKey: "apiDocs.endpoints.apiKeysDescription",
    endpoints: [
      { method: "GET", path: "/api-keys", descriptionKey: "apiDocs.endpoints.apiKeysList" },
      { method: "POST", path: "/api-keys", descriptionKey: "apiDocs.endpoints.apiKeysCreate" },
      { method: "DELETE", path: "/api-keys/{id}", descriptionKey: "apiDocs.endpoints.apiKeysRevoke" },
    ],
  },
  {
    titleKey: "apiDocs.endpoints.templatesTitle",
    authKey: "apiDocs.auth.session",
    descriptionKey: "apiDocs.endpoints.templatesDescription",
    endpoints: [
      { method: "GET", path: "/templates", descriptionKey: "apiDocs.endpoints.templatesList" },
      { method: "POST", path: "/templates", descriptionKey: "apiDocs.endpoints.templatesCreate" },
      { method: "GET", path: "/templates/{id}", descriptionKey: "apiDocs.endpoints.templatesRead" },
      { method: "PUT", path: "/templates/{id}", descriptionKey: "apiDocs.endpoints.templatesUpdate" },
      { method: "DELETE", path: "/templates/{id}", descriptionKey: "apiDocs.endpoints.templatesDelete" },
      { method: "POST", path: "/templates/{id}/preview", descriptionKey: "apiDocs.endpoints.templatesPreview" },
    ],
  },
  {
    titleKey: "apiDocs.endpoints.logsTitle",
    authKey: "apiDocs.auth.session",
    descriptionKey: "apiDocs.endpoints.logsDescription",
    endpoints: [
      { method: "GET", path: "/email-logs", descriptionKey: "apiDocs.endpoints.logsList" },
      { method: "GET", path: "/email-logs/{id}", descriptionKey: "apiDocs.endpoints.logsRead" },
    ],
  },
  {
    titleKey: "apiDocs.endpoints.metricsTitle",
    authKey: "apiDocs.auth.session",
    descriptionKey: "apiDocs.endpoints.metricsDescription",
    endpoints: [
      { method: "GET", path: "/dashboard/stats", descriptionKey: "apiDocs.endpoints.metricsStats" },
      { method: "GET", path: "/dashboard/by-config", descriptionKey: "apiDocs.endpoints.metricsByConfig" },
      { method: "GET", path: "/dashboard/by-api-key", descriptionKey: "apiDocs.endpoints.metricsByApiKey" },
      { method: "GET", path: "/dashboard/recent", descriptionKey: "apiDocs.endpoints.metricsRecent" },
      { method: "GET", path: "/dashboard/errors", descriptionKey: "apiDocs.endpoints.metricsErrors" },
    ],
  },
]

const LIFECYCLE: { status: string; titleKey: UiKey; descriptionKey: UiKey }[] = [
  { status: "received", titleKey: "apiDocs.lifecycle.receivedTitle", descriptionKey: "apiDocs.lifecycle.receivedBody" },
  { status: "processing", titleKey: "apiDocs.lifecycle.processingTitle", descriptionKey: "apiDocs.lifecycle.processingBody" },
  { status: "cleaned", titleKey: "apiDocs.lifecycle.cleanedTitle", descriptionKey: "apiDocs.lifecycle.cleanedBody" },
  { status: "attempt_failed", titleKey: "apiDocs.lifecycle.attemptFailedTitle", descriptionKey: "apiDocs.lifecycle.attemptFailedBody" },
  { status: "sent", titleKey: "apiDocs.lifecycle.sentTitle", descriptionKey: "apiDocs.lifecycle.sentBody" },
  { status: "failed", titleKey: "apiDocs.lifecycle.failedTitle", descriptionKey: "apiDocs.lifecycle.failedBody" },
]

const ERROR_ROWS: { status: string; meaningKey: UiKey; detailKey: UiKey }[] = [
  { status: "202", meaningKey: "apiDocs.errors.202Meaning", detailKey: "apiDocs.errors.202Detail" },
  { status: "400", meaningKey: "apiDocs.errors.400Meaning", detailKey: "apiDocs.errors.400Detail" },
  { status: "401", meaningKey: "apiDocs.errors.401Meaning", detailKey: "apiDocs.errors.401Detail" },
  { status: "403", meaningKey: "apiDocs.errors.403Meaning", detailKey: "apiDocs.errors.403Detail" },
  { status: "404", meaningKey: "apiDocs.errors.404Meaning", detailKey: "apiDocs.errors.404Detail" },
  { status: "409", meaningKey: "apiDocs.errors.409Meaning", detailKey: "apiDocs.errors.409Detail" },
  { status: "500", meaningKey: "apiDocs.errors.500Meaning", detailKey: "apiDocs.errors.500Detail" },
]

/** Header names stay verbatim: `item` is code, `itemKey` is prose. */
const LIMITS: { item?: string; itemKey?: UiKey; limitKey: UiKey }[] = [
  { itemKey: "apiDocs.limits.recipient", limitKey: "apiDocs.limits.recipientLimit" },
  { itemKey: "apiDocs.limits.subject", limitKey: "apiDocs.limits.subjectLimit" },
  { itemKey: "apiDocs.limits.plainText", limitKey: "apiDocs.limits.plainTextLimit" },
  { itemKey: "apiDocs.limits.html", limitKey: "apiDocs.limits.htmlLimit" },
  { itemKey: "apiDocs.limits.attachments", limitKey: "apiDocs.limits.attachmentsLimit" },
  { itemKey: "apiDocs.limits.templateVariables", limitKey: "apiDocs.limits.templateVariablesLimit" },
  { itemKey: "apiDocs.limits.tsxSource", limitKey: "apiDocs.limits.tsxSourceLimit" },
  { item: "Idempotency-Key", limitKey: "apiDocs.limits.idempotencyKeyLimit" },
  { itemKey: "apiDocs.limits.throughput", limitKey: "apiDocs.limits.throughputLimit" },
  { itemKey: "apiDocs.limits.smtpPorts", limitKey: "apiDocs.limits.smtpPortsLimit" },
]

/** Field names and JSON types are code; only the rules are prose. */
const INLINE_FIELDS: { field: string; type?: string; typeKey?: UiKey; ruleKey: UiKey }[] = [
  { field: "to", type: "string", ruleKey: "apiDocs.sending.ruleTo" },
  { field: "subject", type: "string", ruleKey: "apiDocs.sending.ruleSubject" },
  { field: "text", type: "string", ruleKey: "apiDocs.sending.ruleText" },
  { field: "html", type: "string", ruleKey: "apiDocs.sending.ruleHtml" },
  { field: "attachments", typeKey: "apiDocs.sending.typeArrayOptional", ruleKey: "apiDocs.sending.ruleAttachments" },
]

const SECURITY_ITEMS: { titleKey: UiKey; bodyKey: UiKey }[] = [
  { titleKey: "apiDocs.security.encryptedTitle", bodyKey: "apiDocs.security.encryptedBody" },
  { titleKey: "apiDocs.security.passwordTitle", bodyKey: "apiDocs.security.passwordBody" },
  { titleKey: "apiDocs.security.hashedTitle", bodyKey: "apiDocs.security.hashedBody" },
  { titleKey: "apiDocs.security.tlsTitle", bodyKey: "apiDocs.security.tlsBody" },
  { titleKey: "apiDocs.security.htmlTitle", bodyKey: "apiDocs.security.htmlBody" },
  { titleKey: "apiDocs.security.sameOriginTitle", bodyKey: "apiDocs.security.sameOriginBody" },
]

/** Code tokens substituted into translated prose; never translated themselves. */
const CODE_PARAMS = {
  placeholder: "{{variable}}",
  shape: "[{ filename, content (base64), content_type? }]",
  apiKeyHeader: "x-api-key",
  authorizationHeader: "Authorization: Bearer <key>",
  prefix: "mk_",
  secret: "AES_256_KEY",
}

function MethodBadge({ method }: { method: Method }) {
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${METHOD_STYLES[method]}`}>
      {method}
    </Badge>
  )
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
      {children}
    </code>
  )
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success(t("apiDocs.copied"))
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t("apiDocs.copyFailed"))
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/35">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          aria-label={t("apiDocs.copyLabel", { label })}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}

function CodeTabs({ examples }: { examples: { id: string; label: string; code: string }[] }) {
  const { t } = useTranslation()
  const [active, setActive] = useState(examples[0]?.id ?? "")
  const current = examples.find((example) => example.id === active) ?? examples[0]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        {examples.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => setActive(example.id)}
            aria-pressed={active === example.id}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              active === example.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {example.label}
          </button>
        ))}
      </div>
      {current ? (
        <CodeBlock code={current.code} label={t("apiDocs.exampleLabel", { label: current.label })} />
      ) : null}
    </div>
  )
}

function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "success"
  title: ReactNode
  children: ReactNode
}) {
  const styles = {
    info: "border-border bg-surface-muted",
    warning: "border-warning/30 bg-surface-muted",
    success: "border-border bg-surface-muted",
  }[tone]
  const Icon = tone === "warning" ? AlertTriangleIcon : tone === "success" ? ShieldCheckIcon : InfoIcon

  return (
    <div className={`flex gap-3 rounded-xl border p-4 ${styles}`}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1 text-sm">
        <p className="font-medium">{title}</p>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

function DocSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <div className="space-y-1 border-b pb-4">
        <h2 className="text-xl font-medium tracking-tight">{title}</h2>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function EndpointTable({ endpoints }: { endpoints: Endpoint[] }) {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">{t("apiDocs.endpoints.method")}</TableHead>
            <TableHead className="w-64">{t("apiDocs.endpoints.path")}</TableHead>
            <TableHead>{t("apiDocs.endpoints.purpose")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {endpoints.map((endpoint) => (
            <TableRow key={`${endpoint.method} ${endpoint.path}`}>
              <TableCell>
                <MethodBadge method={endpoint.method} />
              </TableCell>
              <TableCell>
                <code className="font-mono text-xs">{endpoint.path}</code>
              </TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">
                {t(endpoint.descriptionKey, CODE_PARAMS)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function QuickstartStep({
  number,
  title,
  description,
  href,
  action,
}: {
  number: string
  title: string
  description: string
  href: string
  action: string
}) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <div className="mb-1 flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
          {number}
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <a href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {action}
          <ArrowRightIcon className="size-3.5" />
        </a>
      </CardContent>
    </Card>
  )
}

export function ApiDocsLayout() {
  const { t } = useTranslation()
  const [origin, setOrigin] = useState("https://your-worker.workers.dev")
  const [activeSection, setActiveSection] = useState("overview")

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActiveSection(visible.target.id)
      },
      { rootMargin: "-15% 0px -75% 0px" },
    )

    for (const section of SECTIONS) {
      const element = document.getElementById(section.id)
      if (element) observer.observe(element)
    }

    return () => observer.disconnect()
  }, [])

  const inlineCurl = `curl -X POST ${origin}/send-email \\
  -H "x-api-key: mk_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "recipient@example.com",
    "subject": "Welcome aboard",
    "text": "Thanks for signing up. Your account is ready.",
    "html": "<h1>Welcome aboard</h1><p>Your account is ready.</p>"
  }'`

  const inlineJs = `const res = await fetch("${origin}/send-email", {
  method: "POST",
  headers: {
    "x-api-key": process.env.MAKISEND_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    to: "recipient@example.com",
    subject: "Welcome aboard",
    text: "Thanks for signing up. Your account is ready.",
    html: "<h1>Welcome aboard</h1><p>Your account is ready.</p>",
  }),
})

if (res.status !== 202) throw new Error(await res.text())
const body = await res.json() // { success, message, emailId }`

  const inlinePython = `import os
import requests

res = requests.post(
    "${origin}/send-email",
    headers={
        "x-api-key": os.environ["MAKISEND_API_KEY"],
        "Content-Type": "application/json",
    },
    json={
        "to": "recipient@example.com",
        "subject": "Welcome aboard",
        "text": "Thanks for signing up. Your account is ready.",
        "html": "<h1>Welcome aboard</h1><p>Your account is ready.</p>",
    },
    timeout=10,
)
res.raise_for_status()  # 202 when queued`

  const templateExample = `{
  "to": "recipient@example.com",
  "templateId": "tpl_your_template_id",
  "variables": {
    "firstName": "Ada",
    "plan": "Pro",
    "invoiceUrl": "https://example.com/invoices/42"
  }
}`

  const idempotencyExample = `curl -X POST ${origin}/send-email \\
  -H "x-api-key: mk_your_api_key" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-42-welcome" \\
  -d '{ ...same JSON body... }'`

  const successExample = `HTTP/1.1 202 Accepted

{
  "success": true,
  "message": "Email queued",
  "emailId": "clx0a1b2c3d4e5f6g7h8i9j0"
}`

  const validationExample = `HTTP/1.1 400 Bad Request

{
  "error": "Validation failed",
  "details": {
    "fieldErrors": {
      "subject": ["Subject must be at least 3 characters."]
    },
    "formErrors": []
  }
}`

  const sendExample = `curl -X POST ${origin}/send-email \\
  -H "x-api-key: mk_your_api_key" \\
  -H "Content-Type: application/json" \\
  --data-binary @email.json`

  return (
    <SidebarProvider>
      <AppSidebar />
      <Toaster position="top-right" />
      <SidebarInset>
        <SiteHeader titleKey="nav.apiReference" />
        <SessionGuard>
          <div className="flex flex-1 flex-col p-4 sm:p-6">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
              <header className="flex flex-col gap-5 border-b pb-8 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono">OpenAPI 3.1</Badge>
                    <Badge variant="secondary">{t("apiDocs.developerGuide")}</Badge>
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-3xl font-medium tracking-tight">{t("apiDocs.title")}</h1>
                    <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {t("apiDocs.intro")}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="/docs"
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <BookOpenIcon />
                    {t("apiDocs.scalarReference")}
                    <ExternalLinkIcon />
                  </a>
                  <a
                    href="/openapi.json"
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    OpenAPI JSON
                    <ExternalLinkIcon />
                  </a>
                </div>
              </header>

              <div className="lg:hidden">
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                  {SECTIONS.map((section) => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      aria-current={activeSection === section.id ? "location" : undefined}
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
                        activeSection === section.id
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {t(section.labelKey)}
                    </a>
                  ))}
                </div>
              </div>

              <div className="grid gap-10 lg:grid-cols-[210px_minmax(0,1fr)]">
                <aside className="hidden lg:block">
                  <nav className="sticky top-6 space-y-1 border-l pl-4">
                    <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                      {t("apiDocs.onThisPage")}
                    </p>
                    {SECTIONS.map((section) => (
                      <a
                        key={section.id}
                        href={`#${section.id}`}
                        aria-current={activeSection === section.id ? "location" : undefined}
                        className={`block py-1 text-sm transition-colors ${
                          activeSection === section.id
                            ? "font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t(section.labelKey)}
                      </a>
                    ))}
                  </nav>
                </aside>

                <div className="min-w-0 space-y-12">
                  <DocSection
                    id="overview"
                    title={t("apiDocs.section.overview")}
                    description={t("apiDocs.overview.description")}
                  >
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Card size="sm">
                        <CardHeader>
                          <MailIcon className="mb-1 size-4 text-muted-foreground" />
                          <CardTitle>{t("apiDocs.overview.smtpTitle")}</CardTitle>
                          <CardDescription>{t("apiDocs.overview.smtpBody")}</CardDescription>
                        </CardHeader>
                      </Card>
                      <Card size="sm">
                        <CardHeader>
                          <KeyRoundIcon className="mb-1 size-4 text-muted-foreground" />
                          <CardTitle>{t("apiDocs.overview.keyTitle")}</CardTitle>
                          <CardDescription>{t("apiDocs.overview.keyBody")}</CardDescription>
                        </CardHeader>
                      </Card>
                      <Card size="sm">
                        <CardHeader>
                          <SendIcon className="mb-1 size-4 text-muted-foreground" />
                          <CardTitle>{t("apiDocs.overview.asyncTitle")}</CardTitle>
                          <CardDescription>{t("apiDocs.overview.asyncBody")}</CardDescription>
                        </CardHeader>
                      </Card>
                    </div>

                    <div className="rounded-xl border bg-muted/25 p-4">
                      <p className="mb-4 text-xs font-medium text-muted-foreground">{t("apiDocs.overview.requestFlow")}</p>
                      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center">
                        {[
                          "POST /send-email",
                          t("apiDocs.overview.flowPendingLog"),
                          "Cloudflare Queue",
                          "Workflow",
                          t("apiDocs.overview.flowSmtpProvider"),
                        ].map((step, index, steps) => (
                          <div key={index} className="flex items-center gap-3 sm:flex-1">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[10px]">
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 font-medium">{step}</span>
                            {index < steps.length - 1 ? (
                              <ArrowRightIcon className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    <Callout tone="info" title={t("apiDocs.overview.noWaitTitle")}>
                      {richText(t("apiDocs.overview.noWaitBody"), {
                        status: <InlineCode>202</InlineCode>,
                        link: (
                          <a href="/dashboard/email-logs" className="font-medium text-foreground underline underline-offset-4">
                            {t("apiDocs.overview.emailLogsLink")}
                          </a>
                        ),
                      })}
                    </Callout>
                  </DocSection>

                  <DocSection
                    id="quickstart"
                    title={t("apiDocs.section.quickstart")}
                    description={t("apiDocs.quickstart.description")}
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <QuickstartStep
                        number="1"
                        title={t("apiDocs.quickstart.step1Title")}
                        description={t("apiDocs.quickstart.step1Body")}
                        href="/dashboard/smtp-config"
                        action={t("apiDocs.quickstart.step1Action")}
                      />
                      <QuickstartStep
                        number="2"
                        title={t("apiDocs.quickstart.step2Title")}
                        description={t("apiDocs.quickstart.step2Body")}
                        href="/dashboard/api-keys"
                        action={t("apiDocs.quickstart.step2Action")}
                      />
                      <QuickstartStep
                        number="3"
                        title={t("apiDocs.quickstart.step3Title")}
                        description={t("apiDocs.quickstart.step3Body")}
                        href="#sending"
                        action={t("apiDocs.quickstart.step3Action")}
                      />
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle>{t("apiDocs.quickstart.baseUrlTitle")}</CardTitle>
                        <CardDescription>{t("apiDocs.quickstart.baseUrlBody")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <CodeBlock code={origin} label={t("apiDocs.quickstart.baseUrlLabel")} />
                      </CardContent>
                    </Card>
                  </DocSection>

                  <DocSection
                    id="authentication"
                    title={t("apiDocs.section.authentication")}
                    description={t("apiDocs.auth.description")}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>{t("apiDocs.auth.apiKey")}</CardTitle>
                          <CardDescription>{t("apiDocs.auth.apiKeyBody")}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <CodeBlock code="x-api-key: mk_your_api_key" label={t("apiDocs.auth.preferredHeader")} />
                          <CodeBlock code="Authorization: Bearer mk_your_api_key" label={t("apiDocs.auth.alternativeHeader")} />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>{t("apiDocs.auth.session")}</CardTitle>
                          <CardDescription>{t("apiDocs.auth.sessionBody")}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>{t("apiDocs.auth.sessionCookie")}</p>
                          <p>
                            {richText(t("apiDocs.auth.authRoutes"), { path: <InlineCode>/api/auth/*</InlineCode> })}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <Callout tone="warning" title={t("apiDocs.auth.keepKeyTitle")}>
                      {t("apiDocs.auth.keepKeyBody")}
                    </Callout>
                  </DocSection>

                  <DocSection
                    id="sending"
                    title={t("apiDocs.section.sending")}
                    description={t("apiDocs.sending.description")}
                  >
                    <Card>
                      <CardHeader>
                        <div className="flex flex-wrap items-center gap-2">
                          <MethodBadge method="POST" />
                          <CardTitle className="font-mono text-sm">/send-email</CardTitle>
                          <Badge variant="secondary">{t("apiDocs.auth.apiKey")}</Badge>
                        </div>
                        <CardDescription>{t("apiDocs.sending.endpointBody")}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="space-y-2">
                          <h3 className="text-sm font-medium">{t("apiDocs.sending.inlineBody")}</h3>
                          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("apiDocs.sending.field")}</TableHead>
                                  <TableHead>{t("apiDocs.sending.type")}</TableHead>
                                  <TableHead>{t("apiDocs.sending.rules")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {INLINE_FIELDS.map(({ field, type, typeKey, ruleKey }) => (
                                  <TableRow key={field}>
                                    <TableCell><InlineCode>{field}</InlineCode></TableCell>
                                    <TableCell className="text-muted-foreground">{typeKey ? t(typeKey) : type}</TableCell>
                                    <TableCell className="whitespace-normal text-muted-foreground">{t(ruleKey, CODE_PARAMS)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>

                        <CodeTabs
                          examples={[
                            { id: "curl", label: "cURL", code: inlineCurl },
                            { id: "js", label: "JavaScript", code: inlineJs },
                            { id: "python", label: "Python", code: inlinePython },
                          ]}
                        />

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <h3 className="text-sm font-medium">{t("apiDocs.sending.success")}</h3>
                            <CodeBlock code={successExample} label={t("apiDocs.sending.successLabel")} />
                          </div>
                          <div className="space-y-2">
                            <h3 className="text-sm font-medium">{t("apiDocs.sending.validationError")}</h3>
                            <CodeBlock code={validationExample} label={t("apiDocs.sending.validationLabel")} />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <AttachmentsDoc origin={origin} CodeBlock={CodeBlock} />

                    <Card>
                      <CardHeader>
                        <CardTitle>{t("apiDocs.idempotency.title")}</CardTitle>
                        <CardDescription>
                          {richText(t("apiDocs.idempotency.description"), {
                            header: <InlineCode>Idempotency-Key</InlineCode>,
                          })}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          {richText(t("apiDocs.idempotency.body"), {
                            conflict: <InlineCode>409</InlineCode>,
                            replayed: <InlineCode>Idempotency-Replayed: true</InlineCode>,
                          })}
                        </p>
                        <CodeBlock code={idempotencyExample} label={t("apiDocs.idempotency.label")} />
                      </CardContent>
                    </Card>
                  </DocSection>

                  <DocSection
                    id="lifecycle"
                    title={t("apiDocs.section.lifecycle")}
                    description={t("apiDocs.lifecycle.description")}
                  >
                    <Card>
                      <CardHeader>
                        <CardTitle>{t("apiDocs.lifecycle.timelineTitle")}</CardTitle>
                        <CardDescription>{t("apiDocs.lifecycle.timelineBody")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ol className="relative ml-2 space-y-5 border-l pl-6">
                          {LIFECYCLE.map((item) => (
                            <li key={item.status} className="relative">
                              <span className="absolute -left-[1.9rem] top-1 size-2.5 rounded-full border-2 border-background bg-muted-foreground" />
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className={`font-mono text-[10px] ${STATUS_STYLES[item.status]}`}>
                                  {item.status}
                                </Badge>
                                <span className="text-sm font-medium">{t(item.titleKey)}</span>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{t(item.descriptionKey)}</p>
                            </li>
                          ))}
                        </ol>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>{t("apiDocs.lifecycle.retriesTitle")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            {richText(t("apiDocs.lifecycle.retriesBody"), {
                              retries: <strong className="text-foreground">{t("apiDocs.lifecycle.retriesCount")}</strong>,
                            })}
                          </p>
                          <p>
                            {richText(t("apiDocs.lifecycle.permanentFailures"), {
                              status: <InlineCode>failed</InlineCode>,
                            })}
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>{t("apiDocs.lifecycle.queueRetriesTitle")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>{t("apiDocs.lifecycle.queueRetriesBody")}</p>
                          <p>{t("apiDocs.lifecycle.instanceId")}</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Callout tone="success" title={t("apiDocs.lifecycle.atLeastOnceTitle")}>
                      {richText(t("apiDocs.lifecycle.atLeastOnceBody"), {
                        header: <InlineCode>Idempotency-Key</InlineCode>,
                      })}
                    </Callout>
                  </DocSection>

                  <DocSection
                    id="smtp"
                    title={t("apiDocs.section.smtp")}
                    description={t("apiDocs.smtp.description")}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>{t("apiDocs.smtp.portsTitle")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            {richText(t("apiDocs.smtp.allowedPorts"), {
                              ports: (
                                <>
                                  <InlineCode>465</InlineCode>, <InlineCode>587</InlineCode>,{" "}
                                  <InlineCode>2465</InlineCode>, <InlineCode>2525</InlineCode>,{" "}
                                  <InlineCode>2587</InlineCode>
                                </>
                              ),
                            })}
                          </p>
                          <p>
                            {richText(t("apiDocs.smtp.tlsModes"), {
                              tls: <InlineCode>tls</InlineCode>,
                              starttls: <InlineCode>starttls</InlineCode>,
                            })}
                          </p>
                          <p>{t("apiDocs.smtp.certificates")}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>{t("apiDocs.smtp.checksTitle")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            {richText(t("apiDocs.smtp.checks"), {
                              check: <InlineCode>/smtp-config/check</InlineCode>,
                              savedCheck: <InlineCode>/smtp-config/{"{id}"}/check</InlineCode>,
                            })}
                          </p>
                          <p>{t("apiDocs.smtp.testSends")}</p>
                          <p>{t("apiDocs.smtp.deliverability")}</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Callout tone="warning" title={t("apiDocs.smtp.inactiveTitle")}>
                      {t("apiDocs.smtp.inactiveBody")}
                    </Callout>
                  </DocSection>

                  <DocSection
                    id="templates"
                    title={t("apiDocs.section.templates")}
                    description={t("apiDocs.templates.description")}
                  >
                    <Card>
                      <CardHeader>
                        <CardTitle>{t("apiDocs.templates.usingTitle")}</CardTitle>
                        <CardDescription>
                          {richText(t("apiDocs.templates.usingBody"), {
                            to: <InlineCode>to</InlineCode>,
                            templateId: <InlineCode>templateId</InlineCode>,
                            variables: <InlineCode>variables</InlineCode>,
                            subject: <InlineCode>subject</InlineCode>,
                            text: <InlineCode>text</InlineCode>,
                            html: <InlineCode>html</InlineCode>,
                          })}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <CodeBlock code={templateExample} label={t("apiDocs.templates.requestLabel")} />
                        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                          <p>
                            {richText(t("apiDocs.templates.compose"), {
                              placeholder: <InlineCode>{"{{variableName}}"}</InlineCode>,
                            })}
                          </p>
                          <p>
                            {richText(t("apiDocs.templates.sandbox"), {
                              preview: <InlineCode>POST /templates/{"{id}"}/preview</InlineCode>,
                            })}
                          </p>
                        </div>
                        <a
                          href="/dashboard/templates"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          {t("apiDocs.templates.manage")}
                          <ArrowRightIcon className="size-3.5" />
                        </a>
                      </CardContent>
                    </Card>
                  </DocSection>

                  <DocSection
                    id="endpoints"
                    title={t("apiDocs.section.endpoints")}
                    description={t("apiDocs.endpoints.description")}
                  >
                    <div className="space-y-6">
                      {ENDPOINT_GROUPS.map((group) => (
                        <div key={group.titleKey} className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-medium">{t(group.titleKey)}</h3>
                            <Badge variant="secondary">{t(group.authKey)}</Badge>
                          </div>
                          <p className="-mt-1 text-sm text-muted-foreground">{t(group.descriptionKey, CODE_PARAMS)}</p>
                          <EndpointTable endpoints={group.endpoints} />
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl border bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm">
                        <p className="font-medium">{t("apiDocs.endpoints.schemasTitle")}</p>
                        <p className="text-muted-foreground">{t("apiDocs.endpoints.schemasBody")}</p>
                      </div>
                      <div className="flex gap-2">
                        <a href="/docs" target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                          {t("apiDocs.endpoints.openScalar")}
                          <ExternalLinkIcon />
                        </a>
                        <a href="/openapi.json" target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                          openapi.json
                          <ExternalLinkIcon />
                        </a>
                      </div>
                    </div>
                  </DocSection>

                  <DocSection
                    id="errors"
                    title={t("apiDocs.section.errors")}
                    description={t("apiDocs.errors.description")}
                  >
                    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-20">{t("apiDocs.errors.status")}</TableHead>
                            <TableHead className="w-48">{t("apiDocs.errors.meaning")}</TableHead>
                            <TableHead>{t("apiDocs.errors.whatToDo")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ERROR_ROWS.map((row) => (
                            <TableRow key={row.status}>
                              <TableCell>
                                <Badge variant="outline" className="font-mono">{row.status}</Badge>
                              </TableCell>
                              <TableCell className="font-medium">{t(row.meaningKey)}</TableCell>
                              <TableCell className="whitespace-normal text-muted-foreground">{t(row.detailKey, CODE_PARAMS)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle>{t("apiDocs.limits.title")}</CardTitle>
                        <CardDescription>{t("apiDocs.limits.description")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-48">{t("apiDocs.limits.item")}</TableHead>
                                <TableHead>{t("apiDocs.limits.limit")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {LIMITS.map(({ item, itemKey, limitKey }) => (
                                <TableRow key={limitKey}>
                                  <TableCell className="font-medium">{itemKey ? t(itemKey) : item}</TableCell>
                                  <TableCell className="whitespace-normal text-muted-foreground">{t(limitKey)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>{t("apiDocs.sendFile.title")}</CardTitle>
                        <CardDescription>{t("apiDocs.sendFile.description")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <CodeBlock code={sendExample} label={t("apiDocs.sendFile.label")} />
                      </CardContent>
                    </Card>
                  </DocSection>

                  <DocSection
                    id="security"
                    title={t("apiDocs.section.security")}
                    description={t("apiDocs.security.description")}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      {SECURITY_ITEMS.map((item) => (
                        <div key={item.titleKey} className="rounded-xl border bg-card p-4">
                          <div className="flex items-center gap-2">
                            <ShieldCheckIcon className="size-4 text-muted-foreground" />
                            <p className="text-sm font-medium">{t(item.titleKey)}</p>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{t(item.bodyKey, CODE_PARAMS)}</p>
                        </div>
                      ))}
                    </div>

                    <Callout tone="warning" title={t("apiDocs.security.rotationTitle", CODE_PARAMS)}>
                      {t("apiDocs.security.rotationBody")}
                    </Callout>
                  </DocSection>
                </div>
              </div>
            </div>
          </div>
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
