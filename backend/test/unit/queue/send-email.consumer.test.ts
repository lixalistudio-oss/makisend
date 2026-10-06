import { describe, it, vi, expect, beforeEach } from "vitest";

vi.mock("@/inngest/client", () => ({
  getInngestClient: vi.fn(),
}));

import { getInngestClient } from "@/inngest/client";
import { sendEmailQueueConsumer } from "@/queue/send-email.consumer";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInngestClient).mockReturnValue({ send: mockSend } as never);
  });

  it("forwards the event to Inngest with a dedup id and acknowledges it", async () => {
    mockSend.mockResolvedValue(undefined);
    const msg = buildMessage(message());

    await sendEmailQueueConsumer({ messages: [msg] } as never);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      ...message(),
      id: "email-id-123",
    });
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("schedules a retry with exponential backoff when Inngest rejects the event", async () => {
    mockSend.mockRejectedValue(new Error("Inngest unavailable"));
    const msg = buildMessage(message(), 1);

    await sendEmailQueueConsumer({ messages: [msg] } as never);

    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 10 });
  });

  it("increases the backoff delay with each delivery attempt", async () => {
    mockSend.mockRejectedValue(new Error("Inngest unavailable"));
    const msg = buildMessage(message(), 3);

    await sendEmailQueueConsumer({ messages: [msg] } as never);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 40 });
  });

  it("caps the backoff delay at 5 minutes", async () => {
    mockSend.mockRejectedValue(new Error("Inngest unavailable"));
    const msg = buildMessage(message(), 50);

    await sendEmailQueueConsumer({ messages: [msg] } as never);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it("continues processing the batch after a message fails", async () => {
    mockSend
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    const failing = buildMessage(message({ emailId: "failing-id" }), 1);
    const succeeding = buildMessage(message({ emailId: "succeeding-id" }), 1);

    await sendEmailQueueConsumer({ messages: [failing, succeeding] } as never);

    expect(failing.retry).toHaveBeenCalledTimes(1);
    expect(failing.ack).not.toHaveBeenCalled();
    expect(succeeding.ack).toHaveBeenCalledTimes(1);
    expect(succeeding.retry).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
