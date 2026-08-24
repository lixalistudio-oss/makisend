import { describe, it, vi, expect, beforeEach, type Mocked } from "vitest";
import { configureDeps } from "@/inngest/client";
import { getFunctions } from "@/inngest/functions";
import type { IEmailRepository, IEmailTransport } from "@/send-email/send-email.types";
import { encrypt } from "@/core/crypto";
import { cleanHtml } from "@/core/html-sanitizer";

vi.mock("@/core/crypto", () => ({
  encrypt: vi.fn().mockResolvedValue("encrypted-value"),
}));

vi.mock("@/core/html-sanitizer", () => ({
  cleanHtml: vi.fn((html: string) => `<p>${html}</p>`),
}));

const mockEvent = {
  data: {
    emailId: "test-email-id-123",
    to: "recipient@example.com",
    subject: "Test Subject",
    text: "Plain text content for testing",
    html: "<p>HTML content for testing</p>",
  },
};

function createMockStep() {
  return {
    run: vi.fn(async (name: string, fn: () => Promise<unknown>) => fn()),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("sendEmailFunction", () => {
  let mockRepository: Mocked<IEmailRepository>;
  let mockTransport: Mocked<IEmailTransport>;
  let sendEmailFunction: ReturnType<typeof getFunctions>[0];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(encrypt).mockResolvedValue("encrypted-value");
    vi.mocked(cleanHtml).mockImplementation((html: string) => `<p>${html}</p>`);

    mockRepository = {
      saveEmailLog: vi.fn().mockResolvedValue(undefined),
      saveEmailHistory: vi.fn().mockResolvedValue(undefined),
    };

    mockTransport = {
      send: vi.fn().mockResolvedValue({ messageId: "<mock-id@gmail.com>" }),
    };

    configureDeps(mockTransport, mockRepository, "test-aes-key");
    sendEmailFunction = getFunctions()[0];
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
      "system",
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
      "email-received-and-update-history",
      "processing",
      "cleaning-html-input",
      "send-mail-via-nodemailer",
      "save-infos-in-db",
      "return-json-success-data",
    ]);
  });
});
