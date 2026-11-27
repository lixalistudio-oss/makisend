import { describe, it, vi, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { sendEmailQueueConsumer } from "@/queue/send-email.consumer";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { emailHistories } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";
import type { Miniflare } from "miniflare";

const message = (emailId = "email-id-123"): SendEmailQueueMessage => ({ emailId });

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
  const mockGet = vi.fn();
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
      SEND_EMAIL_WORKFLOW: { create: mockCreate, get: mockGet },
    } as unknown as Bindings;
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "instance-123" });
    mockGet.mockResolvedValue(null);
  });

  it("starts a workflow instance keyed by the email id and acknowledges the message", async () => {
    const msg = buildMessage(message());

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      id: "email-id-123",
      params: { emailId: "email-id-123" },
    });
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("acks a duplicate delivery when the workflow instance already exists", async () => {
    mockCreate.mockRejectedValue(new Error("instance already exists"));
    mockGet.mockResolvedValue({ id: "email-id-123" });
    const msg = buildMessage(message());

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(mockGet).toHaveBeenCalledWith("email-id-123");
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
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
    const msg = buildMessage(message("capped-delay-id"), 50);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it("writes a failed history row when the retry budget is exhausted", async () => {
    mockCreate.mockRejectedValue(new Error("Workflow unavailable"));
    const msg = buildMessage(message("exhausted-id"), 4);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 80 });

    const histories = await db
      .select()
      .from(emailHistories)
      .where(eq(emailHistories.emailId, "exhausted-id"))
      .all();
    expect(histories).toHaveLength(1);
    expect(histories[0].emailId).toBe("exhausted-id");
    expect(histories[0].status).toBe("failed");
    expect(histories[0].attempts).toBe(4);
    expect(histories[0].error).toContain("Failed to start workflow after 4 attempts");
    expect(histories[0].error).toContain("Workflow unavailable");
  });

  it("continues processing the batch after a message fails", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "instance-ok" });

    const failing = buildMessage(message("failing-id"), 1);
    const succeeding = buildMessage(message("succeeding-id"), 1);

    await sendEmailQueueConsumer({ messages: [failing, succeeding] } as never, env);

    expect(failing.retry).toHaveBeenCalledTimes(1);
    expect(failing.ack).not.toHaveBeenCalled();
    expect(succeeding.ack).toHaveBeenCalledTimes(1);
    expect(succeeding.retry).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("discards a malformed message without starting a workflow", async () => {
    const msg = buildMessage({} as SendEmailQueueMessage);

    await sendEmailQueueConsumer({ messages: [msg] } as never, env);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });
});
