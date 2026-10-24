import { useCallback, useSyncExternalStore } from "react";
import {
  DARK_QUERY,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isTheme,
  resolveTheme,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme-config";

export { DEFAULT_THEME, THEME_STORAGE_KEY, isTheme, resolveTheme } from "@/lib/theme-config";
export type { ResolvedTheme, Theme } from "@/lib/theme-config";

const THEME_CHANGE_EVENT = "makisend:theme-change";

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
}

/** First render (server and hydration) matches the static HTML; React then reads the choice. */
const SERVER_STATE: ThemeState = { theme: DEFAULT_THEME, resolvedTheme: "light" };

const listeners = new Set<() => void>();
let snapshot: ThemeState | null = null;

function readStoredTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyResolved(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

function makeState(theme: Theme): ThemeState {
  const resolvedTheme = resolveTheme(theme);
  applyResolved(resolvedTheme);
  return { theme, resolvedTheme };
}

function getClientState(): ThemeState {
  if (snapshot === null) {
    const theme = readStoredTheme();
    snapshot = { theme, resolvedTheme: resolveTheme(theme) };
  }
  return snapshot;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Applies a theme, remembers it and mirrors the change to the other islands on the page. */
export function setTheme(theme: Theme): void {
  if (!isTheme(theme)) return;

  snapshot = makeState(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage disabled: the choice lasts for this page only
  }
  notify();
  window.dispatchEvent(
    new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }),
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }

  // The inline script already painted the right theme; this keeps the DOM in sync if the
  // stored choice changed between that script and hydration.
  applyResolved(getClientState().resolvedTheme);

  const media = window.matchMedia(DARK_QUERY);
  const onSystemChange = () => {
    if (getClientState().theme !== "system") return;
    snapshot = makeState("system");
    notify();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const theme = isTheme(event.newValue) ? event.newValue : DEFAULT_THEME;
    snapshot = makeState(theme);
    notify();
  };
  // Astro hydrates every island separately: the DOM event is what keeps their toggles in sync.
  const onThemeChange = (event: Event) => {
    const theme = (event as CustomEvent<unknown>).detail;
    if (!isTheme(theme) || getClientState().theme === theme) return;
    snapshot = makeState(theme);
    notify();
  };

  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);

  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  };
}

export function useTheme() {
  const state = useSyncExternalStore(subscribe, getClientState, () => SERVER_STATE);
  const set = useCallback((theme: Theme) => setTheme(theme), []);
  return { theme: state.theme, resolvedTheme: state.resolvedTheme, setTheme: set };
}
