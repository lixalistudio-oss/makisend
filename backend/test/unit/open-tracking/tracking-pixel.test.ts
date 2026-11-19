import { describe, expect, it } from "vitest";
import { appendTrackingPixel, buildPixelUrl } from "@/open-tracking";

const TOKEN = "AbC123".padEnd(43, "x");

describe("buildPixelUrl", () => {
  it("joins the origin, the pixel path and the token", () => {
    expect(buildPixelUrl("https://makisend.example.workers.dev", TOKEN)).toBe(
      `https://makisend.example.workers.dev/t/o/${TOKEN}`,
    );
  });

  it("keeps only the origin of the base, whatever path or slash it has", () => {
    expect(buildPixelUrl("https://makisend.example.workers.dev/send-email?x=1", TOKEN)).toBe(
      `https://makisend.example.workers.dev/t/o/${TOKEN}`,
    );
    expect(buildPixelUrl("http://localhost:8787/", TOKEN)).toBe(`http://localhost:8787/t/o/${TOKEN}`);
  });

  it("throws on a base that is not a URL", () => {
    expect(() => buildPixelUrl("not a url", TOKEN)).toThrow();
  });
});

describe("appendTrackingPixel", () => {
  const url = `https://makisend.example.workers.dev/t/o/${TOKEN}`;

  it("inserts the image just before </body>", () => {
    const html = appendTrackingPixel("<html><body><p>Hi</p></body></html>", url);

    expect(html).toMatch(/^<html><body><p>Hi<\/p><img [^>]+><\/body><\/html>$/);
    expect(html).toContain(`src="${url}"`);
  });

  it("matches </body> regardless of case and spacing", () => {
    const html = appendTrackingPixel("<BODY><p>Hi</p></BODY >", url);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("</BODY >"));
  });

  it("appends at the end of a fragment without </body>", () => {
    const html = appendTrackingPixel("<p>Hi</p>", url);
    expect(html.startsWith("<p>Hi</p><img ")).toBe(true);
  });

  it("renders a 1x1 image with an empty alt, so nothing shows", () => {
    const html = appendTrackingPixel("<p>Hi</p>", url);
    expect(html).toContain('width="1"');
    expect(html).toContain('height="1"');
    expect(html).toContain('alt=""');
  });

  it("escapes the URL inside the attribute", () => {
    const html = appendTrackingPixel("<p>Hi</p>", 'https://x.test/t/o/a"onerror="b');
    expect(html).toContain('src="https://x.test/t/o/a&quot;onerror=&quot;b"');
    expect(html).not.toContain('"onerror="');
  });
});
