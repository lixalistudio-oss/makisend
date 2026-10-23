/**
 * The one table of languages. Everything that depends on the language (dictionaries, the
 * switcher, `<html lang>`, date and number formatting) derives from it: adding a language
 * is a row here plus a folder of dictionaries typed on `en`.
 */
export const LANGUAGES = [
  { code: "en", nativeName: "English", intl: "en-US", dir: "ltr" },
  { code: "fr", nativeName: "Français", intl: "fr-FR", dir: "ltr" },
] as const

export type Language = (typeof LANGUAGES)[number]["code"]

export const DEFAULT_LANGUAGE: Language = "en"

/** localStorage key of the language the person chose (never written by anything else). */
export const LANGUAGE_STORAGE_KEY = "makisend.language"

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((lang) => lang.code === value)
}

/** `fr-BE` → `fr`; unknown → undefined. */
export function matchLanguage(tag: string | null | undefined): Language | undefined {
  if (!tag) return undefined
  const base = tag.toLowerCase().split("-")[0]
  return isLanguage(base) ? base : undefined
}

/**
 * Priority: the saved choice > the browser's languages > the product default. The only place
 * that decides the starting language.
 */
export function resolveInitialLanguage(saved: string | null, browserLanguages: readonly string[]): Language {
  const fromSaved = matchLanguage(saved)
  if (fromSaved) return fromSaved
  for (const tag of browserLanguages) {
    const match = matchLanguage(tag)
    if (match) return match
  }
  return DEFAULT_LANGUAGE
}

export function intlLocale(lang: Language): string {
  return LANGUAGES.find((l) => l.code === lang)?.intl ?? "en-US"
}
