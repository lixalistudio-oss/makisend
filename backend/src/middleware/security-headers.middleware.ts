import { createMiddleware } from "hono/factory";

declare module "hono" {
  interface ContextVariableMap {
    cspNonce?: string;
  }
}

const DOCS_PATHS = new Set(["/docs", "/docs/"]);
const STRICT_CSP = "default-src 'none'; frame-ancestors 'none'";

function docsCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: https://cdn.jsdelivr.net",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Hardening headers for the API. API responses are JSON and may carry decrypted
 * recipients, so:
 * - `no-store` keeps them out of any browser or shared cache;
 * - `nosniff` stops content-type guessing;
 * - the default CSP forbids loading or framing anything;
 * - HSTS pins HTTPS (workers.dev is HTTPS-only anyway).
 *
 * `/docs` is the only rendered page; it gets a per-request nonce so Scalar can
 * load its bootstrap without relaxing the API's CSP.
 */
export function securityHeadersMiddleware() {
  return createMiddleware(async (c, next) => {
    // The Scalar reference is the only rendered page. It gets a per-request
    // nonce so its inline bootstrap and CDN script can run without weakening
    // the API's default `default-src 'none'` policy.
    const isDocs = DOCS_PATHS.has(c.req.path);
    if (isDocs) {
      c.set("cspNonce", crypto.randomUUID().replace(/-/g, ""));
    }

    await next();

    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    const nonce = c.get("cspNonce");
    c.res.headers.set(
      "Content-Security-Policy",
      isDocs && nonce ? docsCsp(nonce) : STRICT_CSP,
    );
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
  });
}
