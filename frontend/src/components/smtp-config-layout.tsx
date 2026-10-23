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
import { MailIcon, PlusIcon, EllipsisVerticalIcon, PencilIcon, TrashIcon, CheckCircleIcon, XCircleIcon, LoaderIcon, SendIcon, ActivityIcon } from "lucide-react"
import { fetchApi } from "@/lib/api"
import { SmtpConfigForm, type SmtpConfigValues } from "@/components/smtp-config-form"
import { SmtpTestSendDialog } from "@/components/smtp-test-send-dialog"
import { DEFAULT_PORT, type SmtpSecurity } from "@/lib/smtp-form"

interface SmtpConfig {
  id: string
  smtpHostname: string
  smtpPort: number
  smtpSecurity: SmtpSecurity
  smtpUsername: string
  senderEmail: string
  isActive: boolean
}

const EMPTY: SmtpConfigValues = {
  smtpHostname: "",
  smtpPort: DEFAULT_PORT,
  smtpSecurity: "tls",
  smtpUsername: "",
  senderEmail: "",
}

export function SmtpConfigLayout() {
  const [configs, setConfigs] = useState<SmtpConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [initial, setInitial] = useState<SmtpConfigValues>(EMPTY)
  const [testing, setTesting] = useState<SmtpConfig | null>(null)

  const fetchConfigs = async () => {
    try {
      const res = await fetchApi("/smtp-config")
      const data = await res.json()
      setConfigs(data.configs ?? [])
    } catch {
      toast.error("Failed to load SMTP configs")
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
      if (data.ok) toast.success("SMTP connection works")
      else toast.error(data.message ?? "SMTP connection failed")
    } catch {
      toast.error("SMTP connection check failed")
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchApi(`/smtp-config/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      setConfigs(configs.filter((c) => c.id !== id))
      toast.success("SMTP config deleted")
    } catch {
      toast.error("Failed to delete config")
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
              <h2 className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em]">SMTP configuration</h2>
              <p className="text-sm text-muted-foreground">
                Manage your SMTP server connections for sending emails.
              </p>
            </div>
            <Dialog open={open} onOpenChange={(v) => { if (v) setOpen(true); else closeForm() }}>
              <DialogTrigger render={<Button onClick={openCreate} />}>
                <PlusIcon />
                Add SMTP configuration
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] gap-3 sm:max-w-[460px] sm:gap-4">
                <DialogHeader>
                  <DialogTitle>{editingId ? "Edit SMTP configuration" : "Create SMTP configuration"}</DialogTitle>
                  <DialogDescription>
                    {editingId ? "Update your SMTP server details." : "Add a new SMTP server to send emails through."}
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
              <p className="text-muted-foreground">No SMTP configs yet. Add one to start sending emails.</p>
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
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline" className={config.isActive ? "text-success" : "text-muted-foreground"}>
                      {config.isActive ? <CheckCircleIcon /> : <XCircleIcon />}
                      {config.isActive ? "Active" : "Inactive"}
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
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => handleCheck(config.id)}>
                          <ActivityIcon />
                          Check connection
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(config)}>
                          <PencilIcon />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTesting(config)}>
                          <SendIcon />
                          Send test email
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(config.id)}>
                          <TrashIcon />
                          Delete
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
      </SidebarInset>
    </SidebarProvider>
  )
}
