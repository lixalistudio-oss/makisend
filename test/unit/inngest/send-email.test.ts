import { describe, it, vi, expect, beforeEach } from "vitest";
import { InngestTestEngine } from "@inngest/test";
import { configureDeps } from "@/inngest/client";
import { getSendEmailFunction } from "@/inngest/send-email";
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
  name: "app/send-email" as const,
  data: {
    emailId: "test-email-id-123",
    to: "recipient@example.com",
    subject: "Test Subject",
    text: "Plain text content for testing",
    html: "<p>HTML content for testing</p>",
  },
};

describe("sendEmailFunction", () => {
  let mockRepository: IEmailRepository;
  let mockTransport: IEmailTransport;

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
  });

  it("should call all lifecycle statuses in order", async () => {
    const t = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [mockEvent],
      transformCtx: (ctx) => ({
        ...ctx,
        transport: mockTransport,
        repository: mockRepository,
        aesKey: "test-aes-key",
      }),
      steps: [
        { id: "email-received-and-update-history", handler: async () => {
          await mockRepository.saveEmailHistory("test-email-id-123", "received");
        }},
        { id: "processing", handler: async () => {
          await mockRepository.saveEmailHistory("test-email-id-123", "processing");
        }},
        { id: "cleaning-html-input", handler: async () => {
          const cleanedHtml = cleanHtml(mockEvent.data.html);
          const encryptedReceiver = await encrypt(mockEvent.data.to, "test-aes-key");
          await mockRepository.saveEmailHistory("test-email-id-123", "cleaned");
          return { cleanedHtml, encryptedReceiver };
        }},
        { id: "send-mail-via-nodemailer", handler: async () => {
          const { messageId } = await mockTransport.send({
            to: mockEvent.data.to,
            subject: mockEvent.data.subject,
            text: mockEvent.data.text,
            html: "<p><p>HTML content for testing</p></p>",
          });
          await mockRepository.saveEmailHistory("test-email-id-123", "sent");
          return { messageId, durationMs: 100 };
        }},
        { id: "save-infos-in-db", handler: async () => {
          await mockRepository.saveEmailLog(
            "test-email-id-123",
            "system",
            "encrypted-value",
            "Test Subject",
            "<mock-id@gmail.com>",
            expect.any(String),
            100,
          );
        }},
        { id: "return-json-success-data", handler: async () => {
          return { message: "Email sent successfully" };
        }},
      ],
    });

    await t.execute();

    const calls = (mockRepository.saveEmailHistory as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[1],
    );
    expect(calls).toEqual(["received", "processing", "cleaned", "sent"]);
  });

  it("should call transport.send with correct params", async () => {
    const t = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [mockEvent],
      transformCtx: (ctx) => ({
        ...ctx,
        transport: mockTransport,
        repository: mockRepository,
        aesKey: "test-aes-key",
      }),
      steps: [
        { id: "email-received-and-update-history", handler: async () => {} },
        { id: "processing", handler: async () => {} },
        { id: "cleaning-html-input", handler: async () => {
          const cleanedHtml = cleanHtml(mockEvent.data.html);
          const encryptedReceiver = await encrypt(mockEvent.data.to, "test-aes-key");
          return { cleanedHtml, encryptedReceiver };
        }},
        { id: "send-mail-via-nodemailer", handler: async () => {
          const { messageId } = await mockTransport.send({
            to: mockEvent.data.to,
            subject: mockEvent.data.subject,
            text: mockEvent.data.text,
            html: "<p><p>HTML content for testing</p></p>",
          });
          return { messageId, durationMs: 100 };
        }},
        { id: "save-infos-in-db", handler: async () => {} },
        { id: "return-json-success-data", handler: async () => ({ message: "done" }) },
      ],
    });

    await t.execute();

    expect(mockTransport.send).toHaveBeenCalledWith({
      to: "recipient@example.com",
      subject: "Test Subject",
      text: "Plain text content for testing",
      html: "<p><p>HTML content for testing</p></p>",
    });
  });

  it("should save email log with all fields", async () => {
    const t = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [mockEvent],
      transformCtx: (ctx) => ({
        ...ctx,
        transport: mockTransport,
        repository: mockRepository,
        aesKey: "test-aes-key",
      }),
      steps: [
        { id: "email-received-and-update-history", handler: async () => {} },
        { id: "processing", handler: async () => {} },
        { id: "cleaning-html-input", handler: async () => ({
          cleanedHtml: "<p>cleaned</p>",
          encryptedReceiver: "encrypted-value",
        })},
        { id: "send-mail-via-nodemailer", handler: async () => ({
          messageId: "<mock-id@gmail.com>",
          durationMs: 100,
        })},
        { id: "save-infos-in-db", handler: async () => {
          await mockRepository.saveEmailLog(
            "test-email-id-123",
            "system",
            "encrypted-value",
            "Test Subject",
            "<mock-id@gmail.com>",
            new Date().toISOString(),
            100,
          );
        }},
        { id: "return-json-success-data", handler: async () => ({ message: "done" }) },
      ],
    });

    await t.execute();

    expect(mockRepository.saveEmailLog).toHaveBeenCalledWith(
      "test-email-id-123",
      "system",
      "encrypted-value",
      "Test Subject",
      "<mock-id@gmail.com>",
      expect.any(String),
      expect.any(Number),
    );
  });

  it("should complete successfully", async () => {
    const t = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [mockEvent],
      transformCtx: (ctx) => ({
        ...ctx,
        transport: mockTransport,
        repository: mockRepository,
        aesKey: "test-aes-key",
      }),
      steps: [
        { id: "email-received-and-update-history", handler: async () => {} },
        { id: "processing", handler: async () => {} },
        { id: "cleaning-html-input", handler: async () => ({
          cleanedHtml: "<p>cleaned</p>",
          encryptedReceiver: "encrypted-value",
        })},
        { id: "send-mail-via-nodemailer", handler: async () => ({
          messageId: "<mock-id@gmail.com>",
          durationMs: 100,
        })},
        { id: "save-infos-in-db", handler: async () => {} },
        { id: "return-json-success-data", handler: async () => ({ message: "Email sent successfully" }) },
      ],
    });

    const { error } = await t.execute();
    expect(error).toBeUndefined();
  });
});
