import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardService } from "@/dashboard/dashboard.service";
import type { IDashboardRepository, DashboardStats, SmtpConfigBreakdown, RecentEmail, ErrorSummary } from "@/dashboard/dashboard.types";

vi.mock("@/core/logger", () => ({
  pinoLogger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const USER_ID = "user-123";

const mockStats: DashboardStats = {
  totalSent: 100,
  successCount: 90,
  failureCount: 10,
  successRate: 90,
};

const mockBreakdown: SmtpConfigBreakdown[] = [
  { smtpConfigId: "c1", senderEmail: "a@test.com", totalSent: 60, successCount: 55, failureCount: 5 },
  { smtpConfigId: "c2", senderEmail: "b@test.com", totalSent: 40, successCount: 35, failureCount: 5 },
];

const mockRecent: RecentEmail[] = [
  { internalId: "l1", to: "x@test.com", subject: "Hi", status: "sent", sentAt: new Date().toISOString(), emailProcessingTimeMs: 100 },
];

const mockErrors: ErrorSummary[] = [
  { error: "SMTP connection refused", count: 5 },
  { error: "Invalid recipient", count: 3 },
];

describe("DashboardService", () => {
  let service: DashboardService;
  let mockRepo: IDashboardRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepo = {
      getStats: vi.fn().mockResolvedValue(mockStats),
      getByConfig: vi.fn().mockResolvedValue(mockBreakdown),
      getRecent: vi.fn().mockResolvedValue(mockRecent),
      getErrors: vi.fn().mockResolvedValue(mockErrors),
    };

    service = new DashboardService(mockRepo);
  });

  describe("getStats", () => {
    it("should return stats from repo", async () => {
      const result = await service.getStats(USER_ID, 7);
      expect(result).toEqual(mockStats);
      expect(mockRepo.getStats).toHaveBeenCalledWith(USER_ID, 7);
    });

    it("should pass undefined days", async () => {
      await service.getStats(USER_ID);
      expect(mockRepo.getStats).toHaveBeenCalledWith(USER_ID, undefined);
    });
  });

  describe("getByConfig", () => {
    it("should return breakdown from repo", async () => {
      const result = await service.getByConfig(USER_ID, 30);
      expect(result).toEqual(mockBreakdown);
      expect(mockRepo.getByConfig).toHaveBeenCalledWith(USER_ID, 30);
    });
  });

  describe("getRecent", () => {
    it("should return recent emails from repo", async () => {
      const result = await service.getRecent(USER_ID, 10);
      expect(result).toEqual(mockRecent);
      expect(mockRepo.getRecent).toHaveBeenCalledWith(USER_ID, 10);
    });
  });

  describe("getErrors", () => {
    it("should return error summary from repo", async () => {
      const result = await service.getErrors(USER_ID, 7, 5);
      expect(result).toEqual(mockErrors);
      expect(mockRepo.getErrors).toHaveBeenCalledWith(USER_ID, 7, 5);
    });
  });
});
