import { useState, useEffect } from "react"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { KeyIcon, PlusIcon, EllipsisVerticalIcon, TrashIcon, CheckCircleIcon, XCircleIcon, CopyIcon, LoaderIcon, AlertTriangleIcon, ScrollTextIcon } from "lucide-react"
import { fetchApi } from "@/lib/api"
import { useTranslation, type UiKey } from "@/i18n"

interface SmtpConfig {
  id: string
  smtpHostname: string
  senderEmail: string
}

interface ApiKey {
  id: string
  name: string
  prefix: string | null
  smtpConfigId: string | null
  enabled: boolean
}

interface KeyMetrics {
  apiKeyId: string
  totalSent: number
  successCount: number
  failureCount: number
  successRate: number
  avgProcessingTimeMs: number | null
  lastUsedAt: string | null
}

const RANGE_OPTIONS: { value: string; labelKey: UiKey }[] = [
  { value: "7", labelKey: "apiKeys.range.last7" },
  { value: "30", labelKey: "apiKeys.range.last30" },
  { value: "90", labelKey: "apiKeys.range.last90" },
]

function formatLastUsed(value: string | null, locale: string, never: string) {
  if (!value) return never
  return new Date(value).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

export function ApiKeysLayout() {
  const { t, locale } = useTranslation()
  const [metrics, setMetrics] = useState<Record<string, KeyMetrics>>({})
  const [days, setDays] = useState("7")
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [configs, setConfigs] = useState<SmtpConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [keyName, setKeyName] = useState("")
  const [selectedConfigId, setSelectedConfigId] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null)

  const fetchData = async () => {
    try {
      const [keysRes, configsRes] = await Promise.all([
        fetchApi("/api-keys"),
        fetchApi("/smtp-config"),
      ])
      const keysData = await keysRes.json()
      const configsData = await configsRes.json()
      setKeys(keysData.keys ?? [])
      setConfigs(configsData.configs ?? [])
    } catch {
      toast.error(t("apiKeys.toast.loadFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Metrics are a separate, lighter call: a failure must not hide the keys themselves.
  useEffect(() => {
    fetchApi(`/dashboard/by-api-key?days=${days}`)
      .then((res) => res.json())
      .then((data) => {
        const rows: KeyMetrics[] = data.breakdown ?? []
        setMetrics(Object.fromEntries(rows.map((r) => [r.apiKeyId, r])))
      })
      .catch(() => setMetrics({}))
  }, [days, keys.length])

  const resetForm = () => {
    setKeyName("")
    setSelectedConfigId("")
    setNewKeyValue(null)
  }

  const openCreate = () => {
    resetForm()
    setOpen(true)
  }

  const handleSubmit = async () => {
    if (!selectedConfigId) return

    setSubmitting(true)
    try {
      const res = await fetchApi("/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpConfigId: selectedConfigId,
          name: keyName || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || t("apiKeys.toast.createFailed"))
      }
      const data = await res.json()
      setNewKeyValue(data.key)
      setKeys([...keys, data.record])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("apiKeys.toast.createFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchApi(`/api-keys/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      setKeys(keys.filter((k) => k.id !== id))
      toast.success(t("apiKeys.toast.deleted"))
    } catch {
      toast.error(t("apiKeys.toast.deleteFailed"))
    }
  }

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      toast.success(t("apiKeys.toast.copied"))
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = key
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
      toast.success(t("apiKeys.toast.copied"))
    }
  }

  const maskedKeyDisplay = (key: ApiKey) => {
    if (key.prefix) return `${key.prefix}...`
    return "****"
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader titleKey="nav.apiKeys" />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-8 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em]">{t("apiKeys.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("apiKeys.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
            <Select value={days} onValueChange={(v) => v && setDays(v)}>
              <SelectTrigger className="w-[140px]" aria-label={t("apiKeys.metricsPeriod")}>
                <SelectValue>{(() => { const o = RANGE_OPTIONS.find((o) => o.value === days); return o ? t(o.labelKey) : null })()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
              <DialogTrigger render={<Button onClick={openCreate} />}>
                <PlusIcon />
                {t("apiKeys.create")}
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] overflow-y-auto gap-3 sm:max-w-[425px] sm:gap-4">
                <DialogHeader>
                  <DialogTitle>{newKeyValue ? t("apiKeys.created") : t("apiKeys.create")}</DialogTitle>
                  <DialogDescription>
                    {newKeyValue
                      ? t("apiKeys.createdDescription")
                      : t("apiKeys.createDescription")}
                  </DialogDescription>
                </DialogHeader>
                {newKeyValue ? (
                  <FieldGroup className="py-1 gap-2 sm:gap-3">
                    <div className="rounded-xl border border-warning/30 bg-surface-muted p-4 text-sm text-foreground [&_svg]:text-warning">
                      <div className="flex items-start gap-2">
                        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                        <span>
                          <strong>{t("apiKeys.copyNowStrong")}</strong> {t("apiKeys.copyNowWarning")}
                        </span>
                      </div>
                    </div>
                    <Field>
                      <FieldLabel>{t("apiKeys.keyLabel")}</FieldLabel>
                      <div className="flex gap-2">
                        <Input readOnly value={newKeyValue} className="font-mono text-xs" />
                        <Button variant="outline" size="icon" className="shrink-0" aria-label={t("apiKeys.copyKey")} title={t("apiKeys.copyKey")} onClick={() => copyKey(newKeyValue)}>
                          <CopyIcon />
                        </Button>
                      </div>
                    </Field>
                    <DialogFooter className="flex-row justify-end">
                      <Button onClick={() => { setOpen(false); resetForm() }}>
                        {t("apiKeys.copiedDone")}
                      </Button>
                    </DialogFooter>
                  </FieldGroup>
                ) : (
                  <FieldGroup className="py-1 gap-1.5 sm:gap-2">
                    <Field>
                      <FieldLabel>{t("apiKeys.smtpConfig")}</FieldLabel>
                      <Select
                        value={selectedConfigId}
                        onValueChange={(value) => setSelectedConfigId(value ?? "")}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("apiKeys.selectSmtpConfig")}>
                            {selectedConfigId
                              ? configs.find((c) => c.id === selectedConfigId)
                                ? `${configs.find((c) => c.id === selectedConfigId)!.smtpHostname} — ${configs.find((c) => c.id === selectedConfigId)!.senderEmail}`
                                : selectedConfigId
                              : null}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {configs.map((config) => (
                            <SelectItem key={config.id} value={config.id}>
                              {config.smtpHostname} — {config.senderEmail}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription className="text-xs leading-snug sm:text-sm">
                        {t("apiKeys.smtpConfigHelp")}
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="keyName">{t("apiKeys.keyName")}</FieldLabel>
                      <Input
                        id="keyName"
                        placeholder={t("apiKeys.keyNamePlaceholder")}
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                      />
                      <FieldDescription className="text-xs leading-snug sm:text-sm">
                        {t("apiKeys.keyNameHelp")}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
                {!newKeyValue && (
                  <DialogFooter className="flex-row justify-end">
                    <Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>
                      {t("common.cancel")}
                    </Button>
                    <Button onClick={handleSubmit} disabled={!selectedConfigId || submitting}>
                      {submitting ? t("apiKeys.creating") : t("apiKeys.createButton")}
                    </Button>
                  </DialogFooter>
                )}
              </DialogContent>
            </Dialog>
            </div>
          </div>

          <div className="border-b" />

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <KeyIcon className="size-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">{t("apiKeys.empty")}</p>
            </div>
          ) : (
            <ItemGroup className="gap-5">
              {keys.map((key) => {
                const config = configs.find((c) => c.id === key.smtpConfigId)
                const m = metrics[key.id]
                return (
                  <Item key={key.id} variant="outline" className="py-4 px-4 gap-5">
                    <ItemMedia variant="icon" className="size-10">
                      <KeyIcon className="size-5" />
                    </ItemMedia>
                    <ItemContent className="gap-1.5">
                      <ItemTitle className="text-base">{key.name || t("apiKeys.unnamed")}</ItemTitle>
                      <ItemDescription className="font-mono text-xs">
                        {maskedKeyDisplay(key)}
                      </ItemDescription>
                      <ItemDescription>{config?.smtpHostname ?? t("apiKeys.unknownConfig")}</ItemDescription>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 pt-2 sm:grid-cols-5">
                        <Metric label={t("apiKeys.metric.sent")} value={m ? String(m.totalSent) : "—"} />
                        <Metric label={t("apiKeys.metric.delivered")} value={m && m.totalSent > 0 ? `${m.successRate}%` : "—"} />
                        <Metric label={t("apiKeys.metric.failed")} value={m ? String(m.failureCount) : "—"} />
                        <Metric label={t("apiKeys.metric.avgDuration")} value={m?.avgProcessingTimeMs != null ? t("apiKeys.durationMs", { ms: m.avgProcessingTimeMs }) : "—"} />
                        <Metric label={t("apiKeys.metric.lastUsed")} value={m ? formatLastUsed(m.lastUsedAt, locale, t("common.never")) : "—"} />
                      </div>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="outline" className={key.enabled ? "text-success" : "text-muted-foreground"}>
                        {key.enabled ? <CheckCircleIcon /> : <XCircleIcon />}
                        {key.enabled ? t("apiKeys.active") : t("apiKeys.disabled")}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" className="size-8" />
                          }
                        >
                          <EllipsisVerticalIcon />
                          <span className="sr-only">{t("apiKeys.actions")}</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => { window.location.href = `/dashboard/email-logs?apiKey=${encodeURIComponent(key.id)}` }}>
                            <ScrollTextIcon />
                            {t("apiKeys.viewLogs")}
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => handleDelete(key.id)}>
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
        </div>
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
