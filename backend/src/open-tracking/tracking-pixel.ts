/** Where the public pixel controller is mounted. */
export const TRACKING_PIXEL_ROUTE = "/t/o";

/** Path of the public pixel route; the token follows it. */
export const TRACKING_PIXEL_PATH = `${TRACKING_PIXEL_ROUTE}/`;

/**
 * The same URL with a pixel token replaced by `[redacted]`, for logs: the token is the only key to
 * an email's open counter, so it never goes to the request log. Other URLs are returned unchanged.
 */
export function redactTrackingToken(url: string): string {
  return url.replace(/\/t\/o\/[^/?#]*/, `${TRACKING_PIXEL_PATH}[redacted]`);
}

/**
 * Absolute URL of an email's pixel. The base is the origin the send request arrived on: the mail
 * client loads the image from outside the app, so a relative URL would not resolve.
 */
export function buildPixelUrl(baseUrl: string, token: string): string {
  const origin = new URL(baseUrl).origin;
  return `${origin}${TRACKING_PIXEL_PATH}${encodeURIComponent(token)}`;
}

/**
 * Adds the 1x1 tracking image to already-sanitized HTML, just before `</body>` when there is one,
 * else at the end. Must run after `cleanHtml`, so the sanitizer (and its CSS filter) can never
 * rewrite or drop the pixel.
 */
export function appendTrackingPixel(html: string, pixelUrl: string): string {
  const tag = `<img src="${escapeAttribute(pixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`;
  const closingBody = html.search(/<\/body\s*>/i);
  if (closingBody === -1) return `${html}${tag}`;
  return `${html.slice(0, closingBody)}${tag}${html.slice(closingBody)}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
