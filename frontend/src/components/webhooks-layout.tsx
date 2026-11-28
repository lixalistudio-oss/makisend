import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemTitle,
  ItemDescription,
} from "@/components/ui/item"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  CheckCircleIcon,
  CheckIcon,
  CircleXIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  HistoryIcon,
  LoaderIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  RotateCwIcon,
  SendIcon,
  TrashIcon,
  WebhookIcon,
  XCircleIcon,
} from "lucide-react"
import { fetchApi } from "@/lib/api"
import { useTranslation, type UiKey } from "@/i18n"

/** Must stay equal to MAX_WEBHOOK_ENDPOINTS in the backend (feat_webhooks_api_design.md, §8). */
const MAX_WEBHOOK_ENDPOINTS = 5
const DELIVERIES_PAGE_SIZE = 20

interface WebhookEndpoint {
  id: string
  url: string
  enabled: boolean
  disabledReason: "manual" | "auto" | null
  rotationEndsAt: string | null
  createdAt: string
  updatedAt: string
}

type DeliveryStatus = "pending" | "delivered" | "failed" | "skipped"
type EventType = "email.sent" | "email.failed" | "webhook.test"

interface WebhookDelivery {
  id: string
  eventType: EventType
  emailId: string | null
  status: DeliveryStatus
  attempts: number
  lastStatusCode: number | null
  lastError: string | null
  lastAttemptAt: string | null
  deliveredAt: string | null
  createdAt: string
}

interface TestResult {
  ok: boolean
  statusCode: number | null
  error: string | null
  durationMs: number
}

type TestState =
  | { state: "running" }
  | { state: "done"; result: TestResult }
  | { state: "error"; message: string }

interface ApiErrorBody {
  error?: string
  code?: string
  details?: { fieldErrors?: Record<string, string[] | undefined>; formErrors?: string[] }
}

const deliveryStatusConfig: Record<DeliveryStatus, { labelKey: UiKey; color: string; icon: React.ReactNode }> = {
  pending: { labelKey: "webhooks.delivery.pending", color: "text-brand-strong bg-brand-subtle", icon: <LoaderIcon className="size-3 animate-spin motion-reduce:animate-none" /> },
  delivered: { labelKey: "webhooks.delivery.delivered", color: "text-success bg-surface-muted", icon: <CheckCircleIcon className="size-3" /> },
  failed: { labelKey: "webhooks.delivery.failed", color: "text-destructive bg-surface-muted", icon: <CircleXIcon className="size-3" /> },
  skipped: { labelKey: "webhooks.delivery.skipped", color: "text-muted-foreground bg-muted", icon: <XCircleIcon className="size-3" /> },
}

const eventLabel: Record<EventType, UiKey> = {
  "email.sent": "webhooks.event.sent",
  "email.failed": "webhooks.event.failed",
  "webhook.test": "webhooks.event.test",
}

const VERIFY_SNIPPET = `import { Webhook } from "standardwebhooks"

const wh = new Webhook(process.env.MAKISEND_WEBHOOK_SECRET)

// rawBody: the request body exactly as received, before any JSON parsing.
const event = wh.verify(rawBody, {
  "webhook-id": req.headers["webhook-id"],
  "webhook-timestamp": req.headers["webhook-timestamp"],
  "webhook-signature": req.headers["webhook-signature"],
})
// Throws if the signature is wrong or the timestamp is older than 5 minutes.`

async function readError(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody
  } catch {
    return {}
  }
}

/**
 * A first, friendly check before the request. The server stays the authority: it also refuses
 * private and local hosts, and only accepts http:// when the instance allows it (local development).
 */
function localUrlProblem(raw: string): UiKey | null {
  const value = raw.trim()
  if (!value) return "webhooks.create.urlRequired"
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "webhooks.create.urlMalformed"
  }
  if (url.protocol === "https:") return null
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (url.protocol === "http:" && local) return null
  return "webhooks.create.urlNotHttps"
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = value
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="outline" className="shrink-0" onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">{copied ? t("webhooks.secret.copied") : label}</span>
    </Button>
  )
}

function EndpointStatusBadge({ endpoint }: { endpoint: WebhookEndpoint }) {
  const { t } = useTranslation()
  if (endpoint.enabled) {
    return (
      <Badge variant="outline" className="text-success">
        <CheckCircleIcon />
        {t("webhooks.status.active")}
      </Badge>
    )
  }
  if (endpoint.disabledReason === "auto") {
    return (
      <Badge variant="outline" className="text-warning">
        <AlertTriangleIcon />
        {t("webhooks.status.autoDisabled")}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <XCircleIcon />
      {t("webhooks.status.disabled")}
    </Badge>
  )
}

function TestResultLine({ test }: { test: TestState }) {
  const { t } = useTranslation()
  if (test.state === "running") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
        <LoaderIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
        {t("webhooks.test.running")}
      </p>
    )
  }
  if (test.state === "error") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive" role="status">
        <CircleXIcon className="size-3.5" />
        {test.message}
      </p>
    )
  }
  const { ok, statusCode, error, durationMs } = test.result
  const text = ok
    ? t("webhooks.test.ok", { status: statusCode ?? "", ms: durationMs })
    : statusCode != null
      ? t("webhooks.test.failedStatus", { status: statusCode, ms: durationMs })
      : t("webhooks.test.failedError", { error: error ?? "", ms: durationMs })
  return (
    <p className={`flex items-center gap-1.5 text-sm tabular-nums ${ok ? "text-success" : "text-destructive"}`} role="status">
      {ok ? <CheckCircleIcon className="size-3.5" /> : <CircleXIcon className="size-3.5" />}
      {text}
    </p>
  )
}

function DeliveriesSheet({
  endpoint,
  onOpenChange,
}: {
  endpoint: WebhookEndpoint | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, locale } = useTranslation()
  const [status, setStatus] = useState<"all" | DeliveryStatus>("all")
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = async (endpointId: string, filter: "all" | DeliveryStatus, after: string | null) => {
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams({ limit: String(DELIVERIES_PAGE_SIZE) })
      if (filter !== "all") params.set("status", filter)
      if (after) params.set("cursor", after)
      const res = await fetchApi(`/webhooks/${encodeURIComponent(endpointId)}/deliveries?${params}`)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { deliveries?: WebhookDelivery[]; nextCursor?: string | null }
      setDeliveries((previous) => (after ? [...previous, ...(data.deliveries ?? [])] : data.deliveries ?? []))
      setCursor(data.nextCursor ?? null)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!endpoint) return
    setDeliveries([])
    setCursor(null)
    load(endpoint.id, status, null)
  }, [endpoint?.id, status])

  useEffect(() => {
    if (!endpoint) setStatus("all")
  }, [endpoint])

  const formatDate = (value: string) =>
    new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })

  const filterOptions: { value: "all" | DeliveryStatus; labelKey: UiKey }[] = [
    { value: "all", labelKey: "webhooks.deliveries.all" },
    { value: "pending", labelKey: "webhooks.delivery.pending" },
    { value: "delivered", labelKey: "webhooks.delivery.delivered" },
    { value: "failed", labelKey: "webhooks.delivery.failed" },
    { value: "skipped", labelKey: "webhooks.delivery.skipped" },
  ]

  return (
    <Sheet open={endpoint !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-3xl! data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="gap-1 border-b p-4 sm:p-6">
          <SheetTitle>{t("webhooks.deliveries.title")}</SheetTitle>
          <SheetDescription className="break-all">
            {t("webhooks.deliveries.description", { url: endpoint?.url ?? "" })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          <Select value={status} onValueChange={(value) => value && setStatus(value as "all" | DeliveryStatus)}>
            <SelectTrigger className="w-[200px]" aria-label={t("webhooks.deliveries.filter")}>
              <SelectValue>
                {(() => {
                  const option = filterOptions.find((o) => o.value === status)
                  return option ? t(option.labelKey) : null
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {filterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {failed && deliveries.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border p-4 text-sm">
              <p className="text-destructive">{t("webhooks.deliveries.loadFailed")}</p>
              {endpoint && (
                <Button variant="outline" onClick={() => load(endpoint.id, status, null)}>
                  {t("webhooks.retry")}
                </Button>
              )}
            </div>
          ) : loading && deliveries.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <LoaderIcon className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
            </div>
          ) : deliveries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("webhooks.deliveries.empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("webhooks.deliveries.col.event")}</TableHead>
                    <TableHead>{t("webhooks.deliveries.col.status")}</TableHead>
                    <TableHead className="text-right">{t("webhooks.deliveries.col.attempts")}</TableHead>
                    <TableHead>{t("webhooks.deliveries.col.response")}</TableHead>
                    <TableHead>{t("webhooks.deliveries.col.date")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((delivery) => {
                    const config = deliveryStatusConfig[delivery.status] ?? deliveryStatusConfig.skipped
                    return (
                      <TableRow key={delivery.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span>{t(eventLabel[delivery.eventType] ?? "webhooks.event.test")}</span>
                            {delivery.emailId && (
                              <span className="font-mono text-xs text-muted-foreground">{delivery.emailId}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`gap-1 px-1.5 ${config.color}`}>
                            {config.icon}
                            {t(config.labelKey)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{delivery.attempts}</TableCell>
                        <TableCell className="tabular-nums">
                          {delivery.lastStatusCode != null
                            ? `HTTP ${delivery.lastStatusCode}`
                            : delivery.lastError ?? t("webhooks.deliveries.noResponse")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(delivery.lastAttemptAt ?? delivery.createdAt)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {cursor && endpoint && (
            <Button
              variant="outline"
              className="self-center"
              disabled={loading}
              onClick={() => load(endpoint.id, status, cursor)}
            >
              {loading && <LoaderIcon className="animate-spin motion-reduce:animate-none" />}
              {t("webhooks.deliveries.loadMore")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function WebhooksLayout() {
  const { t, locale } = useTranslation()
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [urlError, setUrlError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [revealed, setRevealed] = useState<{ titleKey: UiKey; secret: string } | null>(null)

  const [rotateTarget, setRotateTarget] = useState<WebhookEndpoint | null>(null)
  const [expireNow, setExpireNow] = useState(false)
  const [rotating, setRotating] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [tests, setTests] = useState<Record<string, TestState>>({})
  const [deliveriesTarget, setDeliveriesTarget] = useState<WebhookEndpoint | null>(null)

  const atLimit = endpoints.length >= MAX_WEBHOOK_ENDPOINTS

  /** The message to show for a failed request: known codes in the current language, else the server's. */
  const messageFor = (body: ApiErrorBody): string => {
    switch (body.code) {
      case "WEBHOOK_LIMIT_REACHED":
        return t("webhooks.error.limit", { max: MAX_WEBHOOK_ENDPOINTS })
      case "WEBHOOK_URL_EXISTS":
        return t("webhooks.error.exists")
      case "WEBHOOK_NOT_FOUND":
        return t("webhooks.error.notFound")
      case "WEBHOOK_TEST_RATE_LIMITED":
        return t("webhooks.error.testRateLimited")
      default:
        return body.details?.fieldErrors?.url?.[0] ?? body.error ?? t("webhooks.error.generic")
    }
  }

  const loadEndpoints = async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const res = await fetchApi("/webhooks")
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { endpoints?: WebhookEndpoint[] }
      setEndpoints(data.endpoints ?? [])
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEndpoints()
  }, [])

  const replaceEndpoint = (next: WebhookEndpoint) =>
    setEndpoints((list) => list.map((e) => (e.id === next.id ? next : e)))

  const openCreate = () => {
    setUrl("")
    setUrlError(null)
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    const problem = localUrlProblem(url)
    if (problem) {
      setUrlError(t(problem))
      return
    }
    setSubmitting(true)
    setUrlError(null)
    try {
      const res = await fetchApi("/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!res.ok) {
        setUrlError(messageFor(await readError(res)))
        return
      }
      const data = (await res.json()) as { endpoint: WebhookEndpoint; secret: string }
      setEndpoints((list) => [...list, data.endpoint])
      setCreateOpen(false)
      setRevealed({ titleKey: "webhooks.secret.createdTitle", secret: data.secret })
    } catch {
      setUrlError(t("webhooks.error.generic"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (endpoint: WebhookEndpoint) => {
    try {
      const res = await fetchApi(`/webhooks/${encodeURIComponent(endpoint.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !endpoint.enabled }),
      })
      if (!res.ok) throw new Error(messageFor(await readError(res)))
      const data = (await res.json()) as { endpoint: WebhookEndpoint }
      replaceEndpoint(data.endpoint)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("webhooks.error.generic"))
    }
  }

  const handleTest = async (endpoint: WebhookEndpoint) => {
    setTests((all) => ({ ...all, [endpoint.id]: { state: "running" } }))
    try {
      const res = await fetchApi(`/webhooks/${encodeURIComponent(endpoint.id)}/test`, { method: "POST" })
      if (!res.ok) {
        const message = messageFor(await readError(res))
        setTests((all) => ({ ...all, [endpoint.id]: { state: "error", message } }))
        return
      }
      const result = (await res.json()) as TestResult
      setTests((all) => ({ ...all, [endpoint.id]: { state: "done", result } }))
    } catch {
      setTests((all) => ({ ...all, [endpoint.id]: { state: "error", message: t("webhooks.test.unreachable") } }))
    }
  }

  const handleRotate = async () => {
    if (!rotateTarget) return
    setRotating(true)
    try {
      const res = await fetchApi(`/webhooks/${encodeURIComponent(rotateTarget.id)}/rotate-secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expireCurrentNow: expireNow }),
      })
      if (!res.ok) throw new Error(messageFor(await readError(res)))
      const data = (await res.json()) as { endpoint: WebhookEndpoint; secret: string }
      replaceEndpoint(data.endpoint)
      setRotateTarget(null)
      setRevealed({ titleKey: "webhooks.secret.rotatedTitle", secret: data.secret })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("webhooks.error.generic"))
    } finally {
      setRotating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetchApi(`/webhooks/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" })
      if (!res.ok && res.status !== 404) throw new Error(messageFor(await readError(res)))
      setEndpoints((list) => list.filter((e) => e.id !== deleteTarget.id))
      setDeleteTarget(null)
      toast.success(t("webhooks.toast.deleted"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("webhooks.error.generic"))
    } finally {
      setDeleting(false)
    }
  }

  const formatDate = (value: string) =>
    new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader titleKey="nav.webhooks" />
        <SessionGuard>
          <div className="flex flex-1 flex-col gap-8 p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em]">
                  {t("webhooks.title")}
                </h2>
                <p className="text-sm text-muted-foreground">{t("webhooks.subtitle")}</p>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <Button onClick={openCreate} disabled={loading || loadFailed || atLimit}>
                  <PlusIcon />
                  {t("webhooks.add")}
                </Button>
                {atLimit && (
                  <span className="text-xs text-muted-foreground">
                    {t("webhooks.limitReached", { max: MAX_WEBHOOK_ENDPOINTS })}
                  </span>
                )}
              </div>
            </div>

            <div className="border-b" />

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <LoaderIcon className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
              </div>
            ) : loadFailed ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <p className="text-destructive">{t("webhooks.loadFailed")}</p>
                <Button variant="outline" onClick={loadEndpoints}>
                  {t("webhooks.retry")}
                </Button>
              </div>
            ) : endpoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <WebhookIcon className="size-10 text-muted-foreground" />
                <div className="flex flex-col gap-1">
                  <p className="font-medium">{t("webhooks.empty.title")}</p>
                  <p className="max-w-md text-sm text-muted-foreground">{t("webhooks.empty.description")}</p>
                </div>
                <Button variant="outline" onClick={openCreate}>
                  <PlusIcon />
                  {t("webhooks.add")}
                </Button>
              </div>
            ) : (
              <ItemGroup className="gap-5">
                {endpoints.map((endpoint) => {
                  const test = tests[endpoint.id]
                  return (
                    <Item key={endpoint.id} variant="outline" className="gap-5 px-4 py-4">
                      <ItemMedia variant="icon" className="size-10">
                        <WebhookIcon className="size-5" />
                      </ItemMedia>
                      <ItemContent className="min-w-0 gap-1.5">
                        <ItemTitle className="break-all font-mono text-sm font-normal">{endpoint.url}</ItemTitle>
                        <ItemDescription>{t("webhooks.createdOn", { date: formatDate(endpoint.createdAt) })}</ItemDescription>
                        {endpoint.rotationEndsAt && new Date(endpoint.rotationEndsAt) > new Date() && (
                          <ItemDescription className="flex items-center gap-1.5">
                            <RotateCwIcon className="size-3.5" />
                            {t("webhooks.rotationUntil", { date: formatDate(endpoint.rotationEndsAt) })}
                          </ItemDescription>
                        )}
                        {test && <TestResultLine test={test} />}
                      </ItemContent>
                      <ItemActions>
                        <EndpointStatusBadge endpoint={endpoint} />
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
                            <EllipsisVerticalIcon />
                            <span className="sr-only">{t("webhooks.actions")}</span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              disabled={test?.state === "running"}
                              onClick={() => handleTest(endpoint)}
                            >
                              <SendIcon />
                              {t("webhooks.action.test")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeliveriesTarget(endpoint)}>
                              <HistoryIcon />
                              {t("webhooks.action.deliveries")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setExpireNow(false)
                                setRotateTarget(endpoint)
                              }}
                            >
                              <RotateCwIcon />
                              {t("webhooks.action.rotate")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggle(endpoint)}>
                              {endpoint.enabled ? <PowerOffIcon /> : <PowerIcon />}
                              {endpoint.enabled ? t("webhooks.action.disable") : t("webhooks.action.enable")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(endpoint)}>
                              <TrashIcon />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ItemActions>
                    </Item>
                  )
                })}
              </ItemGroup>
            )}

            {!loading && !loadFailed && (
              <section className="flex max-w-3xl flex-col gap-3">
                <h3 className="text-base font-medium">{t("webhooks.verify.title")}</h3>
                <p className="text-sm text-muted-foreground">{t("webhooks.verify.description")}</p>
                <div className="min-w-0 rounded-xl bg-surface-muted">
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 py-2 pr-2 pl-4">
                    <span className="text-xs text-muted-foreground">{t("webhooks.verify.example")}</span>
                    <CopyButton value={VERIFY_SNIPPET} label={t("webhooks.verify.copy")} />
                  </div>
                  <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
                    <code>{VERIFY_SNIPPET}</code>
                  </pre>
                </div>
                <p className="text-sm text-muted-foreground">{t("webhooks.verify.retries")}</p>
              </section>
            )}
          </div>

          {/* Create */}
          <Dialog open={createOpen} onOpenChange={(open) => !submitting && setCreateOpen(open)}>
            <DialogContent className="gap-3 sm:max-w-[480px] sm:gap-4">
              <DialogHeader>
                <DialogTitle>{t("webhooks.create.title")}</DialogTitle>
                <DialogDescription>{t("webhooks.create.description")}</DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  handleCreate()
                }}
              >
                <FieldGroup className="gap-2 py-1">
                  <Field data-invalid={urlError ? true : undefined}>
                    <FieldLabel htmlFor="webhook-url">{t("webhooks.create.urlLabel")}</FieldLabel>
                    <Input
                      id="webhook-url"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono text-sm"
                      placeholder={t("webhooks.create.urlPlaceholder")}
                      value={url}
                      aria-invalid={urlError ? true : undefined}
                      onChange={(event) => {
                        setUrl(event.target.value)
                        if (urlError) setUrlError(null)
                      }}
                    />
                    {urlError ? (
                      <FieldError>{urlError}</FieldError>
                    ) : (
                      <FieldDescription className="text-xs leading-snug sm:text-sm">
                        {t("webhooks.create.urlHelp")}
                      </FieldDescription>
                    )}
                  </Field>
                </FieldGroup>
                <DialogFooter className="flex-row justify-end">
                  <Button type="button" variant="outline" disabled={submitting} onClick={() => setCreateOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? t("webhooks.create.submitting") : t("webhooks.create.submit")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Secret, shown once after create or rotate */}
          <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
            <DialogContent className="gap-3 sm:max-w-[520px] sm:gap-4">
              {revealed && (
                <>
                  <DialogHeader>
                    <DialogTitle>{t(revealed.titleKey)}</DialogTitle>
                    <DialogDescription>{t("webhooks.secret.description")}</DialogDescription>
                  </DialogHeader>
                  <div className="rounded-xl border border-warning/30 bg-surface-muted p-4 text-sm text-foreground [&_svg]:text-warning">
                    <div className="flex items-start gap-2">
                      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                      <span>
                        <strong className="font-medium">{t("webhooks.secret.copyNowStrong")}</strong>{" "}
                        {t("webhooks.secret.copyNowWarning")}
                      </span>
                    </div>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="webhook-secret">{t("webhooks.secret.label")}</FieldLabel>
                    <div className="flex gap-2">
                      <Input id="webhook-secret" readOnly value={revealed.secret} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                      <CopyButton value={revealed.secret} label={t("webhooks.secret.copy")} />
                    </div>
                  </Field>
                  <DialogFooter className="flex-row justify-end">
                    <Button onClick={() => setRevealed(null)}>{t("webhooks.secret.done")}</Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>

          {/* Rotate */}
          <Dialog open={rotateTarget !== null} onOpenChange={(open) => !open && !rotating && setRotateTarget(null)}>
            <DialogContent className="gap-3 sm:max-w-[480px] sm:gap-4">
              <DialogHeader>
                <DialogTitle>{t("webhooks.rotate.title")}</DialogTitle>
                <DialogDescription>{t("webhooks.rotate.description")}</DialogDescription>
              </DialogHeader>
              <label htmlFor="webhook-expire-now" className="flex items-start gap-3 text-sm">
                <Checkbox
                  id="webhook-expire-now"
                  checked={expireNow}
                  onCheckedChange={(checked) => setExpireNow(checked === true)}
                  className="mt-0.5"
                />
                <span>{t("webhooks.rotate.expireNow")}</span>
              </label>
              <DialogFooter className="flex-row justify-end">
                <Button variant="outline" disabled={rotating} onClick={() => setRotateTarget(null)}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={handleRotate} disabled={rotating}>
                  {rotating ? t("webhooks.rotate.confirming") : t("webhooks.rotate.confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete */}
          <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
            <DialogContent className="gap-3 sm:max-w-[480px] sm:gap-4">
              <DialogHeader>
                <DialogTitle>{t("webhooks.delete.title")}</DialogTitle>
                <DialogDescription className="break-all">
                  {t("webhooks.delete.description", { url: deleteTarget?.url ?? "" })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-row justify-end">
                <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? t("webhooks.delete.confirming") : t("webhooks.delete.confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DeliveriesSheet endpoint={deliveriesTarget} onOpenChange={(open) => !open && setDeliveriesTarget(null)} />
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
