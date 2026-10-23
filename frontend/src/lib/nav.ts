import { useSyncExternalStore } from "react"

/** True when `url` is the page being shown; "/dashboard" matches only itself, the others match their sub-paths too. */
export function isCurrent(url: string, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (url === "/dashboard") return path === "/dashboard"
  return path === url || path.startsWith(`${url}/`)
}

const noSubscription = () => () => {}

/**
 * The current pathname. The server snapshot is empty, so the first client render matches the
 * server HTML and React re-renders with the real path right after hydration (a value read during
 * render would differ between server and client, and React does not patch mismatched attributes).
 */
export function usePathname(): string {
  return useSyncExternalStore(noSubscription, () => window.location.pathname, () => "")
}
