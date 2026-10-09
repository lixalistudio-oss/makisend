import { describe, it, vi, expect, beforeEach, beforeAll, afterAll } from "vitest";

vi.mock("@/inngest/client", () => ({
  getInngestClient: vi.fn(),
}));

import { getInngestClient } from "@/inngest/client";
import { sendEmailQueueConsumer } from "@/queue/send-email.consumer";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { emailHistories } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";
import type { Miniflare } from "miniflare";

const message = (overrides?: Partial<SendEmailQueueMessage["data"]>): SendEmailQueueMessage => ({
  name: "app/send-email",
  data: {
    to: "gedeon@example.com",
    subject: "Queue consumer test",
    text: "This text body is long enough to pass validation.",
    html: "<p>Queue consumer test</p>",
    emailId: "email-id-123",
    userId: "user-id-123",
    apiKeyId: "apikey-id-123",
    smtpConfigId: "smtp-config-id-123",
    queueCycles: 0,
    ...overrides,
  },
});

function buildMessage(
  body: SendEmailQueueMessage,
  attempts = 1,
): {
  body: SendEmailQueueMessage;
  attempts: number;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
} {
  return { body, attempts, ack: vi.fn(), retry: vi.fn() };
}

describe("sendEmailQueueConsumer", () => {
  const mockSend = vi.fn();
  let mf: Miniflare;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let env: Bindings;

  beforeAll(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    db = testD1.db;
    env = { makisend_db: testD1.d1 } as unknown as Bindings;
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInngestClient).mockReturnValue({ send: mockSend } as never);
  });

  it("forwards the event to Inngest with a cycle-scoped dedup id and acknowledges it", async () => {
    mockSend.mockResolvedValue(undefined);
    const msg = buildMessage(message());

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      ...message(),
      id: "email-id-123:0",
    });
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("scopes the dedup id to the queue cycle so a re-enqueued message triggers a fresh run", async () => {
    mockSend.mockResolvedValue(undefined);
    const msg = buildMessage(message({ queueCycles: 2 }));

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(mockSend).toHaveBeenCalledWith({
      ...message({ queueCycles: 2 }),
      id: "email-id-123:2",
    });
  });

  it("schedules a retry with exponential backoff when Inngest rejects the event", async () => {
    mockSend.mockRejectedValue(new Error("Inngest unavailable"));
    const msg = buildMessage(message(), 1);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 10 });
    // Not the final attempt — no history row yet.
    const histories = await db
      .select()
      .from(emailHistories)
      .where(eq(emailHistories.emailId, "email-id-123"))
      .all();
    expect(histories).toHaveLength(0);
  });

  it("increases the backoff delay with each delivery attempt", async () => {
    mockSend.mockRejectedValue(new Error("Inngest unavailable"));
    const msg = buildMessage(message(), 3);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 40 });
  });

  it("caps the backoff delay at 5 minutes", async () => {
    mockSend.mockRejectedValue(new Error("Inngest unavailable"));
    const msg = buildMessage(message({ emailId: "capped-delay-id" }), 50);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it("writes a failed history row when the retry budget is exhausted", async () => {
    mockSend.mockRejectedValue(new Error("Inngest unavailable"));
    const msg = buildMessage(message(), 4);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 80 });

    const histories = await db
      .select()
      .from(emailHistories)
      .where(eq(emailHistories.emailId, "email-id-123"))
      .all();
    expect(histories).toHaveLength(1);
    expect(histories[0].emailId).toBe("email-id-123");
    expect(histories[0].status).toBe("failed");
    expect(histories[0].attempts).toBe(4);
    expect(histories[0].error).toContain("Failed to deliver to Inngest after 4 attempts");
    expect(histories[0].error).toContain("Inngest unavailable");
  });

  it("continues processing the batch after a message fails", async () => {
    mockSend
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    const failing = buildMessage(message({ emailId: "failing-id" }), 1);
    const succeeding = buildMessage(message({ emailId: "succeeding-id" }), 1);

    await sendEmailQueueConsumer({ messages: [failing, succeeding] } as never, env);

    expect(failing.retry).toHaveBeenCalledTimes(1);
    expect(failing.ack).not.toHaveBeenCalled();
    expect(succeeding.ack).toHaveBeenCalledTimes(1);
    expect(succeeding.retry).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
