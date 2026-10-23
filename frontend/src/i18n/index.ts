import { useCallback, useEffect, useSyncExternalStore } from "react"
import en from "./en"
import fr from "./fr"
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  intlLocale,
  resolveInitialLanguage,
  type Language,
} from "./config"

export { LANGUAGES, type Language } from "./config"

/** Every UI key, taken from the reference language. */
export type UiKey = keyof typeof en
export type Params = Record<string, string | number>

/** `fr` is typed on `en`'s keys: a missing translation is a type error (`tsc --noEmit`). */
const dictionaries: Record<Language, Record<UiKey, string>> = { en, fr }

/** `{name}` placeholders. A missing parameter stays visible as `{name}` rather than vanishing. */
export function format(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export function translate(lang: Language, key: UiKey, params?: Params): string {
  return format(dictionaries[lang][key] ?? dictionaries.en[key] ?? key, params)
}

// ---- store: one language for the whole page, shared by every island ----

let current: Language | null = null
const listeners = new Set<() => void>()

function readInitial(): Language {
  let saved: string | null = null
  try {
    saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  } catch {
    // storage disabled: fall back to the browser languages
  }
  return resolveInitialLanguage(saved, window.navigator.languages ?? [window.navigator.language])
}

function getLanguage(): Language {
  if (current === null) current = readInitial()
  return current
}

/** Applies a language. `persist` is true only for a choice the person made. */
export function setLanguage(lang: Language, { persist = true }: { persist?: boolean } = {}) {
  current = lang
  if (persist) {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
    } catch {
      // storage disabled: the choice lasts for this page only
    }
  }
  document.documentElement.lang = lang
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab changed the language: follow it.
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANGUAGE_STORAGE_KEY) {
      current = null
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/**
 * The current language. The server snapshot is the default language, so the first client
 * render matches the static HTML; React re-renders in the person's language right after
 * hydration.
 */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, () => DEFAULT_LANGUAGE)
}

export function useTranslation() {
  const lang = useLanguage()
  const t = useCallback((key: UiKey, params?: Params) => translate(lang, key, params), [lang])
  const locale = intlLocale(lang)
  return { t, lang, locale, setLanguage }
}

/** Keeps `<html lang>` and `document.title` in the current language. */
export function useDocumentTitle(titleKey: UiKey) {
  const { t, lang } = useTranslation()
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t(titleKey)
  }, [lang, t, titleKey])
}
