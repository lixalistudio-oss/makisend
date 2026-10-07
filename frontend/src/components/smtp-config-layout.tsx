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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MailIcon, PlusIcon, EllipsisVerticalIcon, PencilIcon, TrashIcon, CheckCircleIcon, XCircleIcon, LoaderIcon } from "lucide-react"
import { fetchApi } from "@/lib/api"

interface SmtpConfig {
  id: string
  smtpHostname: string
  smtpUsername: string
  senderEmail: string
  isActive: boolean
}

export function SmtpConfigLayout() {
  const [configs, setConfigs] = useState<SmtpConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [hostname, setHostname] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [senderEmail, setSenderEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)

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

  const resetForm = () => {
    setHostname("")
    setUsername("")
    setPassword("")
    setSenderEmail("")
    setEditingId(null)
  }

  const openCreate = () => {
    resetForm()
    setOpen(true)
  }

  const openEdit = (config: SmtpConfig) => {
    setEditingId(config.id)
    setHostname(config.smtpHostname)
    setUsername(config.smtpUsername)
    setPassword("")
    setSenderEmail(config.senderEmail)
    setOpen(true)
  }

  const handleSubmit = async () => {
    if (!hostname || !username || !senderEmail) return
    if (!editingId && !password) return

    setSubmitting(true)
    try {
      if (editingId) {
        const body: Record<string, string> = {
          smtpHostname: hostname,
          smtpUsername: username,
          senderEmail,
        }
        if (password) body.smtpPassword = password

        const res = await fetchApi(`/smtp-config/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error("Failed to update")
        toast.success("SMTP config updated")
      } else {
        const res = await fetchApi("/smtp-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            smtpHostname: hostname,
            smtpUsername: username,
            smtpPassword: password,
            senderEmail,
          }),
        })
        if (!res.ok) throw new Error("Failed to create")
        toast.success("SMTP config created")
      }
      resetForm()
      setOpen(false)
      fetchConfigs()
    } catch {
      toast.error(editingId ? "Failed to update config" : "Failed to create config")
    } finally {
      setSubmitting(false)
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
        <SiteHeader />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-8 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold">SMTP Configuration</h2>
              <p className="text-sm text-muted-foreground">
                Manage your SMTP server connections for sending emails.
              </p>
            </div>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
              <DialogTrigger render={<Button onClick={openCreate} />}>
                <PlusIcon />
                Add SMTP Config
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] overflow-y-auto gap-3 sm:max-w-[425px] sm:gap-4">
                <DialogHeader>
                  <DialogTitle>{editingId ? "Edit SMTP Configuration" : "Create SMTP Configuration"}</DialogTitle>
                  <DialogDescription>
                    {editingId ? "Update your SMTP server details." : "Add a new SMTP server to send emails through."}
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup className="py-1 gap-1.5 sm:gap-2">
                  <Field>
                    <FieldLabel htmlFor="hostname">SMTP Hostname</FieldLabel>
                    <Input
                      id="hostname"
                      placeholder="smtp.example.com"
                      value={hostname}
                      onChange={(e) => setHostname(e.target.value)}
                    />
                    <FieldDescription className="text-xs leading-snug sm:text-sm">
                      The SMTP server address (e.g., smtp.gmail.com)
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="username">SMTP Username</FieldLabel>
                    <Input
                      id="username"
                      placeholder="user@example.com"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    <FieldDescription className="text-xs leading-snug sm:text-sm">
                      Authentication username for the SMTP server.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="password">SMTP Password</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <FieldDescription className="text-xs leading-snug sm:text-sm">
                      {editingId ? "Leave blank to keep current password." : "Authentication password for the SMTP server."}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="senderEmail">Sender Email</FieldLabel>
                    <Input
                      id="senderEmail"
                      placeholder="noreply@example.com"
                      value={senderEmail}
                      onChange={(e) => setSenderEmail(e.target.value)}
                    />
                    <FieldDescription className="text-xs leading-snug sm:text-sm">
                      The email address emails will be sent from.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
                <DialogFooter className="flex-row justify-end">
                  <Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={submitting}>
                    {submitting ? "Saving..." : editingId ? "Save Changes" : "Create"}
                  </Button>
                </DialogFooter>
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
                    <ItemDescription>{config.senderEmail}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline" className={config.isActive ? "text-green-600" : "text-muted-foreground"}>
                      {config.isActive ? <CheckCircleIcon className="fill-green-500" /> : <XCircleIcon />}
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
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onClick={() => openEdit(config)}>
                          <PencilIcon />
                          Edit
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
      </SidebarInset>
    </SidebarProvider>
  )
}
