import { describe, it } from "vitest";

describe("apiKeyMiddleware", () => {
  it.todo("should allow request with valid x-api-key header");
  it.todo("should allow request with valid Authorization Bearer header");
  it.todo("should reject request without API key");
  it.todo("should reject request with invalid API key");
  it.todo("should reject all requests when API key is empty");
});
