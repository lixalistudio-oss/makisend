import { describe, it, vi, expect, beforeEach } from "vitest";
import { InngestTestEngine } from "@inngest/test";
import { configureDeps } from "@/inngest/client";
import { getSendEmailFunction, getSendEmailTimeoutFunction } from "@/inngest/send-email";
import type {
  IEmailRepository,
  IEmailTransport,
  SendEmailQueueMessage,
} from "@/send-email/send-email.types";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";
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
    smtpConfigId: "smtp-config-123",
  },
};

describe("sendEmailFunction", () => {
  let mockRepository: IEmailRepository;
  let mockTransport: IEmailTransport;
  let mockSmtpConfigRepository: ISmtpConfigRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(encrypt).mockResolvedValue("encrypted-value");
    vi.mocked(cleanHtml).mockImplementation((html: string) => `<p>${html}</p>`);

    mockRepository = {
      createPendingEmailLog: vi.fn().mockResolvedValue(undefined),
      completeEmailLog: vi.fn().mockResolvedValue(undefined),
      saveEmailHistory: vi.fn().mockResolvedValue(undefined),
    };

    mockTransport = {
      send: vi.fn().mockResolvedValue({ messageId: "<mock-id@gmail.com>" }),
    };

    mockSmtpConfigRepository = {
      create: vi.fn().mockResolvedValue({}),
      findByUserId: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    configureDeps(mockTransport, mockRepository, "test-aes-key", mockSmtpConfigRepository);
  });

  it("should call all lifecycle statuses in order", async () => {
    const t = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [mockEvent],
      transformCtx: (ctx) => ({
        ...ctx,
        transport: mockTransport,
        emailRepository: mockRepository,
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
          await mockRepository.completeEmailLog(
            "test-email-id-123",
            "<mock-id@gmail.com>",
            new Date().toISOString(),
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
        emailRepository: mockRepository,
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

  it("should complete the email log with delivery details", async () => {
    const t = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [mockEvent],
      transformCtx: (ctx) => ({
        ...ctx,
        transport: mockTransport,
        emailRepository: mockRepository,
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
          await mockRepository.completeEmailLog(
            "test-email-id-123",
            "<mock-id@gmail.com>",
            new Date().toISOString(),
            100,
          );
        }},
        { id: "return-json-success-data", handler: async () => ({ message: "done" }) },
      ],
    });

    await t.execute();

    expect(mockRepository.completeEmailLog).toHaveBeenCalledWith(
      "test-email-id-123",
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
        emailRepository: mockRepository,
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

  it("should resolve the transport with the event's smtpConfigId", async () => {
    const resolveTransport = vi.fn().mockResolvedValue(mockTransport);
    configureDeps(
      mockTransport,
      mockRepository,
      "test-aes-key",
      mockSmtpConfigRepository,
      resolveTransport,
    );

    const t = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [mockEvent],
      transformCtx: (ctx) => ({
        ...ctx,
        emailRepository: mockRepository,
        aesKey: "test-aes-key",
      }),
      steps: [
        { id: "email-received-and-update-history", handler: async () => {} },
        { id: "processing", handler: async () => {} },
        { id: "cleaning-html-input", handler: async () => ({
          cleanedHtml: "<p>cleaned</p>",
          encryptedReceiver: "encrypted-value",
        })},
        { id: "send-mail-via-nodemailer", handler: async () => {
          const { messageId } = await mockTransport.send({
            to: mockEvent.data.to,
            subject: mockEvent.data.subject,
            text: mockEvent.data.text,
            html: "<p>cleaned</p>",
          });
          return { messageId, durationMs: 100 };
        }},
        { id: "save-infos-in-db", handler: async () => {} },
        { id: "return-json-success-data", handler: async () => ({ message: "done" }) },
      ],
    });

    const { error } = await t.execute();
    expect(error).toBeUndefined();

    expect(resolveTransport).toHaveBeenCalledTimes(1);
    expect(resolveTransport).toHaveBeenCalledWith("smtp-config-123");
    expect(mockTransport.send).toHaveBeenCalled();
  });

  it("records an attempt_failed history row when SMTP rejects the send", async () => {
    // No `steps` override: the real step bodies run against the mocked deps.
    mockTransport.send = vi
      .fn()
      .mockRejectedValue(new Error("SMTP down"));

    const t = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [mockEvent],
      transformCtx: (ctx) => ({
        ...ctx,
        transport: mockTransport,
        emailRepository: mockRepository,
        aesKey: "test-aes-key",
      }),
    });

    await t.execute();

    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "attempt_failed",
      "SMTP down",
      1,
    );
    // completeEmailLog must NOT run on a failed attempt.
    expect(mockRepository.completeEmailLog).not.toHaveBeenCalled();
  });

  it("re-enqueues a transient failure onto the queue with a cycle backoff", async () => {
    // InngestTestEngine cannot trigger onFailure, so invoke the handler directly
    // with the wrapped `inngest/function.failed` payload it receives in production.
    const onFailure = (getSendEmailFunction() as unknown as {
      onFailureFn?: (ctx: unknown) => Promise<void>;
    }).onFailureFn;
    expect(onFailure).toBeTypeOf("function");

    const mockQueueSend = vi.fn().mockResolvedValue(undefined);

    await onFailure!({
      event: {
        name: "inngest/function.failed",
        data: {
          function_id: "makisend-send-email",
          run_id: "run-123",
          error: { name: "Error", message: "SMTP down" },
          event: mockEvent,
        },
      },
      // No `code` and no SMTP status in the message → transient by default.
      error: new Error("SMTP down"),
      emailRepository: mockRepository,
      transport: mockTransport,
      aesKey: "test-aes-key",
      sendEmailQueue: { send: mockQueueSend },
    });

    expect(mockQueueSend).toHaveBeenCalledTimes(1);
    expect(mockQueueSend).toHaveBeenCalledWith(
      {
        name: "app/send-email",
        data: { ...mockEvent.data, queueCycles: 1 },
      },
      { delaySeconds: 60 },
    );
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "attempt_failed",
      expect.stringContaining("Re-queued: next attempt in 60s (cycle 1 of 5)"),
    );
    expect(mockRepository.saveEmailHistory).not.toHaveBeenCalledWith(
      "test-email-id-123",
      "failed",
      expect.anything(),
      expect.anything(),
    );
  });

  it("abandons a permanent failure with an explanatory message and does not re-enqueue", async () => {
    const onFailure = (getSendEmailFunction() as unknown as {
      onFailureFn?: (ctx: unknown) => Promise<void>;
    }).onFailureFn;
    const mockQueueSend = vi.fn().mockResolvedValue(undefined);

    const permanentError = Object.assign(
      new Error("Invalid login: 535 5.7.8 Authentication failed"),
      { code: "EAUTH" },
    );

    await onFailure!({
      event: {
        name: "inngest/function.failed",
        data: {
          function_id: "makisend-send-email",
          run_id: "run-123",
          error: { name: "Error", message: permanentError.message },
          event: mockEvent,
        },
      },
      error: permanentError,
      emailRepository: mockRepository,
      transport: mockTransport,
      aesKey: "test-aes-key",
      sendEmailQueue: { send: mockQueueSend },
    });

    expect(mockQueueSend).not.toHaveBeenCalled();
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "failed",
      "Your SMTP provider rejected the credentials — check the SMTP username and password/key in your configuration.",
      5,
    );
  });

  it("abandons once the queue cycle cap is reached, even for a transient error", async () => {
    const onFailure = (getSendEmailFunction() as unknown as {
      onFailureFn?: (ctx: unknown) => Promise<void>;
    }).onFailureFn;
    const mockQueueSend = vi.fn().mockResolvedValue(undefined);

    await onFailure!({
      event: {
        name: "inngest/function.failed",
        data: {
          function_id: "makisend-send-email",
          run_id: "run-123",
          error: { name: "Error", message: "SMTP down" },
          event: { ...mockEvent, data: { ...mockEvent.data, queueCycles: 5 } },
        },
      },
      error: new Error("SMTP down"),
      emailRepository: mockRepository,
      transport: mockTransport,
      aesKey: "test-aes-key",
      sendEmailQueue: { send: mockQueueSend },
    });

    expect(mockQueueSend).not.toHaveBeenCalled();
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "failed",
      expect.stringContaining("Delivery abandoned after 5 queue cycles"),
      5,
    );
  });

  it("records a failed row when a transient failure cannot be re-enqueued", async () => {
    const onFailure = (getSendEmailFunction() as unknown as {
      onFailureFn?: (ctx: unknown) => Promise<void>;
    }).onFailureFn;

    await onFailure!({
      event: {
        name: "inngest/function.failed",
        data: {
          function_id: "makisend-send-email",
          run_id: "run-123",
          error: { name: "Error", message: "SMTP down" },
          event: mockEvent,
        },
      },
      error: new Error("SMTP down"),
      emailRepository: mockRepository,
      transport: mockTransport,
      aesKey: "test-aes-key",
      // No sendEmailQueue binding available.
    });

    expect(mockRepository.saveEmailHistory).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "failed",
      expect.stringContaining("Cannot re-queue transient failure"),
      5,
    );
  });

  it("does not throw when the failure event carries no emailId", async () => {
    const onFailure = (getSendEmailFunction() as unknown as {
      onFailureFn?: (ctx: unknown) => Promise<void>;
    }).onFailureFn;

    await expect(
      onFailure!({
        event: { name: "inngest/function.failed", data: { event: { data: {} } } },
        error: new Error("SMTP down"),
        emailRepository: mockRepository,
      }),
    ).resolves.toBeUndefined();

    expect(mockRepository.saveEmailHistory).not.toHaveBeenCalled();
  });

  describe("sendEmailTimeoutFunction (30s window blown)", () => {
    const cancelledEvent = {
      name: "inngest/function.cancelled" as const,
      data: {
        // Absolute id of send-email: client id "makisend" + function id.
        function_id: "makisend-send-email",
        event: mockEvent,
      },
    };

    it("re-queues the cancelled run with a cycle backoff", async () => {
      const mockQueueSend = vi.fn().mockResolvedValue(undefined);
      // The DI middleware injects the queue from module state AFTER transformCtx,
      // so the binding must be registered exactly like `index.ts` does in production.
      configureDeps(
        mockTransport,
        mockRepository,
        "test-aes-key",
        mockSmtpConfigRepository,
        undefined,
        { send: mockQueueSend } as unknown as Queue<SendEmailQueueMessage>,
      );

      const t = new InngestTestEngine({
        function: getSendEmailTimeoutFunction(),
        events: [cancelledEvent],
        transformCtx: (ctx) => ({
          ...ctx,
          emailRepository: mockRepository,
        }),
      });

      await t.execute();

      expect(mockQueueSend).toHaveBeenCalledTimes(1);
      expect(mockQueueSend).toHaveBeenCalledWith(
        {
          name: "app/send-email",
          data: { ...mockEvent.data, queueCycles: 1 },
        },
        { delaySeconds: 60 },
      );
      expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
        "test-email-id-123",
        "attempt_failed",
        expect.stringContaining("Re-queued: next attempt in 60s (cycle 1 of 5)"),
      );
      // A cancelled run is never a terminal failure.
      expect(mockRepository.saveEmailHistory).not.toHaveBeenCalledWith(
        "test-email-id-123",
        "failed",
        expect.anything(),
        expect.anything(),
      );
    });

    it("abandons a cancelled run that already reached the cycle cap", async () => {
      const mockQueueSend = vi.fn().mockResolvedValue(undefined);

      const t = new InngestTestEngine({
        function: getSendEmailTimeoutFunction(),
        events: [
          {
            ...cancelledEvent,
            data: {
              ...cancelledEvent.data,
              event: { ...mockEvent, data: { ...mockEvent.data, queueCycles: 5 } },
            },
          },
        ],
        transformCtx: (ctx) => ({
          ...ctx,
          emailRepository: mockRepository,
          sendEmailQueue: { send: mockQueueSend },
        }),
      });

      await t.execute();

      expect(mockQueueSend).not.toHaveBeenCalled();
      expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
        "test-email-id-123",
        "failed",
        expect.stringContaining("Delivery abandoned after 5 queue cycles"),
        5,
      );
    });
  });
});
