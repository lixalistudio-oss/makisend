import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardService } from "@/dashboard/dashboard.service";
import type { IDashboardRepository, DashboardStats, SmtpConfigBreakdown, ApiKeyMetrics, RecentEmail, ErrorSummary } from "@/dashboard/dashboard.types";

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

const mockStats: DashboardStats = {
  totalSent: 100,
  successCount: 90,
  failureCount: 10,
  successRate: 90,
};

const mockBreakdown: SmtpConfigBreakdown[] = [
  { smtpConfigId: "c1", senderEmail: "encrypted_a", totalSent: 60, successCount: 55, failureCount: 5 },
  { smtpConfigId: "c2", senderEmail: "encrypted_b", totalSent: 40, successCount: 35, failureCount: 5 },
];

const mockByKey: ApiKeyMetrics[] = [
  {
    apiKeyId: "k1",
    name: "Production",
    prefix: "mk_",
    start: "mk_abcd",
    enabled: true,
    totalSent: 10,
    successCount: 9,
    failureCount: 1,
    successRate: 90,
    avgProcessingTimeMs: 120,
    lastUsedAt: "2026-10-11T10:00:00.000Z",
  },
];

const mockRecent: RecentEmail[] = [
  { internalId: "l1", to: "encrypted_x", subject: "Hi", status: "sent", sentAt: new Date().toISOString(), emailProcessingTimeMs: 100 },
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
    mockDecryptFn.mockResolvedValue("decrypted_value");

    mockRepo = {
      getStats: vi.fn().mockResolvedValue(mockStats),
      getByApiKey: vi.fn().mockResolvedValue(mockByKey),
      getByConfig: vi.fn().mockResolvedValue(mockBreakdown),
      getRecent: vi.fn().mockResolvedValue(mockRecent),
      getErrors: vi.fn().mockResolvedValue(mockErrors),
    };

    service = new DashboardService(mockRepo, TEST_AES_KEY);
  });

  describe("getStats", () => {
    it("should return stats from repo", async () => {
      const result = await service.getStats(USER_ID, 7);
      expect(result).toEqual(mockStats);
      expect(mockRepo.getStats).toHaveBeenCalledWith(USER_ID, 7, undefined);
    });

    it("should pass undefined days", async () => {
      await service.getStats(USER_ID);
      expect(mockRepo.getStats).toHaveBeenCalledWith(USER_ID, undefined, undefined);
    });

    it("scopes to one API key when given one", async () => {
      await service.getStats(USER_ID, 7, "key-9");
      expect(mockRepo.getStats).toHaveBeenCalledWith(USER_ID, 7, "key-9");
    });
  });

  describe("getByConfig", () => {
    it("should return breakdown from repo", async () => {
      const result = await service.getByConfig(USER_ID, 30);
      expect(result).toEqual(mockBreakdown.map((b) => ({ ...b, senderEmail: "decrypted_value" })));
      expect(mockRepo.getByConfig).toHaveBeenCalledWith(USER_ID, 30);
    });
  });

  describe("getRecent", () => {
    it("should return recent emails from repo", async () => {
      const result = await service.getRecent(USER_ID, 10);
      expect(result).toEqual(mockRecent.map((r) => ({ ...r, to: "decrypted_value" })));
      expect(mockRepo.getRecent).toHaveBeenCalledWith(USER_ID, 10);
    });
  });

  describe("getByApiKey", () => {
    it("returns the per-key metrics from the repository", async () => {
      const result = await service.getByApiKey(USER_ID, 30);
      expect(mockRepo.getByApiKey).toHaveBeenCalledWith(USER_ID, 30);
      expect(result).toEqual(mockByKey);
    });
  });

  describe("getErrors", () => {
    it("should return error summary from repo", async () => {
      const result = await service.getErrors(USER_ID, 7, 5);
      expect(result).toEqual(mockErrors);
      expect(mockRepo.getErrors).toHaveBeenCalledWith(USER_ID, 7, 5, undefined);
    });

    it("scopes to one API key when given one", async () => {
      await service.getErrors(USER_ID, 7, 5, "key-9");
      expect(mockRepo.getErrors).toHaveBeenCalledWith(USER_ID, 7, 5, "key-9");
    });
  });
});
