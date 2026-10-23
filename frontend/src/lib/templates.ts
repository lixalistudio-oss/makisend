export interface Template {
  id: string
  name: string
  subject: string
  format: "legacy" | "react-email" | "react-email-code"
  editorJson: string | null
  source: string | null
  html: string
  text: string
  createdAt: string
  updatedAt: string
}

// Same placeholder syntax as backend/src/templates/template-renderer.ts.
export const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function extractVariables(...sources: string[]): string[] {
  const names = new Set<string>()
  for (const src of sources) {
    for (const match of src.matchAll(VARIABLE_PATTERN)) {
      names.add(match[1])
    }
  }
  return [...names]
}

// Mirror of the backend HTML escaping so the preview matches what gets sent.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function fillVariables(
  source: string,
  values: Record<string, string>,
  escapeValues = false
): string {
  return source.replace(VARIABLE_PATTERN, (_match, name: string) =>
    escapeValues ? escapeHtml(values[name] ?? name) : (values[name] ?? name)
  )
}

export function buildPreviewDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:1rem;color:#111;background:#fff;line-height:1.5}img{max-width:100%}</style></head><body>${html}</body></html>`
}
