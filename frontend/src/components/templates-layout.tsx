import { useEffect, useMemo, useState } from "react"
import { toast, Toaster } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import {
  LayoutTemplateIcon,
  PlusIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  CopyIcon,
  LoaderIcon,
} from "lucide-react"
import { fetchApi } from "@/lib/api"

interface Template {
  id: string
  name: string
  subject: string
  html: string
  text: string
  createdAt: string
  updatedAt: string
}

// Same placeholder syntax as backend/src/templates/template-renderer.ts.
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function extractVariables(...sources: string[]): string[] {
  const names = new Set<string>()
  for (const src of sources) {
    for (const match of src.matchAll(VARIABLE_PATTERN)) {
      names.add(match[1])
    }
  }
  return [...names]
}

// Mirror of the backend HTML escaping so the preview matches what gets sent.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function fillVariables(source: string, values: Record<string, string>): string {
  return source.replace(VARIABLE_PATTERN, (_match, name: string) =>
    escapeHtml(values[name] ?? name)
  )
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as {
      error?: string
      details?: { fieldErrors?: Record<string, string[] | undefined> }
    }
    const fieldErrors = data.details?.fieldErrors
    if (fieldErrors) {
      const first = Object.values(fieldErrors).find((v) => v && v[0])
      if (first?.[0]) return first[0]
    }
    return data.error ?? fallback
  } catch {
    return fallback
  }
}

export function TemplatesLayout() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [subject, setSubject] = useState("")
  const [html, setHtml] = useState("")
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Sample values fed into the live preview; keys appear as variables are typed.
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({})

  const variables = useMemo(
    () => extractVariables(subject, html, text),
    [subject, html, text]
  )

  const previewValues = useMemo(() => {
    const values: Record<string, string> = {}
    for (const varName of variables) {
      values[varName] = sampleValues[varName] ?? varName
    }
    return values
  }, [variables, sampleValues])

  const previewSubject = useMemo(
    () => fillVariables(subject, previewValues),
    [subject, previewValues]
  )

  const previewDoc = useMemo(() => {
    const rendered = fillVariables(html, previewValues)
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:1rem;color:#111;background:#fff;line-height:1.5}img{max-width:100%}</style></head><body>${rendered}</body></html>`
  }, [html, previewValues])

  const fetchTemplates = async () => {
    try {
      const res = await fetchApi("/templates")
      const data = await res.json()
      setTemplates(data.templates ?? [])
    } catch {
      toast.error("Failed to load templates")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplates()
  }, [])

  const resetForm = () => {
    setName("")
    setSubject("")
    setHtml("")
    setText("")
    setEditingId(null)
    setSampleValues({})
  }

  const openCreate = () => {
    resetForm()
    setOpen(true)
  }

  const openEdit = (template: Template) => {
    setEditingId(template.id)
    setName(template.name)
    setSubject(template.subject)
    setHtml(template.html)
    setText(template.text)
    setSampleValues({})
    setOpen(true)
  }

  const handleSubmit = async () => {
    if (!name || !subject || !html || !text) {
      toast.error("All fields are required")
      return
    }

    setSubmitting(true)
    try {
      const body = JSON.stringify({ name, subject, html, text })
      if (editingId) {
        const res = await fetchApi(`/templates/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update"))
        toast.success("Template updated")
      } else {
        const res = await fetchApi("/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create"))
        toast.success("Template created")
      }
      resetForm()
      setOpen(false)
      fetchTemplates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchApi(`/templates/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      setTemplates(templates.filter((t) => t.id !== id))
      toast.success("Template deleted")
    } catch {
      toast.error("Failed to delete template")
    }
  }

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      toast.success("Template ID copied")
    } catch {
      toast.error("Failed to copy ID")
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
              <h2 className="text-2xl font-bold">Email Templates</h2>
              <p className="text-sm text-muted-foreground">
                Reusable templates with {"{{variable}}"} placeholders, sent through the API with
                templateId and variables.
              </p>
            </div>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
              <DialogTrigger render={<Button onClick={openCreate} />}>
                <PlusIcon />
                New Template
              </DialogTrigger>
              <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                  <DialogTitle>{editingId ? "Edit Template" : "Create Template"}</DialogTitle>
                  <DialogDescription>
                    Use {"{{variable}}"} placeholders in the subject and bodies. Callers pass the
                    values at send time via the API.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 md:grid-cols-2">
                  <FieldGroup className="gap-3">
                    <Field>
                      <FieldLabel htmlFor="tpl-name">Name</FieldLabel>
                      <Input
                        id="tpl-name"
                        placeholder="Welcome email"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="tpl-subject">Subject</FieldLabel>
                      <Input
                        id="tpl-subject"
                        placeholder="Welcome {{username}}!"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="tpl-html">HTML body</FieldLabel>
                      <Textarea
                        id="tpl-html"
                        rows={10}
                        className="font-mono text-xs"
                        placeholder="<h1>Hello {{username}}</h1>"
                        value={html}
                        onChange={(e) => setHtml(e.target.value)}
                      />
                      <FieldDescription className="text-xs">
                        Rendered on send; variable values are HTML-escaped.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="tpl-text">Plain text body</FieldLabel>
                      <Textarea
                        id="tpl-text"
                        rows={5}
                        className="font-mono text-xs"
                        placeholder="Hello {{username}}"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Live preview</span>
                      <Badge variant="outline">
                        {variables.length} {variables.length === 1 ? "variable" : "variables"}
                      </Badge>
                    </div>

                    {variables.length > 0 && (
                      <div className="flex flex-col gap-2 rounded-lg border p-3">
                        <span className="text-xs font-medium text-muted-foreground">
                          Sample values
                        </span>
                        {variables.map((varName) => (
                          <div key={varName} className="flex items-center gap-2">
                            <code className="w-28 shrink-0 truncate text-xs text-muted-foreground">
                              {`{{${varName}}}`}
                            </code>
                            <Input
                              className="h-7 text-xs"
                              placeholder={varName}
                              value={sampleValues[varName] ?? ""}
                              onChange={(e) =>
                                setSampleValues((prev) => ({ ...prev, [varName]: e.target.value }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="rounded-lg border p-3">
                      <span className="text-xs font-medium text-muted-foreground">Subject</span>
                      <p className="mt-1 text-sm font-semibold">{previewSubject || "—"}</p>
                    </div>

                    {html ? (
                      <iframe
                        title="Template preview"
                        sandbox=""
                        srcDoc={previewDoc}
                        className="h-72 w-full rounded-lg border bg-white"
                      />
                    ) : (
                      <div className="flex h-72 items-center justify-center rounded-lg border border-dashed">
                        <p className="text-sm text-muted-foreground">
                          The HTML preview appears here.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
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
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <LayoutTemplateIcon className="size-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                No templates yet. Create one to reuse email content across sends.
              </p>
            </div>
          ) : (
            <ItemGroup className="gap-5">
              {templates.map((template) => (
                <Item key={template.id} variant="outline" className="py-4 px-4 gap-5">
                  <ItemMedia variant="icon" className="size-10">
                    <LayoutTemplateIcon className="size-5" />
                  </ItemMedia>
                  <ItemContent className="gap-1.5">
                    <ItemTitle className="text-base">{template.name}</ItemTitle>
                    <ItemDescription className="truncate">{template.subject}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline">
                      {extractVariables(template.subject, template.html, template.text).length}{" "}
                      vars
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => copyId(template.id)}
                      title="Copy template ID"
                    >
                      <CopyIcon />
                      <span className="sr-only">Copy template ID</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
                        <EllipsisVerticalIcon />
                        <span className="sr-only">Actions</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onClick={() => openEdit(template)}>
                          <PencilIcon />Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(template.id)}>
                          <TrashIcon />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
        <Toaster position="top-right" />
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
