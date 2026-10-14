import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailLogService } from "@/email-logs/email-logs.service";
import type { IEmailLogRepository, EmailLogWithHistory } from "@/email-logs/email-logs.types";

const { mockDecryptFn } = vi.hoisted(() => ({
  mockDecryptFn: vi.fn(),
}));

vi.mock("@/core/crypto", () => ({
  decrypt: mockDecryptFn,
}));

vi.mock("@/core/logger", () => ({
  pinoLogger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const TEST_AES_KEY = "a".repeat(64);
const USER_ID = "user-123";
const LOG_ID = "log-123";

const mockLog: EmailLogWithHistory = {
  internalId: LOG_ID,
  userId: USER_ID,
  apiKeyId: "key-123",
  to: "encrypted_to",
  subject: "Hello",
  smtpId: "smtp-123",
  sentAt: new Date().toISOString(),
  emailProcessingTimeMs: 150,
  createdAt: new Date().toISOString(),
  history: [
    {
      id: "h1",
      emailId: LOG_ID,
      status: "sent",
      error: null,
      attempts: null,
      createdAt: new Date().toISOString(),
    },
  ],
};

describe("EmailLogService", () => {
  let service: EmailLogService;
  let mockRepo: IEmailLogRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptFn.mockImplementation(async (value: string) => `decrypted_${value}`);

    mockRepo = {
      findPageByUserId: vi.fn() as IEmailLogRepository["findPageByUserId"],
      findById: vi.fn() as IEmailLogRepository["findById"],
    };
    (mockRepo.findPageByUserId as ReturnType<typeof vi.fn>).mockResolvedValue({
      logs: [mockLog],
      nextCursor: null,
    });
    (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockLog);

    service = new EmailLogService(mockRepo, TEST_AES_KEY);
  });

  describe("findPageByUser", () => {
    it("should return decrypted logs and the next cursor", async () => {
      (mockRepo.findPageByUserId as ReturnType<typeof vi.fn>).mockResolvedValue({
        logs: [mockLog],
        nextCursor: "2026-01-01T00:00:00.000Z:log-123",
      });

      const result = await service.findPageByUser(USER_ID);

      expect(result.logs).toEqual([
        {
          ...mockLog,
          to: "decrypted_encrypted_to",
        },
      ]);
      expect(result.nextCursor).toBe("2026-01-01T00:00:00.000Z:log-123");
      expect(mockRepo.findPageByUserId).toHaveBeenCalledWith(USER_ID, undefined);
    });

    it("should pass filters (including pagination) to the repo", async () => {
      const filters = { status: "sent", limit: 25, cursor: "c1:x" };
      await service.findPageByUser(USER_ID, filters);
      expect(mockRepo.findPageByUserId).toHaveBeenCalledWith(USER_ID, filters);
    });

    it("should filter decrypted recipients by the to filter", async () => {
      (mockRepo.findPageByUserId as ReturnType<typeof vi.fn>).mockResolvedValue({
        logs: [
          mockLog,
          { ...mockLog, internalId: "log-456", to: "encrypted_other" },
        ],
        nextCursor: null,
      });
      mockDecryptFn.mockImplementation(async (value: string) =>
        value === "encrypted_to" ? "alice@example.com" : "bob@example.com",
      );

      const result = await service.findPageByUser(USER_ID, { to: "alice" });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].to).toBe("alice@example.com");
    });
  });

  describe("findById", () => {
    it("should return log when found and owned", async () => {
      const result = await service.findById(LOG_ID, USER_ID);
      expect(result).toEqual({
        ...mockLog,
        to: "decrypted_encrypted_to",
      });
    });

    it("should throw when log not found", async () => {
      (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(service.findById("nonexistent", USER_ID)).rejects.toThrow("Email log not found");
    });

    it("should throw when not owned by user", async () => {
      await expect(service.findById(LOG_ID, "other-user")).rejects.toThrow("Not authorized to access this email log");
    });
  });
});
