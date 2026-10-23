import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { cleanHtml } from "@/core/html-sanitizer";

/** A real email as rendered by React Email (the getitaja.com Sales form): an
    SVG logo, a `<style>` block with `@font-face`, rounded cards, borders and a
    styled button. */
const REAL_EMAIL = readFileSync(resolve(import.meta.dirname, "../../fixtures/react-email-sales-request.html"), "utf8");

/** A tag or attribute that can run script once the HTML is opened. Checked on
    the markup with attribute VALUES blanked: escaped text inside a value
    (`title="&lt;img onerror=…&gt;"`) is inert and must not count. */
const EXECUTABLE_MARKUP = /<script|<iframe|<object|<embed|<form|<base|<link|<meta[^>]+http-equiv|\son[a-z]+\s*=|<foreignobject|<animate|<set\b|<noscript/i;

/** A value that can run script: checked on the full output, values included. */
const EXECUTABLE_VALUE = /javascript:|vbscript:|data:text\/html|expression\s*\(|-moz-binding|behaviou?r\s*:|@import/i;

const EXECUTABLE = {
  test: (html: string) => EXECUTABLE_MARKUP.test(html.replace(/="[^"]*"/g, '=""')) || EXECUTABLE_VALUE.test(html),
};

describe("cleanHtml — removes what can execute or load something hostile", () => {
  const attacks: [string, string][] = [
    ["a script tag and its body", `<p>hi</p><script>alert(1)</script>`],
    ["a script with a source", `<script src="https://evil.example/x.js"></script>`],
    ["an event handler", `<img src="https://a.example/x.png" onerror="alert(1)">`],
    ["an event handler in upper case", `<div ONMOUSEOVER="alert(1)">x</div>`],
    ["a javascript: link", `<a href="javascript:alert(1)">x</a>`],
    ["a javascript: link with entities", `<a href="jav&#x61;script:alert(1)">x</a>`],
    ["a javascript: link with a tab", `<a href="java\tscript:alert(1)">x</a>`],
    ["a vbscript: link", `<a href="vbscript:msgbox(1)">x</a>`],
    ["a data: link", `<a href="data:text/html,<script>alert(1)</script>">x</a>`],
    ["an iframe", `<iframe src="https://evil.example"></iframe>`],
    ["an object", `<object data="https://evil.example/x.swf"></object>`],
    ["an embed", `<embed src="https://evil.example/x.swf">`],
    ["a form", `<form action="https://evil.example"><input name="password"><button>go</button></form>`],
    ["a meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.example">`],
    ["a base tag", `<base href="https://evil.example/">`],
    ["an external stylesheet", `<link rel="stylesheet" href="https://evil.example/x.css">`],
    ["an SVG with an onload handler", `<svg onload="alert(1)"><rect width="1" height="1"/></svg>`],
    ["an SVG script", `<svg><script>alert(1)</script></svg>`],
    ["an SVG foreignObject", `<svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>`],
    ["an SVG animation that rewrites a link", `<svg><a><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>`],
    ["an SVG set", `<svg><set attributeName="onmouseover" to="alert(1)"/></svg>`],
    ["a CSS expression", `<div style="width: expression(alert(1))">x</div>`],
    ["a CSS javascript: url", `<div style="background: url(javascript:alert(1))">x</div>`],
    ["an escaped CSS javascript: url", `<div style="background: url(\\6a avascript:alert(1))">x</div>`],
    ["a CSS -moz-binding", `<div style="-moz-binding: url(https://evil.example/x.xml#x)">x</div>`],
    ["a CSS behavior", `<div style="behavior: url(x.htc)">x</div>`],
    ["an @import", `<style>@import url("https://evil.example/x.css"); p { color: red }</style>`],
    ["an @import in a <style> with attributes", `<style type="text/css" media="all">@import url(https://evil.example/x.css); p { background: url(javascript:alert(1)) }</style>`],
    ["an @import in an upper-case <STYLE>", `<STYLE>@import "https://evil.example/x.css";</STYLE>`],
    ["two <style> blocks, the second one hostile", `<style>p{color:red}</style ><style>@import url(https://evil.example/x.css)</style>`],
    ["an SVG <style> with an @import", `<svg><style>@import url(https://evil.example/x.css)</style></svg>`],
    ["a style that closes itself early", `<style>p { content: "</style><script>alert(1)</script>" }</style>`],
    ["a mutation-XSS through a comment", `<!--<img src="--><img src=x onerror=alert(1)//">`],
    ["a noscript mutation", `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`],
  ];

  it.each(attacks)("neutralises %s", (_, html) => {
    expect(EXECUTABLE.test(cleanHtml(html))).toBe(false);
  });

  it("keeps the text around a removed script", () => {
    expect(cleanHtml(`<p>before</p><script>alert(1)</script><p>after</p>`)).toBe("<p>before</p><p>after</p>");
  });

  it("filters a <style> that carries attributes, and keeps its attributes", () => {
    expect(cleanHtml(`<style type="text/css">@import url(x.css); p { color: red }</style>`)).toBe(
      `<style type="text/css">p { color: red }</style>`,
    );
  });

  it("leaves a <style> written inside an attribute value as inert, escaped text", () => {
    expect(cleanHtml(`<p title="<style>@import url(x)</style>">t</p>`)).toBe(
      `<p title="&lt;style&gt;@import url(x)&lt;/style&gt;">t</p>`,
    );
  });

  it("drops a CSS url() pointing to a non-web scheme but keeps the rest of the rule", () => {
    expect(cleanHtml(`<style>p { color: red; background: url(file:///etc/passwd) }</style>`)).toBe(
      "<style>p { color: red }</style>",
    );
  });

  it("makes links open safely in a new tab", () => {
    expect(cleanHtml(`<a href="https://getitaja.com">x</a>`)).toBe(
      `<a href="https://getitaja.com" target="_blank" rel="noopener noreferrer">x</a>`,
    );
  });
});

describe("cleanHtml — leaves the design alone", () => {
  const clean = cleanHtml(REAL_EMAIL);

  it("contains nothing executable", () => {
    expect(EXECUTABLE.test(clean)).toBe(false);
  });

  it("keeps the inline SVG logo", () => {
    expect(clean).toMatch(/<svg[^>]*viewbox="0 0 135 267"/i);
    expect(clean.match(/<path /g)).toHaveLength(2);
    expect(clean).toContain('fill="#5FB8A3"');
  });

  it("keeps the <style> block and its @font-face", () => {
    expect(clean).toContain("<style>");
    expect(clean).toContain("@font-face");
    expect(clean).toContain("url('https://getitaja.com/fonts/bricolage-grotesque-latin-200-800.woff2')");
  });

  it("keeps every inline style the sender wrote", () => {
    for (const property of ["border-radius", "border:1px solid #D7E1DB", "letter-spacing", "text-decoration", "display:inline-block"]) {
      expect(REAL_EMAIL).toContain(property);
      expect(clean).toContain(property);
    }
    // Outlook conditional comments (`<!--[if mso]>`) are dropped with every
    // other comment; every style outside them survives.
    const outsideComments = REAL_EMAIL.replace(/<!--[\s\S]*?-->/g, "");
    expect(clean.match(/ style="/g)?.length).toBe(outsideComments.match(/ style="/g)?.length);
  });

  it("keeps the email-client meta tags", () => {
    expect(clean).toContain('<meta name="color-scheme" content="light" />');
  });

  it("is a fixed point: cleaning twice changes nothing", () => {
    expect(cleanHtml(clean)).toBe(clean);
  });

  it("keeps common email markup", () => {
    const html =
      `<table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FAF8F3" role="presentation">` +
      `<tr><td align="center" valign="top" style="padding:24px;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.1)">` +
      `<img src="https://getitaja.com/logo.png" width="90" height="37" alt="Itaja" style="display:block;border:0">` +
      `<img src="cid:logo@itaja" alt=""><img src="data:image/png;base64,iVBORw0KGgo=" alt="">` +
      `<a href="mailto:hello@getitaja.com" style="color:#0E5F52;text-decoration:underline">hello</a>` +
      `</td></tr></table>`;
    const out = cleanHtml(html);
    for (const kept of [
      `width="600"`, `bgcolor="#FAF8F3"`, `align="center"`, `valign="top"`,
      `border-radius:14px`, `box-shadow:0 1px 2px rgba(0,0,0,.1)`,
      `src="https://getitaja.com/logo.png"`, `src="cid:logo@itaja"`, `src="data:image/png;base64,iVBORw0KGgo="`,
      `href="mailto:hello@getitaja.com"`, `text-decoration:underline`,
    ]) {
      expect(out).toContain(kept);
    }
  });

  it("keeps @media queries (dark mode, mobile)", () => {
    const css = `<style>@media (prefers-color-scheme: dark) { .card { background: #0A1F1B } }</style>`;
    expect(cleanHtml(css)).toBe(css);
  });
});
