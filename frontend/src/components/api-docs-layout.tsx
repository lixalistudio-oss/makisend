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
import { Toaster, toast } from "sonner"
import { AttachmentsDoc } from "./api-docs-attachments"

type Method = "GET" | "POST" | "PUT" | "DELETE"

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "authentication", label: "Authentication" },
  { id: "sending", label: "Sending email" },
  { id: "lifecycle", label: "Delivery lifecycle" },
  { id: "smtp", label: "SMTP & deliverability" },
  { id: "templates", label: "Templates" },
  { id: "endpoints", label: "Endpoint reference" },
  { id: "errors", label: "Errors & limits" },
  { id: "security", label: "Security" },
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

const ENDPOINT_GROUPS: {
  title: string
  auth: string
  description: string
  endpoints: { method: Method; path: string; description: string }[]
}[] = [
  {
    title: "Sending",
    auth: "API key",
    description: "The public API used by your backend.",
    endpoints: [
      {
        method: "POST",
        path: "/send-email",
        description: "Queue an inline email or a stored template. Returns 202 with an emailId.",
      },
    ],
  },
  {
    title: "SMTP configurations",
    auth: "Dashboard session",
    description: "Manage the SMTP accounts used to deliver email.",
    endpoints: [
      { method: "GET", path: "/smtp-config", description: "List the current user's SMTP configurations." },
      { method: "POST", path: "/smtp-config", description: "Create a configuration. Secrets are encrypted at rest." },
      { method: "POST", path: "/smtp-config/check", description: "Test credentials before saving them." },
      { method: "GET", path: "/smtp-config/{id}", description: "Read one configuration. The password is never returned." },
      { method: "PUT", path: "/smtp-config/{id}", description: "Update a configuration, including its active state." },
      { method: "DELETE", path: "/smtp-config/{id}", description: "Delete a configuration and the API keys linked to it." },
      { method: "POST", path: "/smtp-config/{id}/check", description: "Test a saved configuration." },
      { method: "POST", path: "/smtp-config/{id}/test-send", description: "Send a test email, optionally with attachments (same shape as /send-email). It shows in the logs as a test, never in the dashboard totals." },
    ],
  },
  {
    title: "API keys",
    auth: "Dashboard session",
    description: "Each key is linked to exactly one SMTP configuration.",
    endpoints: [
      { method: "GET", path: "/api-keys", description: "List key metadata. Secrets are never listed." },
      { method: "POST", path: "/api-keys", description: "Create a key linked to an SMTP configuration (several keys can share one). The full key is returned only once." },
      { method: "DELETE", path: "/api-keys/{id}", description: "Revoke a key." },
    ],
  },
  {
    title: "Templates",
    auth: "Dashboard session",
    description: "Reusable React Email content with {{variable}} placeholders.",
    endpoints: [
      { method: "GET", path: "/templates", description: "List templates." },
      { method: "POST", path: "/templates", description: "Create a template." },
      { method: "GET", path: "/templates/{id}", description: "Read one template." },
      { method: "PUT", path: "/templates/{id}", description: "Update a template." },
      { method: "DELETE", path: "/templates/{id}", description: "Delete a template." },
      { method: "POST", path: "/templates/{id}/preview", description: "Render a template with sample variables." },
    ],
  },
  {
    title: "Email logs",
    auth: "Dashboard session",
    description: "Read the delivery history stored in D1.",
    endpoints: [
      {
        method: "GET",
        path: "/email-logs",
        description: "Paginated logs. Filters: status, smtpConfigId, apiKeyId, to, limit, cursor.",
      },
      { method: "GET", path: "/email-logs/{id}", description: "One log with its complete attempt history." },
    ],
  },
  {
    title: "Dashboard metrics",
    auth: "Dashboard session",
    description: "Aggregated data used by the dashboard cards and charts.",
    endpoints: [
      { method: "GET", path: "/dashboard/stats", description: "Totals, failures and success rate of API sends. Query: days, apiKeyId (optional)." },
      { method: "GET", path: "/dashboard/by-config", description: "Per-SMTP-config delivery breakdown. Query: days." },
      { method: "GET", path: "/dashboard/by-api-key", description: "Sent, delivered, failed, average duration and last use for each API key. Query: days." },
      { method: "GET", path: "/dashboard/recent", description: "Most recent sends. Query: limit." },
      { method: "GET", path: "/dashboard/errors", description: "Frequent delivery errors. Query: days, limit, apiKeyId (optional)." },
    ],
  },
]

const LIFECYCLE = [
  {
    status: "received",
    title: "Workflow started",
    description: "The queue consumer created one durable Workflow instance for this email.",
  },
  {
    status: "processing",
    title: "Preparing the message",
    description: "The workflow loaded the encrypted body from D1 and rebuilt the email.",
  },
  {
    status: "cleaned",
    title: "HTML sanitized",
    description: "The HTML passed through the allowlist sanitizer before any SMTP attempt.",
  },
  {
    status: "attempt_failed",
    title: "An attempt failed",
    description: "A transient SMTP failure was recorded. The next attempt is scheduled automatically.",
  },
  {
    status: "sent",
    title: "Accepted by SMTP",
    description: "The provider accepted the message. This means sent, not necessarily delivered to the inbox.",
  },
  {
    status: "failed",
    title: "Delivery abandoned",
    description: "The retry budget was exhausted or the error was permanent. The email is dead-lettered.",
  },
]

const ERROR_ROWS = [
  {
    status: "202",
    meaning: "Accepted",
    detail: "The email is queued. Use the returned emailId to follow it in Email Logs.",
  },
  {
    status: "400",
    meaning: "Validation failed",
    detail: "Invalid body, unknown field, mixed inline/template payload, or invalid Idempotency-Key.",
  },
  {
    status: "401",
    meaning: "Missing API key",
    detail: "Send x-api-key or Authorization: Bearer <key>.",
  },
  {
    status: "403",
    meaning: "Key rejected",
    detail: "The key is invalid or disabled, or its SMTP configuration is inactive.",
  },
  {
    status: "404",
    meaning: "Resource not found",
    detail: "Template, SMTP configuration, or email log not found or owned by another user.",
  },
  {
    status: "409",
    meaning: "Idempotency conflict",
    detail: "The same Idempotency-Key is already in progress or was used with a different body.",
  },
  {
    status: "500",
    meaning: "Internal error",
    detail: "The send request was not accepted. Retrying with the same Idempotency-Key is safe.",
  },
]

const LIMITS: [string, string][] = [
  ["Recipient", "Valid email address, up to 320 characters."],
  ["Subject", "Inline sends: 3 to 500 characters. Templates: 1 to 500. No line breaks."],
  ["Plain text", "10 to 20,000 characters for inline sends; 1 to 20,000 for templates."],
  ["HTML", "1 to 100,000 characters. Sanitized before sending."],
  ["Attachments", "Up to 5 files per email, 512 KB each once decoded, base64 in the JSON body."],
  ["Template variables", "Up to 50 variables; names up to 64 chars, values up to 10,000 chars."],
  ["TSX source", "1 to 100,000 characters for pasted React Email code."],
  ["Idempotency-Key", "1 to 255 visible ASCII characters; replay window 24 hours."],
  ["API key throughput", "No daily or monthly quota per key. The real ceiling is your SMTP provider's own limits."],
  ["SMTP ports", "465, 587, 2465, 2525 or 2587. Port 25 is blocked on Workers."],
]

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
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success("Copied to clipboard")
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy to the clipboard")
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
          aria-label={`Copy ${label}`}
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
      {current ? <CodeBlock code={current.code} label={`${current.label} example`} /> : null}
    </div>
  )
}

function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "success"
  title: string
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

function EndpointTable({
  endpoints,
}: {
  endpoints: { method: Method; path: string; description: string }[]
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Method</TableHead>
            <TableHead className="w-64">Path</TableHead>
            <TableHead>Purpose</TableHead>
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
              <TableCell className="whitespace-normal text-muted-foreground">{endpoint.description}</TableCell>
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
                    <Badge variant="secondary">Developer guide</Badge>
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-3xl font-medium tracking-tight">API reference</h1>
                    <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                      Send transactional email from your backend through your own SMTP account.
                      This guide covers authentication, request shapes, the asynchronous delivery
                      lifecycle, SMTP behavior, and the full endpoint surface.
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
                    Scalar reference
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
                      {section.label}
                    </a>
                  ))}
                </div>
              </div>

              <div className="grid gap-10 lg:grid-cols-[210px_minmax(0,1fr)]">
                <aside className="hidden lg:block">
                  <nav className="sticky top-6 space-y-1 border-l pl-4">
                    <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                      On this page
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
                        {section.label}
                      </a>
                    ))}
                  </nav>
                </aside>

                <div className="min-w-0 space-y-12">
                  <DocSection
                    id="overview"
                    title="Overview"
                    description="MakiSend is a transactional email API running on a single Cloudflare Worker. The Worker serves both this dashboard and the API on the same origin."
                  >
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Card size="sm">
                        <CardHeader>
                          <MailIcon className="mb-1 size-4 text-muted-foreground" />
                          <CardTitle>Your SMTP account</CardTitle>
                          <CardDescription>Credentials stay encrypted in D1 and are never returned by the API.</CardDescription>
                        </CardHeader>
                      </Card>
                      <Card size="sm">
                        <CardHeader>
                          <KeyRoundIcon className="mb-1 size-4 text-muted-foreground" />
                          <CardTitle>One key per config</CardTitle>
                          <CardDescription>An API key selects the SMTP configuration used for each send.</CardDescription>
                        </CardHeader>
                      </Card>
                      <Card size="sm">
                        <CardHeader>
                          <SendIcon className="mb-1 size-4 text-muted-foreground" />
                          <CardTitle>Async by design</CardTitle>
                          <CardDescription>The API returns 202 immediately; delivery continues in a durable workflow.</CardDescription>
                        </CardHeader>
                      </Card>
                    </div>

                    <div className="rounded-xl border bg-muted/25 p-4">
                      <p className="mb-4 text-xs font-medium text-muted-foreground">Request flow</p>
                      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center">
                        {["POST /send-email", "D1 pending log", "Cloudflare Queue", "Workflow", "SMTP provider"].map(
                          (step, index, steps) => (
                            <div key={step} className="flex items-center gap-3 sm:flex-1">
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[10px]">
                                {index + 1}
                              </span>
                              <span className="min-w-0 flex-1 font-medium">{step}</span>
                              {index < steps.length - 1 ? (
                                <ArrowRightIcon className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
                              ) : null}
                            </div>
                          ),
                        )}
                      </div>
                    </div>

                    <Callout tone="info" title="The API does not wait for delivery">
                      A <InlineCode>202</InlineCode> means the email is stored and queued. Open{" "}
                      <a href="/dashboard/email-logs" className="font-medium text-foreground underline underline-offset-4">
                        Email logs
                      </a>{" "}
                      to follow its status and failure history.
                    </Callout>
                  </DocSection>

                  <DocSection
                    id="quickstart"
                    title="Quickstart"
                    description="Connect an SMTP account, create an API key for it, then send your first message."
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <QuickstartStep
                        number="1"
                        title="Connect SMTP"
                        description="Add your provider hostname, port, TLS mode, credentials, and sender address."
                        href="/dashboard/smtp-config"
                        action="Open SMTP configuration"
                      />
                      <QuickstartStep
                        number="2"
                        title="Create an API key"
                        description="Link the key to the SMTP configuration. Copy it when it is shown; it cannot be recovered."
                        href="/dashboard/api-keys"
                        action="Open API keys"
                      />
                      <QuickstartStep
                        number="3"
                        title="Send a request"
                        description="POST to /send-email with your key and a JSON body. A 202 means it is queued."
                        href="#sending"
                        action="See an example"
                      />
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle>Base URL</CardTitle>
                        <CardDescription>
                          Every API request uses this origin. The dashboard and the API share it in production.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <CodeBlock code={origin} label="base URL" />
                      </CardContent>
                    </Card>
                  </DocSection>

                  <DocSection
                    id="authentication"
                    title="Authentication"
                    description="The public send endpoint accepts a per-user API key. Dashboard routes use a Better Auth session cookie instead."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>API key</CardTitle>
                          <CardDescription>For server-to-server requests to POST /send-email.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <CodeBlock code="x-api-key: mk_your_api_key" label="preferred header" />
                          <CodeBlock code="Authorization: Bearer mk_your_api_key" label="alternative header" />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Dashboard session</CardTitle>
                          <CardDescription>For the configuration, template, log, and metrics routes.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            Sign in through the dashboard and the browser sends the Better Auth session
                            cookie automatically. Do not use dashboard routes from a server with an API key.
                          </p>
                          <p>
                            Auth routes live under <InlineCode>/api/auth/*</InlineCode>.
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <Callout tone="warning" title="Keep the key on your server">
                      The full key is shown once at creation. Store it in a secret manager or server-side
                      environment variable. Never ship it in browser code, a mobile app, or a public repository.
                    </Callout>
                  </DocSection>

                  <DocSection
                    id="sending"
                    title="Sending email"
                    description="POST /send-email accepts either inline content or a template reference, never both. Unknown fields are rejected."
                  >
                    <Card>
                      <CardHeader>
                        <div className="flex flex-wrap items-center gap-2">
                          <MethodBadge method="POST" />
                          <CardTitle className="font-mono text-sm">/send-email</CardTitle>
                          <Badge variant="secondary">API key</Badge>
                        </div>
                        <CardDescription>
                          Queues the message and returns immediately. The response includes an emailId for tracking.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="space-y-2">
                          <h3 className="text-sm font-medium">Inline body</h3>
                          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Field</TableHead>
                                  <TableHead>Type</TableHead>
                                  <TableHead>Rules</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {[
                                  ["to", "string", "Valid recipient email address, up to 320 characters."],
                                  ["subject", "string", "3 to 500 characters; no line breaks."],
                                  ["text", "string", "Plain-text body, 10 to 20,000 characters."],
                                  ["html", "string", "HTML body, 1 to 100,000 characters; sanitized before sending."],
                                  ["attachments", "array, optional", "Resend's shape: [{ filename, content (base64), content_type? }]. See Attachments below."],
                                ].map(([field, type, rule]) => (
                                  <TableRow key={field}>
                                    <TableCell><InlineCode>{field}</InlineCode></TableCell>
                                    <TableCell className="text-muted-foreground">{type}</TableCell>
                                    <TableCell className="whitespace-normal text-muted-foreground">{rule}</TableCell>
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
                            <h3 className="text-sm font-medium">Success</h3>
                            <CodeBlock code={successExample} label="202 response" />
                          </div>
                          <div className="space-y-2">
                            <h3 className="text-sm font-medium">Validation error</h3>
                            <CodeBlock code={validationExample} label="400 response" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <AttachmentsDoc origin={origin} CodeBlock={CodeBlock} />

                    <Card>
                      <CardHeader>
                        <CardTitle>Idempotency</CardTitle>
                        <CardDescription>
                          Add an <InlineCode>Idempotency-Key</InlineCode> header when a timeout could make
                          your client retry the same send.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          The same key and identical body replay the original response for 24 hours. Reusing
                          the key with a different body, or while the first request is still running, returns{" "}
                          <InlineCode>409</InlineCode>. Successful replays include{" "}
                          <InlineCode>Idempotency-Replayed: true</InlineCode>.
                        </p>
                        <CodeBlock code={idempotencyExample} label="idempotent request" />
                      </CardContent>
                    </Card>
                  </DocSection>

                  <DocSection
                    id="lifecycle"
                    title="Delivery lifecycle"
                    description="After the 202, the queue consumer starts a durable workflow. Every transition is appended to the email history."
                  >
                    <Card>
                      <CardHeader>
                        <CardTitle>Status timeline</CardTitle>
                        <CardDescription>A send can visit these states, in this order.</CardDescription>
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
                                <span className="text-sm font-medium">{item.title}</span>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                            </li>
                          ))}
                        </ol>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>Retries</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            One initial SMTP attempt plus <strong className="text-foreground">3 retries</strong>,
                            30 seconds apart. Transient failures stay inside the same workflow run.
                          </p>
                          <p>
                            Permanent failures (auth, TLS, DNS, configuration, 5xx SMTP status) stop immediately.
                            When the budget is exhausted, the email becomes <InlineCode>failed</InlineCode> and
                            is published to the dead-letter queue.
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Queue-level retries</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            If the Queue consumer cannot start the workflow itself, Cloudflare retries with
                            exponential backoff. After the queue retry budget, a failed history row is written
                            and the message moves to the DLQ.
                          </p>
                          <p>
                            The workflow instance id is the emailId, so a duplicate queue delivery cannot start
                            a second run for the same email.
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <Callout tone="success" title="At-least-once delivery">
                      SMTP has no idempotency contract. If the provider accepts a message but MakiSend cannot
                      record the receipt, a duplicate is possible. Use a stable <InlineCode>Idempotency-Key</InlineCode>{" "}
                      on your HTTP request to prevent duplicate submissions.
                    </Callout>
                  </DocSection>

                  <DocSection
                    id="smtp"
                    title="SMTP & deliverability"
                    description="MakiSend connects directly to the SMTP provider configured for the API key. There is no shared relay."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>Ports and TLS</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            Allowed ports: <InlineCode>465</InlineCode>, <InlineCode>587</InlineCode>,{" "}
                            <InlineCode>2465</InlineCode>, <InlineCode>2525</InlineCode>,{" "}
                            <InlineCode>2587</InlineCode>. Port 25 is blocked by Cloudflare Workers.
                          </p>
                          <p>
                            Ports 465 and 2465 default to implicit <InlineCode>tls</InlineCode>; the other
                            ports default to <InlineCode>starttls</InlineCode>. The mode can be chosen explicitly.
                          </p>
                          <p>
                            TLS certificates are verified. Hostnames are resolved and connected socket-by-socket;
                            private and local IPv4 targets are rejected.
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Checks and health</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            Use <InlineCode>/smtp-config/check</InlineCode> before saving credentials, or{" "}
                            <InlineCode>/smtp-config/{"{id}"}/check</InlineCode> for a saved config.
                          </p>
                          <p>
                            Test sends exercise the full SMTP path but are not written to Email Logs. A daily
                            cron checks every saved configuration and stores the latest result.
                          </p>
                          <p>
                            Deliverability still depends on your provider and domain: configure SPF, DKIM, and
                            DMARC with your SMTP provider.
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <Callout tone="warning" title="Inactive configurations">
                      An inactive SMTP configuration cannot send. A request whose key points to an inactive
                      config is rejected with 403; a workflow resolving an explicitly inactive config gets 409.
                      Health checks and test sends remain available so the configuration can be repaired.
                    </Callout>
                  </DocSection>

                  <DocSection
                    id="templates"
                    title="Templates"
                    description="Templates keep content reusable while variables personalize each send. The dashboard supports the full React Email visual builder (inspector, themes, export) and pasted TSX code; both store the exported HTML/text, and content is rendered before the email enters the queue."
                  >
                    <Card>
                      <CardHeader>
                        <CardTitle>Using a template</CardTitle>
                        <CardDescription>
                          Send <InlineCode>to</InlineCode>, <InlineCode>templateId</InlineCode>, and an optional{" "}
                          <InlineCode>variables</InlineCode> object. Do not send <InlineCode>subject</InlineCode>,{" "}
                          <InlineCode>text</InlineCode>, or <InlineCode>html</InlineCode> in the same request.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <CodeBlock code={templateExample} label="template request" />
                        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                          <p>
                            Compose visually with the inspector or paste a React Email component, then use{" "}
                            <InlineCode>{"{{variableName}}"}</InlineCode> in the subject, HTML, and text.
                            Values are inserted literally; HTML values are escaped.
                          </p>
                          <p>
                            Pasted TSX runs only in a sandboxed browser worker; the API stores the source
                            and compiled output. Missing variables cause a 400 before enqueueing. Up to 50
                            variables are allowed per send.{" "}
                            <InlineCode>POST /templates/{"{id}"}/preview</InlineCode> renders the saved
                            template with sample values and applies the same checks.
                          </p>
                        </div>
                        <a
                          href="/dashboard/templates"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          Manage templates
                          <ArrowRightIcon className="size-3.5" />
                        </a>
                      </CardContent>
                    </Card>
                  </DocSection>

                  <DocSection
                    id="endpoints"
                    title="Endpoint reference"
                    description="The public API and the dashboard API share one origin but use different authentication."
                  >
                    <div className="space-y-6">
                      {ENDPOINT_GROUPS.map((group) => (
                        <div key={group.title} className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-medium">{group.title}</h3>
                            <Badge variant="secondary">{group.auth}</Badge>
                          </div>
                          <p className="-mt-1 text-sm text-muted-foreground">{group.description}</p>
                          <EndpointTable endpoints={group.endpoints} />
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl border bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm">
                        <p className="font-medium">Need request and response schemas?</p>
                        <p className="text-muted-foreground">The generated OpenAPI document is the canonical contract.</p>
                      </div>
                      <div className="flex gap-2">
                        <a href="/docs" target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                          Open Scalar
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
                    title="Errors & limits"
                    description="Validation errors return a field-level details object. The send endpoint never waits for SMTP delivery."
                  >
                    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-20">Status</TableHead>
                            <TableHead className="w-48">Meaning</TableHead>
                            <TableHead>What to do</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ERROR_ROWS.map((row) => (
                            <TableRow key={row.status}>
                              <TableCell>
                                <Badge variant="outline" className="font-mono">{row.status}</Badge>
                              </TableCell>
                              <TableCell className="font-medium">{row.meaning}</TableCell>
                              <TableCell className="whitespace-normal text-muted-foreground">{row.detail}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle>Limits</CardTitle>
                        <CardDescription>Limits are enforced by the API before queueing or by Better Auth.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-48">Item</TableHead>
                                <TableHead>Limit</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {LIMITS.map(([item, limit]) => (
                                <TableRow key={item}>
                                  <TableCell className="font-medium">{item}</TableCell>
                                  <TableCell className="whitespace-normal text-muted-foreground">{limit}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Send from a file</CardTitle>
                        <CardDescription>Useful for large HTML bodies or when building requests in a script.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <CodeBlock code={sendExample} label="upload a JSON body" />
                      </CardContent>
                    </Card>
                  </DocSection>

                  <DocSection
                    id="security"
                    title="Security"
                    description="The POC keeps credentials and message content encrypted in D1 and limits the browser attack surface."
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        {
                          title: "Encrypted at rest",
                          body: "Recipient addresses, SMTP fields, and message bodies use AES-256-GCM. The AES key is a Worker secret, not a database value.",
                        },
                        {
                          title: "SMTP password is write-only",
                          body: "Create and update accept the password, but every read response omits it. The dashboard never needs to display it.",
                        },
                        {
                          title: "API keys are hashed",
                          body: "Better Auth stores a hash and prefix. The full mk_ key is returned once, at creation.",
                        },
                        {
                          title: "Verified TLS",
                          body: "SMTP sockets verify certificates and reject private/local IPv4 targets. Plain port 25 is not available on Workers.",
                        },
                        {
                          title: "Sanitized HTML",
                          body: "A restrictive allowlist removes scripts, frames, event handlers, forms, and unsafe URL schemes before sending.",
                        },
                        {
                          title: "Same-origin dashboard",
                          body: "The Worker serves the dashboard and API together. Dashboard routes require a Better Auth session and are restricted to the configured frontend origin.",
                        },
                      ].map((item) => (
                        <div key={item.title} className="rounded-xl border bg-card p-4">
                          <div className="flex items-center gap-2">
                            <ShieldCheckIcon className="size-4 text-muted-foreground" />
                            <p className="text-sm font-medium">{item.title}</p>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
                        </div>
                      ))}
                    </div>

                    <Callout tone="warning" title="Rotating AES_256_KEY breaks existing data">
                      Ciphertexts are not versioned. Changing the Worker secret makes every encrypted recipient,
                      body, and SMTP credential unreadable. Plan a migration before rotating it.
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
