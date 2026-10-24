/**
 * Theme constants shared by the pre-paint script and the React store. No React import here:
 * `Layout.astro` only needs the storage key.
 */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: Theme = "system";

/** localStorage key of the theme the person chose (never written by anything else). */
export const THEME_STORAGE_KEY = "makisend.theme";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_QUERY).matches
  );
}

/** `system` follows the device; `light` and `dark` are explicit choices. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? (prefersDark() ? "dark" : "light") : theme;
}
