import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiKeyService } from "@/api-keys/api-keys.service";
import type { IApiKeyRepository, ApiKeyRecord, ApiKeyCreatedResult } from "@/api-keys/api-keys.types";

vi.mock("@/core/logger", () => ({
  pinoLogger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const USER_ID = "user-123";
const KEY_ID = "key-123";

const mockKey: ApiKeyRecord = {
  id: KEY_ID,
  name: "Test Key",
  prefix: "mk_",
  start: "mk_",
  enabled: true,
  smtpConfigId: "config-123",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockKeyResult: ApiKeyCreatedResult = {
  key: "mk_secret_123",
  record: mockKey,
};

describe("ApiKeyService", () => {
  let service: ApiKeyService;
  let mockRepo: IApiKeyRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepo = {
      findByUserId: vi.fn() as IApiKeyRepository["findByUserId"],
      findById: vi.fn() as IApiKeyRepository["findById"],
      create: vi.fn() as IApiKeyRepository["create"],
      delete: vi.fn() as IApiKeyRepository["delete"],
    };
    (mockRepo.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValue([mockKey]);
    (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockKey);
    (mockRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockKeyResult);
    (mockRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    service = new ApiKeyService(mockRepo);
  });

  describe("findAllByUser", () => {
    it("should return keys for user", async () => {
      const result = await service.findAllByUser(USER_ID);
      expect(result).toEqual([mockKey]);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe("findById", () => {
    it("should return key by id", async () => {
      const result = await service.findById(KEY_ID);
      expect(result).toEqual(mockKey);
    });

    it("should return null when not found", async () => {
      (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await service.findById("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("should create key via repo", async () => {
      const result = await service.create(USER_ID, { smtpConfigId: "config-123", name: "Test" });
      expect(result).toEqual(mockKeyResult);
      expect(mockRepo.create).toHaveBeenCalledWith(USER_ID, { smtpConfigId: "config-123", name: "Test" });
    });
  });

  describe("delete", () => {
    it("should delete key when owned", async () => {
      await service.delete(KEY_ID, USER_ID);
      expect(mockRepo.delete).toHaveBeenCalledWith(KEY_ID);
    });

    it("should throw 404 when key not found", async () => {
      (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(service.delete("nonexistent", USER_ID)).rejects.toMatchObject({
        statusCode: 404,
        message: "API key not found",
      });
    });

    it("should throw 403 when not owned", async () => {
      (mockRepo.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await expect(service.delete(KEY_ID, "other-user")).rejects.toMatchObject({
        statusCode: 403,
        message: "Not authorized to delete this API key",
      });
    });
  });
});
