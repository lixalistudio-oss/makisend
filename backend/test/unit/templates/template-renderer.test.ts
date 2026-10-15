import { describe, it, expect } from "vitest";
import {
  extractVariables,
  renderTemplate,
  renderHtmlTemplate,
} from "@/templates/template-renderer";

describe("extractVariables", () => {
  it("extracts unique names in first-appearance order across all contents", () => {
    const names = extractVariables(
      "Bonjour {{username}},",
      "<p>Contactez {{username}} ou {{supportEmail}}</p>",
      "Texte: {{orderId}}",
    );
    expect(names).toEqual(["username", "supportEmail", "orderId"]);
  });

  it("accepts whitespace inside the braces", () => {
    expect(extractVariables("Hi {{ username }} / {{  email  }}")).toEqual(["username", "email"]);
  });

  it("ignores malformed markers", () => {
    expect(extractVariables("{{1bad}} {{}} {{with-dash}} {{}}")).toEqual([]);
  });

  it("returns an empty list when there are no markers", () => {
    expect(extractVariables("plain text")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("replaces variables with their values", () => {
    expect(
      renderTemplate("Bonjour {{username}}, votre commande {{orderId}}.", {
        username: "Joel",
        orderId: "42",
      }),
    ).toBe("Bonjour Joel, votre commande 42.");
  });

  it("ignores extra variables not present in the content", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Joel", unused: "x" })).toBe("Hi Joel");
  });

  it("leaves unknown markers untouched when a value is missing", () => {
    expect(renderTemplate("Hi {{name}}", {})).toBe("Hi {{name}}");
  });

  it("treats an empty string value as provided (marker replaced)", () => {
    expect(renderTemplate("Hi {{name}}!", { name: "" })).toBe("Hi !");
  });
});

describe("renderHtmlTemplate", () => {
  it("HTML-escapes values so they render as literal text", () => {
    expect(
      renderHtmlTemplate("<p>{{username}}</p>", { username: '<script>alert("x")</script>' }),
    ).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  });

  it("escapes ampersands in URLs used as values", () => {
    expect(
      renderHtmlTemplate('<a href="{{url}}">link</a>', { url: "https://x.test?a=1&b=2" }),
    ).toBe('<a href="https://x.test?a=1&amp;b=2">link</a>');
  });

  it("keeps the surrounding template markup untouched", () => {
    expect(renderHtmlTemplate("<h1>{{title}}</h1>", { title: "Bob" })).toBe("<h1>Bob</h1>");
  });
});
