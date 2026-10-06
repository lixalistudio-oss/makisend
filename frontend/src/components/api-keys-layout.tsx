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
import { KeyIcon, PlusIcon, EllipsisVerticalIcon, TrashIcon, CheckCircleIcon, XCircleIcon, CopyIcon, LoaderIcon, AlertTriangleIcon } from "lucide-react"
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

export function ApiKeysLayout() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [configs, setConfigs] = useState<SmtpConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [keyName, setKeyName] = useState("")
  const [selectedConfigId, setSelectedConfigId] = useState<string>("")
  const [configError, setConfigError] = useState("")
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

  const resetForm = () => {
    setKeyName("")
    setSelectedConfigId("")
    setConfigError("")
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
        <SiteHeader />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-8 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">API Keys</h2>
              <p className="text-sm text-muted-foreground">
                Manage API keys for sending emails through your SMTP configs.
              </p>
            </div>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
              <DialogTrigger render={<Button onClick={openCreate} />}>
                <PlusIcon />
                Create API Key
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>{newKeyValue ? "API Key Created" : "Create API Key"}</DialogTitle>
                  <DialogDescription>
                    {newKeyValue
                      ? "Copy this key now. You won't be able to see it again."
                      : "Generate a new API key linked to an SMTP config."}
                  </DialogDescription>
                </DialogHeader>
                {newKeyValue ? (
                  <FieldGroup className="py-1 gap-3">
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
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
                    <DialogFooter>
                      <Button onClick={() => { setOpen(false); resetForm() }}>
                        I&apos;ve copied the key — Done
                      </Button>
                    </DialogFooter>
                  </FieldGroup>
                ) : (
                  <FieldGroup className="py-1 gap-2">
                    <Field>
                      <FieldLabel>SMTP Config</FieldLabel>
                      <Select
                        value={selectedConfigId}
                        onValueChange={(value) => {
                          const next = value ?? ""
                          const alreadyUsed = keys.some((k) => k.smtpConfigId === next)
                          if (alreadyUsed) {
                            setConfigError("This SMTP config already has an API key linked.")
                            setSelectedConfigId("")
                            setTimeout(() => setConfigError(""), 3000)
                          } else {
                            setConfigError("")
                            setSelectedConfigId(next)
                          }
                        }}
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
                      <FieldDescription>
                        The SMTP config this key will be linked to.
                      </FieldDescription>
                      {configError && (
                        <p className="text-sm text-destructive">{configError}</p>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="keyName">Key Name</FieldLabel>
                      <Input
                        id="keyName"
                        placeholder="e.g., Production Key"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                      />
                      <FieldDescription>
                        Optional label to identify this key.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
                {!newKeyValue && (
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>
                      Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!selectedConfigId || !!configError || submitting}>
                      {submitting ? "Creating..." : "Create"}
                    </Button>
                  </DialogFooter>
                )}
              </DialogContent>
            </Dialog>
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
                return (
                  <Item key={key.id} variant="outline" className="py-4 px-4 gap-5">
                    <ItemMedia variant="icon" className="size-10">
                      <KeyIcon className="size-5" />
                    </ItemMedia>
                    <ItemContent className="gap-1.5">
                      <ItemTitle className="text-base">{key.name || "Unnamed Key"}</ItemTitle>
                      <ItemDescription className="font-mono text-xs">
                        {maskedKeyDisplay(key)}
                      </ItemDescription>
                      <ItemDescription>{config?.smtpHostname ?? "Unknown config"}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="outline" className={key.enabled ? "text-green-600" : "text-muted-foreground"}>
                        {key.enabled ? <CheckCircleIcon className="fill-green-500" /> : <XCircleIcon />}
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
                        <DropdownMenuContent align="end" className="w-32">
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
