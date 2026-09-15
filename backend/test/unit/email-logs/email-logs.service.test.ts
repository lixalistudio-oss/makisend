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
  history: [
    { id: "h1", emailId: LOG_ID, status: "sent", error: null, createdAt: new Date().toISOString() },
  ],
};

describe("EmailLogService", () => {
  let service: EmailLogService;
  let mockRepo: IEmailLogRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptFn.mockResolvedValue("decrypted_value");

    mockRepo = {
      findByUserId: vi.fn() as IEmailLogRepository["findByUserId"],
      findById: vi.fn() as IEmailLogRepository["findById"],
    };
    (mockRepo.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValue([mockLog]);
    (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockLog);

    service = new EmailLogService(mockRepo, TEST_AES_KEY);
  });

  describe("findAllByUser", () => {
    it("should return logs for user", async () => {
      const result = await service.findAllByUser(USER_ID);
      expect(result).toEqual([{
        ...mockLog,
        to: "decrypted_value",
      }]);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith(USER_ID, undefined);
    });

    it("should pass filters to repo", async () => {
      const filters = { status: "sent" };
      await service.findAllByUser(USER_ID, filters);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith(USER_ID, filters);
    });
  });

  describe("findById", () => {
    it("should return log when found and owned", async () => {
      const result = await service.findById(LOG_ID, USER_ID);
      expect(result).toEqual({
        ...mockLog,
        to: "decrypted_value",
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
