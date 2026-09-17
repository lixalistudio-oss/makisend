const BASE = import.meta.env.PUBLIC_API_URL ?? ""

export function fetchApi(path: string, init?: RequestInit) {
  return fetch(`${BASE}${path}`, init)
}
