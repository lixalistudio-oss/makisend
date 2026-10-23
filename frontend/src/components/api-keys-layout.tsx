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

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
]

function formatLastUsed(value: string | null) {
  if (!value) return "Never"
  return new Date(value).toLocaleDateString("en-US", {
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
      toast.error("Failed to load data")
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
        throw new Error(err.error || "Failed to create")
      }
      const data = await res.json()
      setNewKeyValue(data.key)
      setKeys([...keys, data.record])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create API key")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchApi(`/api-keys/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      setKeys(keys.filter((k) => k.id !== id))
      toast.success("API key deleted")
    } catch {
      toast.error("Failed to delete API key")
    }
  }

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      toast.success("API key copied to clipboard")
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = key
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
      toast.success("API key copied to clipboard")
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
        <SiteHeader title="API keys" />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-8 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em]">API keys</h2>
              <p className="text-sm text-muted-foreground">
                Manage API keys for sending emails through your SMTP configs.
              </p>
            </div>
            <div className="flex items-center gap-2">
            <Select value={days} onValueChange={(v) => v && setDays(v)}>
              <SelectTrigger className="w-[140px]" aria-label="Metrics period">
                <SelectValue>{RANGE_OPTIONS.find((o) => o.value === days)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
              <DialogTrigger render={<Button onClick={openCreate} />}>
                <PlusIcon />
                Create API key
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] overflow-y-auto gap-3 sm:max-w-[425px] sm:gap-4">
                <DialogHeader>
                  <DialogTitle>{newKeyValue ? "API Key Created" : "Create API key"}</DialogTitle>
                  <DialogDescription>
                    {newKeyValue
                      ? "Copy this key now. You won't be able to see it again."
                      : "Generate a new API key linked to an SMTP config."}
                  </DialogDescription>
                </DialogHeader>
                {newKeyValue ? (
                  <FieldGroup className="py-1 gap-2 sm:gap-3">
                    <div className="rounded-xl border border-warning/30 bg-surface-muted p-4 text-sm text-foreground [&_svg]:text-warning">
                      <div className="flex items-start gap-2">
                        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                        <span>
                          <strong>Copy this key now.</strong> It will not be shown again after
                          you close this dialog or refresh the page.
                        </span>
                      </div>
                    </div>
                    <Field>
                      <FieldLabel>API Key</FieldLabel>
                      <div className="flex gap-2">
                        <Input readOnly value={newKeyValue} className="font-mono text-xs" />
                        <Button variant="outline" size="icon" className="shrink-0" onClick={() => copyKey(newKeyValue)}>
                          <CopyIcon />
                        </Button>
                      </div>
                    </Field>
                    <DialogFooter className="flex-row justify-end">
                      <Button onClick={() => { setOpen(false); resetForm() }}>
                        I&apos;ve copied the key — Done
                      </Button>
                    </DialogFooter>
                  </FieldGroup>
                ) : (
                  <FieldGroup className="py-1 gap-1.5 sm:gap-2">
                    <Field>
                      <FieldLabel>SMTP configuration</FieldLabel>
                      <Select
                        value={selectedConfigId}
                        onValueChange={(value) => setSelectedConfigId(value ?? "")}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select an SMTP config">
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
                        The SMTP config this key will send through. Several keys can share one config.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="keyName">Key name</FieldLabel>
                      <Input
                        id="keyName"
                        placeholder="e.g., Production Key"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                      />
                      <FieldDescription className="text-xs leading-snug sm:text-sm">
                        Optional label to identify this key.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
                {!newKeyValue && (
                  <DialogFooter className="flex-row justify-end">
                    <Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>
                      Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!selectedConfigId || submitting}>
                      {submitting ? "Creating..." : "Create"}
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
              <p className="text-muted-foreground">No API keys yet. Create one to start sending emails.</p>
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
                      <ItemTitle className="text-base">{key.name || "Unnamed key"}</ItemTitle>
                      <ItemDescription className="font-mono text-xs">
                        {maskedKeyDisplay(key)}
                      </ItemDescription>
                      <ItemDescription>{config?.smtpHostname ?? "Unknown config"}</ItemDescription>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 pt-2 sm:grid-cols-5">
                        <Metric label="Sent" value={m ? String(m.totalSent) : "—"} />
                        <Metric label="Delivered" value={m && m.totalSent > 0 ? `${m.successRate}%` : "—"} />
                        <Metric label="Failed" value={m ? String(m.failureCount) : "—"} />
                        <Metric label="Avg. duration" value={m?.avgProcessingTimeMs != null ? `${m.avgProcessingTimeMs}ms` : "—"} />
                        <Metric label="Last used" value={m ? formatLastUsed(m.lastUsedAt) : "—"} />
                      </div>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="outline" className={key.enabled ? "text-success" : "text-muted-foreground"}>
                        {key.enabled ? <CheckCircleIcon /> : <XCircleIcon />}
                        {key.enabled ? "Active" : "Disabled"}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" className="size-8" />
                          }
                        >
                          <EllipsisVerticalIcon />
                          <span className="sr-only">Actions</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => { window.location.href = `/dashboard/email-logs?apiKey=${encodeURIComponent(key.id)}` }}>
                            <ScrollTextIcon />
                            View logs
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => handleDelete(key.id)}>
                            <TrashIcon />
                            Delete
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
