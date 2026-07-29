import sanitizeHtml from "sanitize-html";

/**
 * Sanitize HTML for transactional emails.
 * Strips everything unsafe while keeping email-layout essentials:
 * tables with sizing, inline styles, links, images.
 */
export function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      // Text
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr", "pre", "code",
      "div", "span", "blockquote",
      "address",
      // Inline formatting
      "strong", "b", "em", "i", "u", "s", "small",
      "sub", "sup", "abbr", "cite", "data", "dfn",
      "kbd", "mark", "q", "samp", "time", "var",
      // Lists
      "ul", "ol", "li", "dl", "dt", "dd",
      // Table (email layout backbone)
      "table", "tbody", "thead", "tfoot",
      "tr", "td", "th", "col", "colgroup", "caption",
      // Media
      "img",
      // Links
      "a",
      // Semantic
      "article", "aside", "footer", "header", "main", "section",
    ],
    allowedAttributes: {
      // Links
      a: ["href", "title", "target", "rel"],
      // Images
      img: ["src", "alt", "title", "width", "height", "style"],
      // Table layout — essential for email clients
      table: ["width", "border", "cellpadding", "cellspacing", "role", "align"],
      td: ["width", "height", "align", "valign", "colspan", "rowspan", "style"],
      th: ["width", "height", "align", "valign", "colspan", "rowspan", "style"],
      col: ["width"],
      // Inline styles on block elements
      div: ["style"],
      p: ["style"],
      span: ["style"],
    },
    // Allow inline styles (safe — sanitize-html strips expression() / url() with JS)
    allowedStyles: {
      "*": {
        "color": [/.*/],
        "background-color": [/.*/],
        "text-align": [/.*/],
        "font-size": [/.*/],
        "font-family": [/.*/],
        "font-weight": [/.*/],
        "line-height": [/.*/],
        "margin": [/.*/],
        "padding": [/.*/],
        "border": [/.*/],
        "width": [/.*/],
        "max-width": [/.*/],
      },
    },
    // No iframes in transactional email — most clients strip them anyway
    allowedIframeHostnames: [],
    // Force target="_blank" links to open safely
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer",
      }),
    },
  });
}
