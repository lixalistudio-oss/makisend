import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  buildPreviewDoc,
  extractVariables,
  fillVariables,
  type Template,
} from "@/lib/templates"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import { useTranslation } from "@/i18n"

interface TemplatePreviewDialogProps {
  template: Template
  onClose: () => void
}

export function TemplatePreviewDialog({
  template,
  onClose,
}: TemplatePreviewDialogProps) {
  const { t } = useTranslation()
  const variables = useMemo(
    () => extractVariables(template.subject, template.html, template.text),
    [template]
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map((name) => [name, name]))
  )

  const subject = useMemo(
    () => fillVariables(template.subject, values),
    [template.subject, values]
  )
  const text = useMemo(
    () => fillVariables(template.text, values),
    [template.text, values]
  )
  const previewDocInput = useMemo(
    () => buildPreviewDoc(fillVariables(template.html, values, true)),
    [template.html, values]
  )
  const previewDoc = useDebouncedValue(previewDocInput, 250)

  return (
    <Dialog open onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("templates.previewTitle", { name: template.name })}</DialogTitle>
          <DialogDescription>
            {t("templates.previewDescription")}
          </DialogDescription>
        </DialogHeader>

        {variables.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t("templates.sampleValues")}
            </span>
            {variables.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <code className="w-28 shrink-0 truncate text-xs text-muted-foreground">
                  {`{{${name}}}`}
                </code>
                <Input
                  className="h-7 text-xs"
                  value={values[name] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border p-3">
          <span className="text-xs font-medium text-muted-foreground">{t("templates.subject")}</span>
          <p className="mt-1 text-sm font-medium">{subject || "—"}</p>
        </div>

        <iframe
          title={t("templates.savedPreviewFrame")}
          sandbox=""
          srcDoc={previewDoc}
          className="h-96 w-full rounded-lg border bg-white"
        />

        <div className="rounded-lg border p-3">
          <span className="text-xs font-medium text-muted-foreground">{t("templates.plainText")}</span>
          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {text || "—"}
          </pre>
        </div>

        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
