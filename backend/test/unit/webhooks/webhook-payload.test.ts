import { describe, it, expect } from "vitest";
import { buildEmailPayload, buildTestPayload, toPublicReason } from "@/webhooks/webhook-payload";
import type { WebhookEmailHistoryRow } from "@/webhooks/webhooks.types";

const NOW = new Date("2026-11-11T10:47:40.000Z");

const email = {
  emailId: "u9yf9iozlukgngtio78do7i0",
  to: "client@example.com",
  subject: "Votre facture",
  apiKeyId: "key-1",
  smtpMessageId: "<38aab58f@gmail.com>",
  createdAt: "2026-11-11T10:45:48.534Z",
};

const RAW_NODEMAILER = "Connection timeout to smtp.internal.acme.lan (10.1.2.3:587): ETIMEDOUT";

const row = (status: string, at: string, extra: Partial<WebhookEmailHistoryRow> = {}): WebhookEmailHistoryRow => ({
  status,
  error: null,
  attempts: null,
  createdAt: at,
  ...extra,
});

const sentHistory = [
  row("received", "2026-11-11T10:45:48.600Z"),
  row("processing", "2026-11-11T10:45:48.601Z"),
  row("cleaned", "2026-11-11T10:45:48.602Z"),
  row("attempt_failed", "2026-11-11T10:45:50.010Z", { attempts: 1, error: RAW_NODEMAILER }),
  row("sent", "2026-11-11T10:46:21.198Z", { attempts: 2 }),
];

describe("buildEmailPayload: email.sent", () => {
  const payload = buildEmailPayload({ eventType: "email.sent", failureKind: null, email, histories: sentHistory }, NOW);

  it("has the documented shape, in the documented key order", () => {
    expect(payload).toEqual({
      type: "email.sent",
      timestamp: NOW.toISOString(),
      data: {
        emailId: email.emailId,
        status: "sent",
        to: "client@example.com",
        subject: "Votre facture",
        apiKeyId: "key-1",
        smtpMessageId: "<38aab58f@gmail.com>",
        attempts: 2,
        createdAt: "2026-11-11T10:45:48.534Z",
        completedAt: "2026-11-11T10:46:21.198Z",
        history: expect.any(Array),
      },
    });
    expect(Object.keys(payload.data)).toEqual([
      "emailId", "status", "to", "subject", "apiKeyId", "smtpMessageId", "attempts", "createdAt", "completedAt", "history",
    ]);
    expect(payload.data).not.toHaveProperty("failureKind");
    expect(payload.data).not.toHaveProperty("reason");
  });

  it("lists the history oldest first", () => {
    expect(payload.data.history.map((h) => h.status)).toEqual(["received", "processing", "cleaned", "attempt_failed", "sent"]);
    expect(payload.data.history[4]).toEqual({ status: "sent", attempt: 2, at: "2026-11-11T10:46:21.198Z", reason: null });
  });

  it("never lets a raw transport message out (host, IP, port)", () => {
    const text = JSON.stringify(payload);
    expect(text).not.toContain("acme.lan");
    expect(text).not.toContain("10.1.2.3");
    expect(payload.data.history[3].reason).toMatch(/did not respond in time/);
  });
});

describe("buildEmailPayload: email.failed", () => {
  const failedHistory = [
    row("received", "2026-11-11T10:45:48.600Z"),
    row("attempt_failed", "2026-11-11T10:45:50.000Z", { attempts: 1, error: RAW_NODEMAILER }),
    row("attempt_failed", "2026-11-11T10:46:20.000Z", { attempts: 4, error: RAW_NODEMAILER }),
    row("failed", "2026-11-11T10:47:39.900Z", {
      attempts: 4,
      error: "Delivery abandoned after 4 attempts: The SMTP server did not respond in time.",
    }),
  ];

  it("carries failureKind and the final reason, and no smtpMessageId", () => {
    const payload = buildEmailPayload(
      { eventType: "email.failed", failureKind: "transient_exhausted", email, histories: failedHistory },
      NOW,
    );
    expect(payload.type).toBe("email.failed");
    expect(payload.data).toMatchObject({
      status: "failed",
      smtpMessageId: null,
      attempts: 4,
      failureKind: "transient_exhausted",
      reason: "Delivery abandoned after 4 attempts: The SMTP server did not respond in time.",
      completedAt: "2026-11-11T10:47:39.900Z",
    });
    expect(Object.keys(payload.data).slice(6, 9)).toEqual(["attempts", "failureKind", "reason"]);
  });

  it("replaces the platform's text when the workflow never started (internal)", () => {
    const payload = buildEmailPayload(
      {
        eventType: "email.failed",
        failureKind: "internal",
        email,
        histories: [row("failed", "2026-11-11T10:47:39.900Z", { attempts: 4, error: "Failed to start workflow after 4 attempts: workflows.internal error at 10.0.0.1" })],
      },
      NOW,
    );
    expect(payload.data.reason).toBe("MakiSend could not process this email. Please try sending it again.");
    expect(JSON.stringify(payload)).not.toContain("10.0.0.1");
  });

  it("defaults to internal when the kind was not recorded", () => {
    const payload = buildEmailPayload({ eventType: "email.failed", failureKind: null, email, histories: [] }, NOW);
    expect(payload.data).toMatchObject({ failureKind: "internal", attempts: 0, completedAt: NOW.toISOString() });
  });
});

describe("buildEmailPayload: limits and leaks", () => {
  it("keeps the 20 most recent history entries", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      row("attempt_failed", new Date(Date.UTC(2026, 10, 11, 10, 0, i)).toISOString(), { attempts: i + 1, error: "x" }),
    );
    const payload = buildEmailPayload({ eventType: "email.sent", failureKind: null, email, histories: many }, NOW);
    expect(payload.data.history).toHaveLength(20);
    expect(payload.data.history[0].attempt).toBe(11);
    expect(payload.data.history[19].attempt).toBe(30);
  });

  it("drops statuses that are not part of the email's lifecycle", () => {
    const payload = buildEmailPayload(
      { eventType: "email.sent", failureKind: null, email, histories: [row("internal_debug", "2026-11-11T10:00:00Z"), ...sentHistory] },
      NOW,
    );
    expect(payload.data.history.map((h) => h.status)).not.toContain("internal_debug");
  });

  it("contains no body, attachment or credential field", () => {
    const text = JSON.stringify(buildEmailPayload({ eventType: "email.sent", failureKind: null, email, histories: sentHistory }, NOW));
    for (const forbidden of ["html", "text\"", "attachments", "password", "smtpHostname", "smtpUsername"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("buildTestPayload", () => {
  it("is the documented webhook.test event", () => {
    expect(buildTestPayload("ep-1", NOW)).toEqual({
      type: "webhook.test",
      timestamp: NOW.toISOString(),
      data: { endpointId: "ep-1", message: "Test event from MakiSend" },
    });
  });
});

describe("toPublicReason", () => {
  it("filters attempt failures, keeps MakiSend's own final text", () => {
    expect(toPublicReason("attempt_failed", RAW_NODEMAILER, null)).not.toContain("10.1.2.3");
    expect(toPublicReason("failed", "Delivery rejected permanently: bad credentials", "permanent")).toBe(
      "Delivery rejected permanently: bad credentials",
    );
    expect(toPublicReason("sent", null, null)).toBeNull();
    expect(toPublicReason("received", "anything", null)).toBeNull();
  });
});
