import { describe, it, vi, expect, beforeEach, beforeAll, afterAll } from "vitest";
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
  const mockCreate = vi.fn();
  let mf: Miniflare;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let env: Bindings;

  beforeAll(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    db = testD1.db;
    env = {
      makisend_db: testD1.d1,
      SEND_EMAIL_WORKFLOW: { create: mockCreate },
    } as unknown as Bindings;
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "instance-123" });
  });

  it("starts a workflow instance with a cycle-scoped id and acknowledges the message", async () => {
    const msg = buildMessage(message());

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      id: "email-id-123:0",
      params: message().data,
    });
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("scopes the instance id to the queue cycle so a re-enqueued message triggers a fresh run", async () => {
    const msg = buildMessage(message({ queueCycles: 2 }));

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(mockCreate).toHaveBeenCalledWith({
      id: "email-id-123:2",
      params: message({ queueCycles: 2 }).data,
    });
  });

  it("schedules a retry with exponential backoff when workflow creation fails", async () => {
    mockCreate.mockRejectedValue(new Error("Workflow unavailable"));
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
    mockCreate.mockRejectedValue(new Error("Workflow unavailable"));
    const msg = buildMessage(message(), 3);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 40 });
  });

  it("caps the backoff delay at 5 minutes", async () => {
    mockCreate.mockRejectedValue(new Error("Workflow unavailable"));
    const msg = buildMessage(message({ emailId: "capped-delay-id" }), 50);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it("writes a failed history row when the retry budget is exhausted", async () => {
    mockCreate.mockRejectedValue(new Error("Workflow unavailable"));
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
    expect(histories[0].error).toContain("Failed to start workflow after 4 attempts");
    expect(histories[0].error).toContain("Workflow unavailable");
  });

  it("continues processing the batch after a message fails", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "instance-ok" });

    const failing = buildMessage(message({ emailId: "failing-id" }), 1);
    const succeeding = buildMessage(message({ emailId: "succeeding-id" }), 1);

    await sendEmailQueueConsumer({ messages: [failing, succeeding] } as never, env);

    expect(failing.retry).toHaveBeenCalledTimes(1);
    expect(failing.ack).not.toHaveBeenCalled();
    expect(succeeding.ack).toHaveBeenCalledTimes(1);
    expect(succeeding.retry).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
