import { createMiddleware } from "hono/factory";

/**
 * Hardening headers for the API. Every response is JSON (never rendered), and
 * authenticated ones can carry decrypted SMTP credentials, so:
 * - `no-store` keeps them out of any browser or shared cache;
 * - `nosniff` stops content-type guessing;
 * - the CSP forbids loading or framing anything if a response were ever rendered;
 * - HSTS pins HTTPS (workers.dev is HTTPS-only anyway).
 */
export function securityHeadersMiddleware() {
  return createMiddleware(async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
  });
}
