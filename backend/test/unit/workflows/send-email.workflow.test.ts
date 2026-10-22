import { describe, it, vi, expect, beforeEach } from "vitest";
import {
  runSendEmailFlow,
  SEND_MAX_ATTEMPTS,
  SEND_MAX_RETRIES,
  SEND_RETRY_DELAY_SECONDS,
} from "@/workflows/send-email.flow";
import { AppError } from "@/core/errors";
import type {
  SendEmailFlowDeps,
  SendEmailFlowOutcome,
} from "@/workflows/send-email.flow";
import type {
  EmailToSend,
  IEmailRepository,
  IEmailTransport,
  SendEmailQueueMessage,
} from "@/send-email/send-email.types";
import type { WorkflowStep } from "cloudflare:workers";

const emailId = "test-email-id-123";

const storedEmail: EmailToSend = {
  to: "recipient@example.com",
  subject: "Test Subject",
  text: "Plain text content for testing",
  html: "<p>HTML content for testing</p>",
  smtpConfigId: "smtp-config-123",
};

const payload: SendEmailQueueMessage = { emailId };

type StepCallback = (ctx: { attempt: number }) => Promise<unknown>;

interface StepStubOptions {
  sendAttempts?: number;
  configs?: Record<string, unknown>;
}

/**
 * Stub WorkflowStep. `sendAttempts` simulates the Workflows retry engine for
 * the SMTP step: retry until the callback succeeds or the budget is exhausted.
 */
function stepStub(options: StepStubOptions = {}): WorkflowStep {
  return {
    async do(name: string, cfgOrFn: unknown, maybeFn?: unknown) {
      const callback = (
        typeof cfgOrFn === "function" ? cfgOrFn : maybeFn
      ) as StepCallback;

      if (options.configs && typeof cfgOrFn === "object" && cfgOrFn !== null) {
        options.configs[name] = cfgOrFn;
      }

      if (name === "send-mail-via-nodemailer" && options.sendAttempts) {
        let lastError: unknown;
        for (let attempt = 1; attempt <= options.sendAttempts; attempt++) {
          try {
            return await callback({ attempt });
          } catch (err) {
            lastError = err;
          }
        }
        throw lastError;
      }

      return callback({ attempt: 1 });
    },
  } as unknown as WorkflowStep;
}

describe("runSendEmailFlow", () => {
  const mockSend = vi.fn();
  const mockResolveTransport = vi.fn();
  const mockLoadEmail = vi.fn();
  const mockDeadLetterSend = vi.fn();
  const mockRepository = {
    createPendingEmailLog: vi.fn(),
    completeEmailLog: vi.fn(),
    saveEmailHistory: vi.fn(),
    saveEmailContent: vi.fn(),
    getEmailForSending: vi.fn(),
  };

  const transport: IEmailTransport = { send: mockSend };
  const deadLetterQueue = {
    send: mockDeadLetterSend,
  } as unknown as Queue<SendEmailQueueMessage>;

  function buildDeps(
    overrides: Partial<SendEmailFlowDeps> = {},
  ): SendEmailFlowDeps {
    return {
      repository: mockRepository as unknown as IEmailRepository,
      loadEmail: mockLoadEmail,
      resolveTransport: mockResolveTransport,
      deadLetterQueue,
      ...overrides,
    };
  }

  async function run(
    options: StepStubOptions = {},
    overrides: Partial<SendEmailFlowDeps> = {},
  ): Promise<SendEmailFlowOutcome> {
    return runSendEmailFlow(buildDeps(overrides), payload, stepStub(options));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository.saveEmailHistory.mockResolvedValue(undefined);
    mockRepository.completeEmailLog.mockResolvedValue(undefined);
    mockLoadEmail.mockResolvedValue(storedEmail);
    mockResolveTransport.mockResolvedValue(transport);
    mockSend.mockResolvedValue({ messageId: "<mock-id@gmail.com>" });
    mockDeadLetterSend.mockResolvedValue(undefined);
  });

  it("sends the email, writes the lifecycle trail and completes the log", async () => {
    const result = await run();

    expect(
      mockRepository.saveEmailHistory.mock.calls.map((call) => call[1]),
    ).toEqual(["received", "processing", "cleaned", "sent"]);
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      emailId,
      "sent",
      undefined,
      1,
    );
    expect(mockSend).toHaveBeenCalledWith({
      to: storedEmail.to,
      subject: storedEmail.subject,
      text: storedEmail.text,
      html: expect.any(String),
    });
    expect(mockRepository.completeEmailLog).toHaveBeenCalledWith(
      emailId,
      "<mock-id@gmail.com>",
      expect.any(String),
      expect.any(Number),
    );
    expect(mockDeadLetterSend).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "sent",
      messageId: "<mock-id@gmail.com>",
      attempt: 1,
    });
  });

  it("resolves the transport with the smtpConfigId captured at enqueue time", async () => {
    await run();

    expect(mockResolveTransport).toHaveBeenCalledWith("smtp-config-123");
  });

  it("configures the SMTP step with three 30-second retries", async () => {
    const configs: Record<string, unknown> = {};
    await run({ configs });

    expect(configs["send-mail-via-nodemailer"]).toMatchObject({
      retries: {
        limit: SEND_MAX_RETRIES,
        delay: `${SEND_RETRY_DELAY_SECONDS} seconds`,
        backoff: "constant",
      },
    });
  });

  it("rejects a permanent SMTP error immediately and dead-letters it", async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error("Invalid login: 535 5.7.8 Authentication failed"), {
        code: "EAUTH",
      }),
    );

    const result = await run({ sendAttempts: SEND_MAX_ATTEMPTS });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      emailId,
      "attempt_failed",
      "Your SMTP provider rejected the credentials — check the SMTP username and password/key in your configuration.",
      1,
    );
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      emailId,
      "failed",
      expect.stringContaining(
        "Delivery rejected permanently: Your SMTP provider rejected the credentials",
      ),
      1,
    );
    expect(mockRepository.completeEmailLog).not.toHaveBeenCalled();
    expect(mockDeadLetterSend).toHaveBeenCalledWith({ emailId });
    expect(result).toMatchObject({
      outcome: "rejected",
      attempt: 1,
      reason: expect.stringContaining("rejected the credentials"),
    });
  });

  it("retries a transient failure four times, then dead-letters it", async () => {
    mockSend.mockRejectedValue(new Error("SMTP down"));

    const result = await run({ sendAttempts: SEND_MAX_ATTEMPTS });

    expect(mockSend).toHaveBeenCalledTimes(SEND_MAX_ATTEMPTS);
    const attemptFailures = mockRepository.saveEmailHistory.mock.calls.filter(
      (call) => call[1] === "attempt_failed",
    );
    expect(attemptFailures).toHaveLength(SEND_MAX_ATTEMPTS);
    expect(attemptFailures.map((call) => call[3])).toEqual([1, 2, 3, 4]);
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      emailId,
      "failed",
      expect.stringContaining("Delivery abandoned after 4 attempts"),
      4,
    );
    expect(mockRepository.completeEmailLog).not.toHaveBeenCalled();
    expect(mockDeadLetterSend).toHaveBeenCalledWith({ emailId });
    expect(result).toMatchObject({ outcome: "dead_lettered", attempt: 4 });
  });

  it("treats a missing SMTP configuration as permanent and does not attempt SMTP", async () => {
    mockResolveTransport.mockRejectedValue(
      new AppError(404, "SMTP configuration not found"),
    );

    const result = await run({ sendAttempts: SEND_MAX_ATTEMPTS });

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockResolveTransport).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      emailId,
      "failed",
      expect.stringContaining("SMTP configuration not found"),
      1,
    );
    expect(mockDeadLetterSend).toHaveBeenCalledWith({ emailId });
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "SMTP configuration not found",
      attempt: 1,
    });
  });

  it("treats missing stored content as a permanent failure", async () => {
    mockLoadEmail.mockRejectedValue(
      new AppError(404, `Email ${emailId} not found`),
    );

    const result = await run();

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      emailId,
      "failed",
      expect.stringContaining(`Email ${emailId} not found`),
      1,
    );
    expect(result).toMatchObject({ outcome: "dead_lettered", attempt: 1 });
  });

  it("still returns a terminal outcome when the dead-letter publish fails", async () => {
    mockResolveTransport.mockRejectedValue(
      new AppError(404, "SMTP configuration not found"),
    );
    mockDeadLetterSend.mockRejectedValue(new Error("DLQ down"));

    const result = await run();

    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "SMTP configuration not found",
    });
  });
});
