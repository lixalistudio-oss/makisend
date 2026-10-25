import { useState, useEffect } from "react"
import { toast } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MailIcon, PlusIcon, EllipsisVerticalIcon, PencilIcon, TrashIcon, CheckCircleIcon, XCircleIcon, LoaderIcon, SendIcon, ActivityIcon, GlobeIcon, WebhookIcon } from "lucide-react"
import { fetchApi } from "@/lib/api"
import { useTranslation } from "@/i18n"
import { SmtpConfigForm, type SmtpConfigValues } from "@/components/smtp-config-form"
import { SmtpTestSendDialog } from "@/components/smtp-test-send-dialog"
import { SmtpDnsCheckDialog } from "@/components/smtp-dns-check-dialog"
import { SmtpBounceWebhookDialog } from "@/components/smtp-bounce-webhook-dialog"
import { supportsBounceWebhook, webhookProvider, type WebhookProviderId } from "@/lib/deliverability"
import { DEFAULT_PORT, type SmtpSecurity } from "@/lib/smtp-form"

interface SmtpConfig {
  id: string
  smtpHostname: string
  smtpPort: number
  smtpSecurity: SmtpSecurity
  smtpUsername: string
  senderEmail: string
  isActive: boolean
  bounceWebhookProvider: WebhookProviderId | null
}

const EMPTY: SmtpConfigValues = {
  smtpHostname: "",
  smtpPort: DEFAULT_PORT,
  smtpSecurity: "tls",
  smtpUsername: "",
  senderEmail: "",
}

export function SmtpConfigLayout() {
  const { t } = useTranslation()
  const [configs, setConfigs] = useState<SmtpConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [initial, setInitial] = useState<SmtpConfigValues>(EMPTY)
  const [testing, setTesting] = useState<SmtpConfig | null>(null)
  const [dnsChecking, setDnsChecking] = useState<SmtpConfig | null>(null)
  const [webhookConfig, setWebhookConfig] = useState<SmtpConfig | null>(null)

  const fetchConfigs = async () => {
    try {
      const res = await fetchApi("/smtp-config")
      const data = await res.json()
      setConfigs(data.configs ?? [])
    } catch {
      toast.error(t("smtp.loadFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
  }, [])

  const closeForm = () => {
    setOpen(false)
    setEditingId(null)
    setInitial(EMPTY)
  }

  const openCreate = () => {
    setEditingId(null)
    setInitial(EMPTY)
    setOpen(true)
  }

  const openEdit = (config: SmtpConfig) => {
    setEditingId(config.id)
    setInitial({
      smtpHostname: config.smtpHostname,
      smtpPort: config.smtpPort,
      smtpSecurity: config.smtpSecurity,
      smtpUsername: config.smtpUsername,
      senderEmail: config.senderEmail,
    })
    setOpen(true)
  }

  const handleCheck = async (id: string) => {
    try {
      const res = await fetchApi(`/smtp-config/${id}/check`, { method: "POST" })
      const data = (await res.json()) as { ok?: boolean; message?: string }
      if (!res.ok) throw new Error(data.message ?? "Failed to check")
      if (data.ok) toast.success(t("smtp.connectionWorks"))
      else toast.error(data.message ?? t("smtp.connectionFailed"))
    } catch {
      toast.error(t("smtp.connectionCheckFailed"))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchApi(`/smtp-config/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      setConfigs(configs.filter((c) => c.id !== id))
      toast.success(t("smtp.deleted"))
    } catch {
      toast.error(t("smtp.deleteFailed"))
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader titleKey="nav.smtpConfig" />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-8 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em]">{t("smtp.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("smtp.subtitle")}
              </p>
            </div>
            <Dialog open={open} onOpenChange={(v) => { if (v) setOpen(true); else closeForm() }}>
              <DialogTrigger render={<Button onClick={openCreate} />}>
                <PlusIcon />
                {t("smtp.add")}
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] gap-3 sm:max-w-[460px] sm:gap-4">
                <DialogHeader>
                  <DialogTitle>{editingId ? t("smtp.dialogEditTitle") : t("smtp.dialogCreateTitle")}</DialogTitle>
                  <DialogDescription>
                    {editingId ? t("smtp.dialogEditDescription") : t("smtp.dialogCreateDescription")}
                  </DialogDescription>
                </DialogHeader>
                <SmtpConfigForm
                  // a new key per opening: the form starts from its initial values every time
                  key={editingId ?? "new"}
                  editingId={editingId}
                  initial={initial}
                  onCancel={closeForm}
                  onSaved={() => {
                    closeForm()
                    fetchConfigs()
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="border-b" />

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : configs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MailIcon className="size-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">{t("smtp.empty")}</p>
            </div>
          ) : (
            <ItemGroup className="gap-5">
              {configs.map((config) => (
                <Item key={config.id} variant="outline" className="py-4 px-4 gap-5">
                  <ItemMedia variant="icon" className="size-10">
                    <MailIcon className="size-5" />
                  </ItemMedia>
                  <ItemContent className="gap-1.5">
                    <ItemTitle className="text-base">{config.smtpHostname}</ItemTitle>
                    <ItemDescription>
                      {config.senderEmail} · {config.smtpPort} · {config.smtpSecurity === "tls" ? "TLS" : "STARTTLS"}
                      {webhookProvider(config.bounceWebhookProvider) &&
                        ` · ${t("deliverability.webhookBadge", { provider: webhookProvider(config.bounceWebhookProvider)!.label })}`}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline" className={config.isActive ? "text-success" : "text-muted-foreground"}>
                      {config.isActive ? <CheckCircleIcon /> : <XCircleIcon />}
                      {config.isActive ? t("smtp.active") : t("smtp.inactive")}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="size-8" />
                        }
                      >
                        <EllipsisVerticalIcon />
                        <span className="sr-only">{t("smtp.actions")}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => handleCheck(config.id)}>
                          <ActivityIcon />
                          {t("smtp.checkConnection")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDnsChecking(config)}>
                          <GlobeIcon />
                          {t("deliverability.checkDns")}
                        </DropdownMenuItem>
                        {supportsBounceWebhook(config.smtpHostname) && (
                          <DropdownMenuItem onClick={() => setWebhookConfig(config)}>
                            <WebhookIcon />
                            {t("deliverability.webhookMenu")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => openEdit(config)}>
                          <PencilIcon />
                          {t("smtp.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTesting(config)}>
                          <SendIcon />
                          {t("smtp.sendTestEmail")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(config.id)}>
                          <TrashIcon />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
        </SessionGuard>
        <SmtpTestSendDialog config={testing} onClose={() => setTesting(null)} />
        <SmtpDnsCheckDialog config={dnsChecking} onClose={() => setDnsChecking(null)} />
        <SmtpBounceWebhookDialog
          config={webhookConfig}
          onClose={() => setWebhookConfig(null)}
          onChanged={(id, provider) =>
            setConfigs((current) => current.map((c) => (c.id === id ? { ...c, bounceWebhookProvider: provider } : c)))
          }
        />
      </SidebarInset>
    </SidebarProvider>
  )
}
