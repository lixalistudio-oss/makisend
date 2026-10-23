import sanitizeHtml from "sanitize-html";
import { parse as parseCss, type Root } from "postcss";

/**
 * Sanitize the HTML of a transactional email.
 *
 * Goal: remove anything that can RUN or FETCH something hostile (scripts, event
 * handlers, `javascript:` links, frames, plugins, forms, CSS expressions) and
 * leave the design alone. The sender owns the layout: logos, `<style>` blocks,
 * rounded corners, borders, inline SVG and every other presentational property
 * go through untouched.
 *
 * The previous version did the opposite: it kept a short list of tags and
 * twelve CSS properties, so a normal email (React Email, MJML…) lost its
 * `<style>`, its SVG logo, its `border-radius`, its link colours and its
 * button styles.
 *
 * Two layers:
 *  1. Markup — an allowlist of TAGS that cannot execute anything, every
 *     presentational attribute, and a URL scheme check on links and images.
 *  2. CSS — both `style=""` and `<style>` go through the same filter, which
 *     drops the few CSS constructs that can execute or load something hostile.
 */
export function cleanHtml(html: string): string {
  const markup = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    // `<style>` is allowed on purpose: its content is filtered below.
    allowVulnerableTags: true,
    // Disallowed tags are dropped; the body of a `<script>` (or any other
    // raw-text element) goes with them, plain text around them stays.
    disallowedTagsMode: "discard",
    allowedAttributes: {
      "*": GLOBAL_ATTRIBUTES,
      a: ["href", "name", "target", "rel"],
      img: ["src", "srcset", "alt", "border", "usemap"],
      meta: ["name", "content", "charset"],
      ...Object.fromEntries(SVG_TAGS.map((tag) => [tag, SVG_ATTRIBUTES])),
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    // Images may also be embedded (`data:`) or attached (`cid:`).
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowProtocolRelative: false,
    // Inline styles are filtered by `cleanCss` (below), not by property name.
    parseStyleAttributes: false,
    transformTags: {
      "*": (tagName, attribs) => {
        if (attribs.style === undefined) return { tagName, attribs };
        const style = cleanCss(attribs.style, "inline");
        const next = { ...attribs };
        if (style) next.style = style;
        else delete next.style;
        return { tagName, attribs: next };
      },
      // Links open in a new tab without giving the target page a handle on ours.
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });

  // sanitize-html passes the body of an allowed `<style>` through raw. In its
  // output every text node and attribute value is escaped, so `<style` can
  // only open a real tag (with or without attributes, such as
  // `type="text/css"`), and its body ends at the first `</style>`.
  return markup.replace(/(<style\b[^>]*>)([\s\S]*?)<\/style>/gi, (_, open: string, css: string) => {
    const clean = cleanCss(css, "sheet");
    return clean ? `${open}${clean}</style>` : "";
  });
}

/* --------------------------------------------------------------- markup -- */

/** Every tag an email uses for layout and text. None of them can execute code,
    load a document, or submit data. Notably absent: script, iframe, frame,
    object, embed, applet, form, input, button, textarea, select, link, base,
    and the SVG elements that can run or pull in content (foreignObject, use,
    animate, set, image, script). */
const HTML_TAGS = [
  // Document
  "html", "head", "body", "title", "meta", "style",
  // Text
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "pre", "code", "div", "span",
  "blockquote", "address", "center", "font", "wbr",
  "strong", "b", "em", "i", "u", "s", "strike", "small", "big", "sub", "sup", "abbr",
  "cite", "data", "dfn", "kbd", "mark", "q", "samp", "time", "var", "del", "ins",
  // Lists
  "ul", "ol", "li", "dl", "dt", "dd",
  // Tables
  "table", "tbody", "thead", "tfoot", "tr", "td", "th", "col", "colgroup", "caption",
  // Media and links
  "img", "picture", "a", "map", "area", "figure", "figcaption",
  // Sections
  "article", "aside", "footer", "header", "main", "section", "nav",
];

/** Static, inert SVG: shapes, paths, text and paint servers. */
const SVG_TAGS = [
  "svg", "g", "defs", "desc", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "text", "tspan", "lineargradient", "radialgradient", "stop",
  "clippath", "mask", "pattern", "symbol",
];

const ALLOWED_TAGS = [...new Set([...HTML_TAGS, ...SVG_TAGS])];

/** Presentational and accessibility attributes. Event handlers (`on*`) are not
    in the list, so they are dropped. `href` and `background` still go through
    the scheme check. */
const GLOBAL_ATTRIBUTES = [
  "style", "class", "id", "dir", "lang", "title", "role", "align", "valign",
  "width", "height", "bgcolor", "background", "border", "cellpadding", "cellspacing",
  "colspan", "rowspan", "color", "face", "size", "span", "start", "type", "reversed",
  "datetime", "cite", "nowrap", "headers", "scope", "abbr", "hspace", "vspace",
  "shape", "coords", "href", "alt",
  "aria-*", "data-*",
];

const SVG_ATTRIBUTES = [
  "viewbox", "xmlns", "preserveaspectratio", "focusable",
  "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "dx", "dy",
  "points", "pathlength", "transform", "opacity",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
  "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform",
  "spreadmethod", "fx", "fy", "patternunits", "patterncontentunits",
  "patterntransform", "clippathunits", "maskunits", "maskcontentunits",
  "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline",
  "letter-spacing",
];

/* ------------------------------------------------------------------ CSS -- */

/** At-rules a stylesheet needs. `@import` (fetches another stylesheet, outside
    any filter) and anything unknown are dropped. */
const ALLOWED_AT_RULES = new Set(["media", "font-face", "supports", "keyframes", "-webkit-keyframes", "page"]);

/** Properties that bind a script to an element (Firefox XBL, IE HTC). */
const DANGEROUS_PROPERTIES = new Set(["-moz-binding", "behavior", "behaviour"]);

/** Values that execute script (old IE, Firefox XBL) or carry a script scheme. */
const DANGEROUS_VALUE = /expression\s*\(|javascript:|vbscript:|-moz-binding|behaviou?r\s*:/i;

/** What a CSS `url()` may load. `data:` covers embedded fonts and images. */
const SAFE_URL = /^(?:https?:|data:(?:image|font)\/|#)/i;

/**
 * Filter a stylesheet (`<style>` body) or a declaration list (`style=""`).
 * Returns an empty string when nothing safe is left, or when the CSS cannot be
 * parsed: unparseable CSS is dropped rather than passed through.
 */
function cleanCss(css: string, kind: "inline" | "sheet"): string {
  let root: Root;
  try {
    root = parseCss(kind === "inline" ? `x{${css}}` : css);
  } catch {
    return "";
  }

  root.walkAtRules((rule) => {
    if (!ALLOWED_AT_RULES.has(rule.name.toLowerCase())) rule.remove();
  });
  root.walkDecls((decl) => {
    if (DANGEROUS_PROPERTIES.has(decl.prop.toLowerCase()) || !isSafeValue(decl.value)) decl.remove();
  });
  // A rule the filter emptied is dead weight.
  root.walkRules((rule) => {
    if (!rule.nodes?.length) rule.remove();
  });

  let out: string;
  if (kind === "inline") {
    const rule = root.first;
    out = rule && rule.type === "rule" ? (rule.nodes ?? []).map((n) => n.toString()).join(";") : "";
  } else {
    out = root.toString();
  }
  // In valid CSS a `<` only appears inside a string or a comment. Escaping it
  // keeps a literal `</style>` from closing the tag early and reopening HTML.
  return out.trim().replace(/</g, "\\3c ");
}

/** Every `url(...)` must point to a safe target, and the value must not carry
    an executable construct, also once CSS escapes are decoded. */
function isSafeValue(value: string): boolean {
  const decoded = decodeCssEscapes(value);
  if (DANGEROUS_VALUE.test(decoded)) return false;
  for (const [, , url] of decoded.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!SAFE_URL.test(url.trim())) return false;
  }
  return true;
}

/** `\6a avascript:` is `javascript:` to a CSS parser: decode before checking. */
function decodeCssEscapes(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16) || 0xfffd))
    .replace(/\\(.)/g, "$1");
}
