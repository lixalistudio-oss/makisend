import { useEffect, useRef, useState } from "react"
import { toast, Toaster } from "sonner"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SessionGuard } from "@/components/session-guard"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  EyeIcon,
  LoaderIcon,
} from "lucide-react"
import { fetchApi } from "@/lib/api"
import { TemplateEditorDialog } from "@/components/template-editor-dialog"
import { TemplatePreviewDialog } from "@/components/template-preview-dialog"
import { extractVariables, type Template } from "@/lib/templates"
import { useTranslation } from "@/i18n"

interface EditorSession {
  key: number
  template: Template | null
}

export function TemplatesLayout() {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null)

  // Saved-template preview dialog.
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null)

  const editorSessionId = useRef(0)

  const fetchTemplates = async () => {
    try {
      const res = await fetchApi("/templates")
      const data = await res.json()
      setTemplates(data.templates ?? [])
    } catch {
      toast.error(t("templates.toast.loadFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplates()
  }, [])

  const openEditor = (template: Template | null = null) => {
    editorSessionId.current += 1
    setEditorSession({ key: editorSessionId.current, template })
  }

  const closeEditor = () => {
    setEditorSession(null)
  }

  const handleSaved = () => {
    setEditorSession(null)
    fetchTemplates()
  }

  const openPreview = (template: Template) => {
    setPreviewTemplate(template)
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchApi(`/templates/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      setTemplates(templates.filter((tpl) => tpl.id !== id))
      toast.success(t("templates.toast.deleted"))
    } catch {
      toast.error(t("templates.toast.deleteFailed"))
    }
  }

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      toast.success(t("templates.toast.idCopied"))
    } catch {
      toast.error(t("templates.toast.idCopyFailed"))
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader titleKey="nav.templates" />
        <SessionGuard>
        <div className="flex flex-1 flex-col gap-8 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-heading text-[1.75rem] leading-tight font-medium tracking-[-0.03em]">{t("templates.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("templates.subtitle")}
              </p>
            </div>
            <Button onClick={() => openEditor(null)}>
              <PlusIcon />
              {t("templates.new")}
            </Button>
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
                {t("templates.empty")}
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
                      {template.format === "react-email-code" ? t("templates.format.code") : t("templates.format.visual")}
                    </Badge>
                    <Badge variant="outline">
                      {t("templates.varsCount", { count: extractVariables(template.subject, template.html, template.text).length })}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openPreview(template)}
                      title={t("templates.preview")}
                    >
                      <EyeIcon />
                      <span className="sr-only">{t("templates.preview")}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => copyId(template.id)}
                      title={t("templates.copyId")}
                    >
                      <CopyIcon />
                      <span className="sr-only">{t("templates.copyId")}</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
                        <EllipsisVerticalIcon />
                        <span className="sr-only">{t("templates.actions")}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onClick={() => openEditor(template)}>
                          <PencilIcon />{t("templates.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(template.id)}>
                          <TrashIcon />{t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>

        {editorSession && (
          <TemplateEditorDialog
            key={editorSession.key}
            template={editorSession.template}
            onClose={closeEditor}
            onSaved={handleSaved}
          />
        )}

        {previewTemplate && (
          <TemplatePreviewDialog
            key={previewTemplate.id}
            template={previewTemplate}
            onClose={() => setPreviewTemplate(null)}
          />
        )}

        <Toaster position="top-right" />
        </SessionGuard>
      </SidebarInset>
    </SidebarProvider>
  )
}
