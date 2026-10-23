import { describe, it, expect } from "vitest";
import { app } from "@/index";
import type { Bindings } from "@/index";
import { openApiDocument } from "@/openapi";

const env = {
  AES_256_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  makisend_db: {} as D1Database,
} as unknown as Bindings;

const EXPECTED_PATHS = [
  "/send-email",
  "/smtp-config",
  "/smtp-config/check",
  "/smtp-config/{id}",
  "/smtp-config/{id}/check",
  "/smtp-config/{id}/test-send",
  "/api-keys",
  "/api-keys/{id}",
  "/email-logs",
  "/email-logs/{id}",
  "/dashboard/stats",
  "/dashboard/by-config",
  "/dashboard/by-api-key",
  "/dashboard/recent",
  "/dashboard/errors",
  "/templates",
  "/templates/{id}",
  "/templates/{id}/preview",
  "/openapi.json",
];

function resolveRef(ref: string): unknown {
  expect(ref.startsWith("#/")).toBe(true);
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((node, segment) => {
      expect(node).toBeTypeOf("object");
      return (node as Record<string, unknown>)[segment];
    }, openApiDocument);
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") refs.push(child);
      else collectRefs(child, refs);
    }
  }
  return refs;
}

describe("OpenAPI document", () => {
  it("is OpenAPI 3.1 and documents every mounted route", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    expect(openApiDocument.info.title).toBe("MakiSend API");
    expect(Object.keys(openApiDocument.paths).sort()).toEqual([...EXPECTED_PATHS].sort());
  });

  it("gives every operation an id, a tag, and at least one response", () => {
    for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        expect(operation.operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
        expect(operation.tags?.length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
        expect(Object.keys(operation.responses).length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("resolves every internal $ref", () => {
    const refs = collectRefs(openApiDocument);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(resolveRef(ref), ref).toBeDefined();
    }
  });

  it("keeps request schemas generated from the runtime DTOs", () => {
    const schemas = openApiDocument.components.schemas;

    expect(schemas.CreateSmtpConfig).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["smtpHostname", "smtpUsername", "smtpPassword", "senderEmail"]),
    });
    expect(schemas.CreateSmtpConfig.properties!.smtpPort).toMatchObject({
      type: "integer",
      default: 465,
    });
    expect(schemas.SendEmailPayload).toHaveProperty("anyOf");
    expect(schemas.SendEmailPayload.anyOf).toHaveLength(2);
    // Resend's attachment shape, on both the inline and the template branch.
    for (const branch of schemas.SendEmailPayload.anyOf as { properties: Record<string, { items?: { required?: string[] } }> }[]) {
      expect(branch.properties.attachments?.items?.required).toEqual(["filename", "content"]);
    }

    expect(schemas).not.toHaveProperty("$schema");
  });

  it("never exposes the SMTP password in the response schema", () => {
    expect(openApiDocument.components.schemas.SmtpConfig.properties).not.toHaveProperty("smtpPassword");
    expect(openApiDocument.components.schemas.CreateSmtpConfig.properties).toHaveProperty("smtpPassword");
  });
});

describe("API documentation routes", () => {
  it("serves the OpenAPI document as JSON", async () => {
    const res = await app.request("/openapi.json", undefined, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    await expect(res.json()).resolves.toMatchObject({ openapi: "3.1.0" });
  });

  it("serves Scalar with a nonce-based CSP", async () => {
    const res = await app.request("/docs", undefined, env);
    const html = await res.text();
    const nonce = html.match(/<meta property="csp-nonce" content="([^"]+)"/)?.[1];

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("MakiSend API Reference");
    expect(html).toContain("https://cdn.jsdelivr.net/npm/@scalar/api-reference");
    expect(nonce).toBeTruthy();
    expect(res.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(res.headers.get("content-security-policy")).toContain("script-src");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
