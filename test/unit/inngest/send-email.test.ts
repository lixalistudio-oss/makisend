import { describe, it, vi, expect, beforeEach, type Mocked } from "vitest";
import { createInngestModule } from "@/inngest/send-email";
import type { IEmailRepository, IEmailTransport } from "@/send-email/send-email.types";
import { encrypt } from "@/core/crypto";
import { cleanHtml } from "@/core/html-sanitizer";

// --- Module mocks ---
// Replaced at module level so every test gets a predictable stub.
// The real implementations depend on Web Crypto and HTML parsing which
// are unnecessary to verify the orchestration logic.
vi.mock("@/core/crypto", () => ({
  encrypt: vi.fn().mockResolvedValue("encrypted-value"),
}));

vi.mock("@/core/html-sanitizer", () => ({
  cleanHtml: vi.fn((html: string) => `<p>${html}</p>`),
}));

// --- Test event fixture ---
// Mirrors the shape dispatched by the controller. Every field the
// Inngest function reads from event.data must be present here.
const mockEvent = {
  data: {
    emailId: "test-email-id-123",
    userId: "test-user-id",
    to: "recipient@example.com",
    subject: "Test Subject",
    text: "Plain text content for testing",
    html: "<p>HTML content for testing</p>",
  },
};

/**
 * Creates a mock `step` object whose `run` method executes the callback
 * immediately. In production Inngest replays completed steps from a cache,
 * but in tests we want deterministic, linear execution.
 */
function createMockStep() {
  return {
    run: vi.fn(async (name: string, fn: () => Promise<unknown>) => fn()),
  };
}

/**
 * Minimal logger mock — the function receives it from Inngest but only
 * uses it for info-level tracing which we don't need to assert here.
 */
function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// --- Test suite ---
describe("sendEmailFunction", () => {
  let mockRepository: Mocked<IEmailRepository>;
  let mockTransport: Mocked<IEmailTransport>;
  let sendEmailFunction: ReturnType<typeof createInngestModule>["functions"][0];

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-apply module mock implementations after the global resetAllMocks()
    // in test/setup.ts wipes them. Without this, encrypt returns undefined
    // and the "save email log" assertion fails.
    vi.mocked(encrypt).mockResolvedValue("encrypted-value");
    vi.mocked(cleanHtml).mockImplementation((html: string) => `<p>${html}</p>`);

    mockRepository = {
      saveEmailLog: vi.fn().mockResolvedValue(undefined),
      saveEmailHistory: vi.fn().mockResolvedValue(undefined),
    };

    mockTransport = {
      send: vi.fn().mockResolvedValue({ messageId: "<mock-id@gmail.com>" }),
    };

    // Create the Inngest module with mocked dependencies
    const mod = createInngestModule(mockTransport, mockRepository, "test-aes-key");
    sendEmailFunction = mod.functions[0];
  });

  it("should call all lifecycle statuses in order", async () => {
    const step = createMockStep();
    const logger = createMockLogger();

    const handler = (sendEmailFunction as any).fn;
    await handler({ event: mockEvent, step, logger, transport: mockTransport, repository: mockRepository, aesKey: "test-aes-key" });

    const calls = mockRepository.saveEmailHistory.mock.calls.map(
      (call: any[]) => call[1],
    );
    expect(calls).toEqual(["received", "processing", "cleaned", "sent"]);
  });

  it("should call transport.send with correct params", async () => {
    const step = createMockStep();
    const logger = createMockLogger();

    const handler = (sendEmailFunction as any).fn;
    await handler({ event: mockEvent, step, logger, transport: mockTransport, repository: mockRepository, aesKey: "test-aes-key" });

    expect(mockTransport.send).toHaveBeenCalledWith({
      to: mockEvent.data.to,
      subject: mockEvent.data.subject,
      text: mockEvent.data.text,
      html: "<p><p>HTML content for testing</p></p>",
    });
  });

  it("should save email log with all fields", async () => {
    const step = createMockStep();
    const logger = createMockLogger();

    const handler = (sendEmailFunction as any).fn;
    await handler({ event: mockEvent, step, logger, transport: mockTransport, repository: mockRepository, aesKey: "test-aes-key" });

    expect(mockRepository.saveEmailLog).toHaveBeenCalledWith(
      mockEvent.data.emailId,
      mockEvent.data.userId,
      "encrypted-value",
      mockEvent.data.subject,
      "<mock-id@gmail.com>",
      expect.any(String),
      expect.any(Number),
    );
  });

  it("should execute each step exactly once", async () => {
    const step = createMockStep();
    const logger = createMockLogger();

    const handler = (sendEmailFunction as any).fn;
    await handler({ event: mockEvent, step, logger, transport: mockTransport, repository: mockRepository, aesKey: "test-aes-key" });

    expect(step.run).toHaveBeenCalledTimes(6);
    expect(step.run.mock.calls.map((c: any[]) => c[0])).toEqual([
      " email-receveid-and-update-history",
      "processing",
      "cleaning-html-input",
      "send-mail-via-nodemailer",
      "save-infos-in-db",
      "return-json-success-data",
    ]);
  });
});
