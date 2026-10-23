import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EmailEditor,
  type EmailEditorProps,
  type EmailEditorRef,
} from "@react-email/editor";
import { Inspector } from "@react-email/editor/ui";
import "@react-email/editor/themes/default.css";
import { Button } from "@/components/ui/button";

export interface TemplateEditorSnapshot {
  html: string;
  text: string;
  editorJson: string;
}

export interface TemplateEditorHandle {
  getSnapshot: () => Promise<TemplateEditorSnapshot | null>;
  insertVariable: (name: string) => void;
}

interface TemplateEditorProps {
  initialContent?: string | null;
  onChange: (snapshot: TemplateEditorSnapshot) => void;
}

type EditorTheme = "basic" | "minimal";

interface BuilderDocument {
  version: 2;
  theme: EditorTheme;
  content: EmailEditorProps["content"];
}

const EMPTY_CONTENT = "<p></p>";
const DEFAULT_THEME: EditorTheme = "basic";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function restorePlaceholderCase(text: string, html: string): string {
  const names = [
    ...new Set(
      [...html.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  let normalized = text;
  for (const name of names) {
    const pattern = new RegExp(
      `\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`,
      "gi",
    );
    normalized = normalized.replace(pattern, `{{${name}}}`);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function themeFromContent(content: unknown): EditorTheme | null {
  if (!isRecord(content) || !Array.isArray(content.content)) return null;

  for (const node of content.content) {
    if (!isRecord(node) || node.type !== "globalContent") continue;
    const attrs = isRecord(node.attrs) ? node.attrs : null;
    const data = attrs && isRecord(attrs.data) ? attrs.data : null;
    if (data?.theme === "basic" || data?.theme === "minimal") {
      return data.theme;
    }
  }

  return null;
}

function parseInitialContent(value: string | null | undefined): {
  content: EmailEditorProps["content"];
  theme: EditorTheme;
} {
  if (!value) return { content: EMPTY_CONTENT, theme: DEFAULT_THEME };

  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) {
      if (
        parsed.version === 2 &&
        isRecord(parsed.content) &&
        (parsed.theme === "basic" || parsed.theme === "minimal")
      ) {
        return {
          content: parsed.content as EmailEditorProps["content"],
          theme: parsed.theme,
        };
      }

      if (parsed.type === "doc") {
        return {
          content: parsed as EmailEditorProps["content"],
          theme: themeFromContent(parsed) ?? DEFAULT_THEME,
        };
      }
    }
  } catch {
    // Legacy templates store HTML, which the editor accepts directly.
  }

  return { content: value, theme: DEFAULT_THEME };
}

function snapshot(
  editor: EmailEditorRef,
  theme: EditorTheme,
): Promise<TemplateEditorSnapshot> {
  const email = editor.getEmail();
  const editorJson = JSON.stringify({
    version: 2,
    theme,
    content: editor.getJSON(),
  } satisfies BuilderDocument);

  return email.then((value) => ({
    html: value.html,
    text: restorePlaceholderCase(value.text, value.html),
    editorJson,
  }));
}

export const TemplateEditor = memo(forwardRef<
  TemplateEditorHandle,
  TemplateEditorProps
>(function TemplateEditor({ initialContent, onChange }, ref) {
  const initial = useMemo(
    () => parseInitialContent(initialContent),
    [initialContent],
  );
  const [content, setContent] = useState<EmailEditorProps["content"]>(
    initial.content,
  );
  const [theme, setTheme] = useState<EditorTheme>(initial.theme);
  const [exporting, setExporting] = useState(false);

  const editorRef = useRef<EmailEditorRef | null>(null);
  const onChangeRef = useRef(onChange);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  onChangeRef.current = onChange;

  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (exportTimer.current) clearTimeout(exportTimer.current);
    };
  }, []);

  const scheduleSnapshot = (editor: EmailEditorRef) => {
    if (exportTimer.current) clearTimeout(exportTimer.current);
    exportTimer.current = setTimeout(() => {
      void snapshot(editor, themeRef.current).then((value) =>
        onChangeRef.current(value),
      );
    }, 250);
  };

  useImperativeHandle(ref, () => ({
    getSnapshot: async () => {
      const editor = editorRef.current;
      if (!editor) return null;
      return snapshot(editor, themeRef.current);
    },
    insertVariable: (name: string) => {
      editorRef.current?.editor
        ?.chain()
        .focus()
        .insertContent(`{{${name}}}`)
        .run();
    },
  }));

  const switchTheme = (next: EditorTheme) => {
    if (next === theme) return;
    const current = editorRef.current?.getJSON();
    if (current) setContent(current);
    setTheme(next);
  };

  const exportHtml = async () => {
    if (!editorRef.current) return;
    setExporting(true);
    try {
      const html = await editorRef.current.getEmailHTML();
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "email-template.html";
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="template-builder">
      <div className="template-builder-toolbar">
        <div
          className="template-builder-theme-group"
          role="group"
          aria-label="Email theme"
        >
          <button
            type="button"
            className="template-builder-theme"
            data-active={theme === "basic"}
            onClick={() => switchTheme("basic")}
          >
            Basic theme
          </button>
          <button
            type="button"
            className="template-builder-theme"
            data-active={theme === "minimal"}
            onClick={() => switchTheme("minimal")}
          >
            Minimal theme
          </button>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={exportHtml}
          disabled={exporting}
        >
          {exporting ? "Exporting..." : "Export HTML"}
        </Button>
      </div>

      <div className="template-editor-shell">
        <EmailEditor
          ref={editorRef}
          content={content}
          theme={theme}
          placeholder="Write your email, or type / for blocks"
          onReady={scheduleSnapshot}
          onUpdate={scheduleSnapshot}
          className="template-builder-canvas"
        >
          <Inspector.Root className="template-builder-inspector">
            <Inspector.Breadcrumb />
            <Inspector.Document />
            <Inspector.Node />
            <Inspector.Text />
          </Inspector.Root>
        </EmailEditor>
      </div>
    </div>
  );
}));
