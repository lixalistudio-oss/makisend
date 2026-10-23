import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import {
  Code2Icon,
  LoaderIcon,
  PlayIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  TemplateEditor,
  type TemplateEditorHandle,
  type TemplateEditorSnapshot,
} from "@/components/template-editor"
import { fetchApi } from "@/lib/api"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import {
  buildPreviewDoc,
  extractVariables,
  fillVariables,
  type Template,
} from "@/lib/templates"
import {
  renderReactEmailCode,
  type ReactEmailCodeSnapshot,
} from "@/lib/react-email-code"
import { useTranslation } from "@/i18n"

const EMPTY_SNAPSHOT: TemplateEditorSnapshot = {
  html: "",
  text: "",
  editorJson: "",
}

const CODE_EXAMPLE = `import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

export const variables = ["name"];

export default function WelcomeEmail({ name }: { name: string }) {
  return (
    <Html>
      <Head />
      <Preview>Welcome aboard</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "24px" }}>
        <Container>
          <Heading>Hello {name}</Heading>
          <Text>Thanks for joining. We are glad you are here.</Text>
        </Container>
      </Body>
    </Html>
  );
}`

type EditorMode = "visual" | "code"

interface TemplateEditorDialogProps {
  template: Template | null
  onClose: () => void
  onSaved: () => void
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

interface LivePreviewProps {
  subject: string
  html: string
  text: string
  variables: string[]
  sampleValues: Record<string, string>
  onSampleChange: (name: string, value: string) => void
}

const LivePreview = memo(function LivePreview({
  subject,
  html,
  text,
  variables,
  sampleValues,
  onSampleChange,
}: LivePreviewProps) {
  const { t } = useTranslation()
  const values = useMemo(() => {
    const next: Record<string, string> = {}
    for (const name of variables) {
      next[name] = sampleValues[name] ?? name
    }
    return next
  }, [variables, sampleValues])

  const previewSubject = useMemo(
    () => fillVariables(subject, values),
    [subject, values]
  )
  const previewText = useMemo(
    () => fillVariables(text, values),
    [text, values]
  )
  const previewDocInput = useMemo(
    () => buildPreviewDoc(fillVariables(html, values, true)),
    [html, values]
  )
  // Keep iframe navigation from firing on every keystroke/editor snapshot.
  const previewDoc = useDebouncedValue(previewDocInput, 250)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("templates.livePreview")}</span>
        <Badge variant="outline">
          {t(variables.length === 1 ? "templates.variableCount.one" : "templates.variableCount.other", { count: variables.length })}
        </Badge>
      </div>

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
                placeholder={name}
                value={sampleValues[name] ?? ""}
                onChange={(e) => onSampleChange(name, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border p-3">
        <span className="text-xs font-medium text-muted-foreground">{t("templates.subject")}</span>
        <p className="mt-1 text-sm font-medium">{previewSubject || "—"}</p>
      </div>

      {html ? (
        <iframe
          title={t("templates.previewFrame")}
          sandbox=""
          srcDoc={previewDoc}
          className="h-72 w-full rounded-lg border bg-white"
        />
      ) : (
        <div className="flex h-72 items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            {t("templates.htmlPreviewEmpty")}
          </p>
        </div>
      )}

      <div className="rounded-lg border p-3">
        <span className="text-xs font-medium text-muted-foreground">
          {t("templates.plainText")}
        </span>
        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {previewText || "—"}
        </pre>
      </div>
    </div>
  )
})

export function TemplateEditorDialog({
  template,
  onClose,
  onSaved,
}: TemplateEditorDialogProps) {
  const { t } = useTranslation()
  const isCodeTemplate = template?.format === "react-email-code"
  const editingId = template?.id ?? null

  const [name, setName] = useState(template?.name ?? "")
  const [subject, setSubject] = useState(template?.subject ?? "")
  const [initialContent, setInitialContent] = useState<string | null>(
    template ? (template.editorJson ?? template.html) : "<p></p>"
  )
  const [editorSnapshot, setEditorSnapshot] =
    useState<TemplateEditorSnapshot>(EMPTY_SNAPSHOT)
  const [editorKey, setEditorKey] = useState(0)
  const [mode, setMode] = useState<EditorMode>(isCodeTemplate ? "code" : "visual")
  const [source, setSource] = useState(template?.source ?? "")
  const [codeSnapshot, setCodeSnapshot] = useState<ReactEmailCodeSnapshot | null>(
    isCodeTemplate && template
      ? { html: template.html, text: template.text, variables: [] }
      : null
  )
  const [codeError, setCodeError] = useState<string | null>(null)
  const [codeRendering, setCodeRendering] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [newVariable, setNewVariable] = useState("")
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({})

  const editorRef = useRef<TemplateEditorHandle>(null)
  const codeRenderSeq = useRef(0)

  const activeHtml = mode === "visual" ? editorSnapshot.html : (codeSnapshot?.html ?? "")
  const activeText = mode === "visual" ? editorSnapshot.text : (codeSnapshot?.text ?? "")

  const variables = useMemo(() => {
    const names = extractVariables(subject, activeHtml, activeText)
    if (mode === "code" && codeSnapshot) {
      for (const name of codeSnapshot.variables) {
        if (!names.includes(name)) names.push(name)
      }
    }
    return names
  }, [subject, activeHtml, activeText, mode, codeSnapshot])

  const renderCode = useCallback(async (value: string) => {
    const seq = codeRenderSeq.current + 1
    codeRenderSeq.current = seq
    setCodeRendering(true)
    setCodeError(null)

    try {
      const result = await renderReactEmailCode(value)
      if (seq === codeRenderSeq.current) {
        setCodeSnapshot(result)
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : t("templates.error.renderFailed")
      if (seq === codeRenderSeq.current) {
        setCodeSnapshot(null)
        setCodeError(message)
      }
      throw new Error(message)
    } finally {
      if (seq === codeRenderSeq.current) {
        setCodeRendering(false)
      }
    }
  }, [t])

  useEffect(() => {
    if (mode !== "code" || !source.trim()) return
    const timer = setTimeout(() => {
      void renderCode(source).catch(() => {})
    }, 700)
    return () => clearTimeout(timer)
  }, [mode, source, renderCode])

  const switchMode = (next: EditorMode) => {
    if (next === mode) return
    if (next === "visual") {
      setInitialContent(editorSnapshot.editorJson || "<p></p>")
      setEditorKey((key) => key + 1)
    } else if (!source.trim()) {
      setSource("")
    }
    setMode(next)
  }

  const addVariable = () => {
    const variableName = newVariable.trim()
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variableName)) {
      toast.error(t("templates.error.variableName"))
      return
    }
    editorRef.current?.insertVariable(variableName)
    setNewVariable("")
  }

  const handleSampleChange = useCallback((variableName: string, value: string) => {
    setSampleValues((prev) => ({ ...prev, [variableName]: value }))
  }, [])

  const handleSubmit = async () => {
    if (!name || !subject) {
      toast.error(t("templates.error.nameSubjectRequired"))
      return
    }
    if (mode === "code" && !source.trim()) {
      toast.error(t("templates.error.codeRequired"))
      return
    }

    setSubmitting(true)
    try {
      let body: string

      if (mode === "visual") {
        const fresh = await editorRef.current?.getSnapshot()
        const current = fresh ?? editorSnapshot
        if (!current.html || !current.text) {
          toast.error(t("templates.error.contentRequired"))
          return
        }
        body = JSON.stringify({
          name,
          subject,
          format: "react-email",
          editorJson: current.editorJson,
          html: current.html,
          text: current.text,
        })
      } else {
        const current = await renderCode(source)
        if (!current.html || !current.text) {
          toast.error(t("templates.error.emptyRender"))
          return
        }
        body = JSON.stringify({
          name,
          subject,
          format: "react-email-code",
          source,
          html: current.html,
          text: current.text,
        })
      }

      if (editingId) {
        const res = await fetchApi(`/templates/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!res.ok) throw new Error(await readErrorMessage(res, t("templates.error.updateFailed")))
        toast.success(t("templates.toast.updated"))
      } else {
        const res = await fetchApi("/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!res.ok) throw new Error(await readErrorMessage(res, t("templates.error.createFailed")))
        toast.success(t("templates.toast.created"))
      }

      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("templates.error.saveFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-7xl">
        <DialogHeader>
          <DialogTitle>{editingId ? t("templates.editTitle") : t("templates.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("templates.editorDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
          <div className="flex flex-col gap-3">
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="tpl-name">{t("templates.name")}</FieldLabel>
                <Input
                  id="tpl-name"
                  placeholder={t("templates.namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tpl-subject">{t("templates.subject")}</FieldLabel>
                <Input
                  id="tpl-subject"
                  placeholder={t("templates.subjectPlaceholder")}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </Field>
            </FieldGroup>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{t("templates.emailBody")}</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "visual" ? "default" : "outline"}
                  onClick={() => switchMode("visual")}
                >
                  {t("templates.mode.visual")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "code" ? "default" : "outline"}
                  onClick={() => switchMode("code")}
                >
                  <Code2Icon />
                  {t("templates.mode.code")}
                </Button>
              </div>
            </div>

            {mode === "visual" ? (
              <>
                <TemplateEditor
                  key={editorKey}
                  ref={editorRef}
                  initialContent={initialContent}
                  onChange={setEditorSnapshot}
                />
                <p className="text-xs text-muted-foreground">
                  {t("templates.canvasHintBefore")} <code>/</code>{" "}
                  {t("templates.canvasHintAfter")}
                </p>

                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <FieldLabel htmlFor="tpl-variable">{t("templates.insertVariable")}</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="tpl-variable"
                      placeholder="username"
                      value={newVariable}
                      onChange={(e) => setNewVariable(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addVariable()
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addVariable}>
                      {t("templates.insert")}
                    </Button>
                  </div>
                  <FieldDescription className="text-xs">
                    {t("templates.insertVariableHelp")}
                  </FieldDescription>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <Textarea
                  aria-label={t("templates.sourceLabel")}
                  spellCheck={false}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={CODE_EXAMPLE}
                  className="min-h-96 resize-y font-mono text-xs leading-relaxed"
                />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="max-w-md text-xs text-muted-foreground">
                    {t("templates.codeHintBefore")}{" "}
                    <code className="rounded bg-muted px-1">variables</code>{" "}
                    {t("templates.codeHintAfter")}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSource(CODE_EXAMPLE)}
                    >
                      {t("templates.useExample")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void renderCode(source).catch(() => {})}
                      disabled={codeRendering || !source.trim()}
                    >
                      {codeRendering ? (
                        <LoaderIcon className="animate-spin" />
                      ) : (
                        <PlayIcon />
                      )}
                      {t("templates.previewButton")}
                    </Button>
                  </div>
                </div>
                {codeError && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    {codeError}
                  </p>
                )}
              </div>
            )}
          </div>

          <LivePreview
            subject={subject}
            html={activeHtml}
            text={activeText}
            variables={variables}
            sampleValues={sampleValues}
            onSampleChange={handleSampleChange}
          />
        </div>
        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t("templates.saving") : editingId ? t("templates.saveChanges") : t("templates.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
