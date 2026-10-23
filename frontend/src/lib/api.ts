// Same-origin: the Worker serves both the frontend (static assets) and the
// Hono API, so no absolute base URL is needed anymore.
export function fetchApi(path: string, init?: RequestInit) {
  return fetch(path, { credentials: "include", ...init })
}
