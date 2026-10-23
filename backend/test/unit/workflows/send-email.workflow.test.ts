import { describe, it, vi, expect, beforeEach } from "vitest";
import {
  SendEmailWorkflow,
  resolveSendEmailRunEnd,
  MAX_QUEUE_CYCLES,
} from "@/workflows/send-email.workflow";
import type { SendEmailParams, SendEmailRunOutcome } from "@/workflows/send-email.workflow";
import type { Bindings } from "@/index";
import type { WorkflowStep } from "cloudflare:workers";

const { mockRepository, mockQueueSend, mockTransportSend, mockResolveTransport } = vi.hoisted(
  () => ({
    mockRepository: {
      createPendingEmailLog: vi.fn(),
      completeEmailLog: vi.fn(),
      saveEmailHistory: vi.fn(),
    },
    mockQueueSend: vi.fn(),
    mockTransportSend: vi.fn(),
    mockResolveTransport: vi.fn(),
  }),
);

vi.mock("@/db/connection", () => ({
  createDatabase: vi.fn(() => ({})),
}));

vi.mock("@/send-email/send-email.repository", () => ({
  // A class (not vi.fn) so `new SendEmailRepository(...)` yields an object
  // sharing the hoisted mock methods.
  SendEmailRepository: class {
    saveEmailHistory = mockRepository.saveEmailHistory;
    completeEmailLog = mockRepository.completeEmailLog;
    createPendingEmailLog = mockRepository.createPendingEmailLog;
  },
}));

vi.mock("@/send-email/transport-resolver", () => ({
  resolveTransportFor: mockResolveTransport,
}));

vi.mock("@/core/html-sanitizer", () => ({
  cleanHtml: vi.fn((html: string) => `<p>${html}</p>`),
}));

const payload: SendEmailParams = {
  emailId: "test-email-id-123",
  to: "recipient@example.com",
  subject: "Test Subject",
  text: "Plain text content for testing",
  html: "<p>HTML content for testing</p>",
  smtpConfigId: "smtp-config-123",
  userId: "user-id-123",
  apiKeyId: "apikey-id-123",
  queueCycles: 0,
};

/** Stub WorkflowStep: runs the callback, recording any step config passed. */
function stubStep(stepConfigs?: Record<string, unknown>): WorkflowStep {
  const doFn = async (
    name: string,
    cfgOrFn: unknown,
    maybeFn?: unknown,
  ): Promise<unknown> => {
    const fn = typeof cfgOrFn === "function" ? cfgOrFn : maybeFn;
    if (stepConfigs && typeof cfgOrFn === "object" && cfgOrFn !== null) {
      stepConfigs[name] = cfgOrFn;
    }
    return (fn as () => Promise<unknown>)();
  };
  return { do: doFn } as unknown as WorkflowStep;
}

function buildEnv(overrides?: Partial<Bindings>): Bindings {
  return {
    makisend_db: {},
    SEND_EMAIL_QUEUE: { send: mockQueueSend },
    ...overrides,
  } as unknown as Bindings;
}

function runWorkflow(env: Bindings, data: SendEmailParams = payload): Promise<SendEmailRunOutcome> {
  const wf = new SendEmailWorkflow({} as never, env);
  return wf.run({ payload: data } as never, stubStep());
}

function runWorkflowCapturingConfigs(
  env: Bindings,
  configs: Record<string, unknown>,
  data: SendEmailParams = payload,
): Promise<SendEmailRunOutcome> {
  const wf = new SendEmailWorkflow({} as never, env);
  return wf.run({ payload: data } as never, stubStep(configs));
}

describe("SendEmailWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository.saveEmailHistory.mockResolvedValue(undefined);
    mockRepository.completeEmailLog.mockResolvedValue(undefined);
    mockQueueSend.mockResolvedValue(undefined);
    mockTransportSend.mockResolvedValue({ messageId: "<mock-id@gmail.com>" });
    mockResolveTransport.mockResolvedValue({ send: mockTransportSend });
  });

  it("calls all lifecycle statuses in order and returns a sent outcome", async () => {
    const result = await runWorkflow(buildEnv());

    expect(mockRepository.saveEmailHistory.mock.calls.map((c) => c[1])).toEqual([
      "received",
      "processing",
      "cleaned",
      "sent",
    ]);
    expect(result).toMatchObject({
      outcome: "sent",
      messageId: "<mock-id@gmail.com>",
      attempt: 1,
    });
  });

  it("disables Workflows auto-retry on the SMTP step (one attempt per run)", async () => {
    // Workflows defaults step.do to 5 auto-retries; without limit: 0 a single
    // run would send up to 6 emails and never reach in-run classification.
    const configs: Record<string, unknown> = {};
    await runWorkflowCapturingConfigs(buildEnv(), configs);

    expect(configs["send-mail-via-nodemailer"]).toMatchObject({
      retries: { limit: 0 },
    });
  });

  it("calls transport.send with the cleaned html", async () => {
    await runWorkflow(buildEnv());

    expect(mockTransportSend).toHaveBeenCalledWith({
      to: "recipient@example.com",
      subject: "Test Subject",
      text: "Plain text content for testing",
      html: "<p><p>HTML content for testing</p></p>",
    });
  });

  it("completes the email log with delivery details", async () => {
    await runWorkflow(buildEnv());

    expect(mockRepository.completeEmailLog).toHaveBeenCalledWith(
      "test-email-id-123",
      "<mock-id@gmail.com>",
      expect.any(String),
      expect.any(Number),
    );
  });

  it("resolves the transport with the event's smtpConfigId", async () => {
    await runWorkflow(buildEnv());

    expect(mockResolveTransport).toHaveBeenCalledTimes(1);
    expect(mockResolveTransport).toHaveBeenCalledWith(expect.anything(), "smtp-config-123");
  });

  it("records attempt_failed and re-enqueues a transient failure with a cycle backoff", async () => {
    mockTransportSend.mockRejectedValue(new Error("SMTP down"));

    const result = await runWorkflow(buildEnv());

    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "attempt_failed",
      "SMTP down",
      1,
    );
    expect(mockQueueSend).toHaveBeenCalledTimes(1);
    expect(mockQueueSend).toHaveBeenCalledWith(
      {
        name: "app/send-email",
        data: { ...payload, queueCycles: 1 },
      },
      { delaySeconds: 60 },
    );
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "attempt_failed",
      expect.stringContaining("Re-queued: next attempt in 60s (cycle 1 of 5)"),
    );
    expect(mockRepository.completeEmailLog).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "requeued", nextCycle: 1, delaySeconds: 60 });
  });

  it("abandons a permanent failure with an explanatory message and does not re-enqueue", async () => {
    mockTransportSend.mockRejectedValue(
      Object.assign(new Error("Invalid login: 535 5.7.8 Authentication failed"), {
        code: "EAUTH",
      }),
    );

    const result = await runWorkflow(buildEnv());

    expect(mockQueueSend).not.toHaveBeenCalled();
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "failed",
      "Your SMTP provider rejected the credentials — check the SMTP username and password/key in your configuration.",
      1,
    );
    expect(result).toMatchObject({ outcome: "abandoned", reason: "permanent failure" });
  });

  it("abandons once the queue cycle cap is reached, even for a transient error", async () => {
    mockTransportSend.mockRejectedValue(new Error("SMTP down"));

    const result = await runWorkflow(buildEnv(), {
      ...payload,
      queueCycles: MAX_QUEUE_CYCLES,
    });

    expect(mockQueueSend).not.toHaveBeenCalled();
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "failed",
      expect.stringContaining("Delivery abandoned after 5 queue cycles"),
      MAX_QUEUE_CYCLES + 1,
    );
    expect(result).toMatchObject({ outcome: "abandoned", reason: "queue cycle cap reached" });
  });

  it("records a failed row when a transient failure cannot be re-enqueued", async () => {
    mockTransportSend.mockRejectedValue(new Error("SMTP down"));

    const result = await runWorkflow(buildEnv({ SEND_EMAIL_QUEUE: undefined as never }));

    expect(mockQueueSend).not.toHaveBeenCalled();
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "failed",
      expect.stringContaining("Cannot re-queue transient failure"),
      1,
    );
    expect(result).toMatchObject({ outcome: "abandoned", reason: "queue binding unavailable" });
  });

  it("numbers attempts across queue cycles", async () => {
    mockTransportSend.mockRejectedValue(new Error("SMTP down"));

    await runWorkflow(buildEnv(), { ...payload, queueCycles: 2 });

    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "attempt_failed",
      "SMTP down",
      3,
    );
  });
});

describe("resolveSendEmailRunEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository.saveEmailHistory.mockResolvedValue(undefined);
    mockQueueSend.mockResolvedValue(undefined);
  });

  it("does not throw when the payload carries no emailId", async () => {
    const result = await resolveSendEmailRunEnd(
      { emailRepository: mockRepository, sendEmailQueue: { send: mockQueueSend } as never },
      undefined,
      { message: "SMTP down" },
    );

    expect(result).toMatchObject({ outcome: "abandoned", reason: "no emailId in payload" });
    expect(mockRepository.saveEmailHistory).not.toHaveBeenCalled();
  });

  it("marks re-enqueue failures as abandoned with a failed history row", async () => {
    mockQueueSend.mockRejectedValue(new Error("queue unavailable"));

    const result = await resolveSendEmailRunEnd(
      { emailRepository: mockRepository, sendEmailQueue: { send: mockQueueSend } as never },
      payload,
      { message: "SMTP down" },
    );

    expect(result).toMatchObject({ outcome: "abandoned", reason: "re-enqueue failed" });
    expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
      "test-email-id-123",
      "failed",
      expect.stringContaining("Failed to re-queue after cycle 0"),
      1,
    );
  });

  it("caps the backoff at the last table entry for late cycles", async () => {
    const result = await resolveSendEmailRunEnd(
      { emailRepository: mockRepository, sendEmailQueue: { send: mockQueueSend } as never },
      { ...payload, queueCycles: MAX_QUEUE_CYCLES - 1 },
      { message: "SMTP down" },
    );

    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.anything(),
      { delaySeconds: 3600 },
    );
    expect(result).toEqual({
      outcome: "requeued",
      nextCycle: MAX_QUEUE_CYCLES,
      delaySeconds: 3600,
    });
  });
});
