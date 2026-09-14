import { describe, it, expect, vi, beforeEach } from "vitest";
import { SmtpConfigService } from "@/smtp-config/smtp-config.service";
import type { ISmtpConfigRepository, SmtpConfigRecord } from "@/smtp-config/smtp-config.types";

const { mockEncryptFn } = vi.hoisted(() => ({
  mockEncryptFn: vi.fn(),
}));

vi.mock("@/core/crypto", () => ({
  encrypt: mockEncryptFn,
}));

vi.mock("@/core/logger", () => ({
  pinoLogger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const TEST_AES_KEY = "a".repeat(64);
const USER_ID = "user-123";
const CONFIG_ID = "config-123";

const mockConfig: SmtpConfigRecord = {
  id: CONFIG_ID,
  userId: USER_ID,
  smtpHostname: "encrypted_host",
  smtpUsername: "encrypted_user",
  smtpPassword: "encrypted_pass",
  senderEmail: "encrypted_sender",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("SmtpConfigService", () => {
  let service: SmtpConfigService;
  let mockRepo: ISmtpConfigRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEncryptFn.mockResolvedValue("encrypted_value");

    mockRepo = {
      findByUserId: vi.fn() as ISmtpConfigRepository["findByUserId"],
      findById: vi.fn() as ISmtpConfigRepository["findById"],
      create: vi.fn() as ISmtpConfigRepository["create"],
      update: vi.fn() as ISmtpConfigRepository["update"],
      delete: vi.fn() as ISmtpConfigRepository["delete"],
    };
    (mockRepo.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValue([mockConfig]);
    (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (mockRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (mockRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (mockRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    service = new SmtpConfigService(mockRepo, TEST_AES_KEY);
  });

  describe("findAllByUser", () => {
    it("should return configs for user", async () => {
      const result = await service.findAllByUser(USER_ID);
      expect(result).toEqual([mockConfig]);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe("findByIdAndUser", () => {
    it("should return config when found and owned", async () => {
      const result = await service.findByIdAndUser(CONFIG_ID, USER_ID);
      expect(result).toEqual(mockConfig);
    });

    it("should throw 404 when config not found", async () => {
      (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(service.findByIdAndUser("nonexistent", USER_ID)).rejects.toMatchObject({
        statusCode: 404,
        message: "SMTP config not found",
      });
    });

    it("should throw 403 when not owned by user", async () => {
      await expect(service.findByIdAndUser(CONFIG_ID, "other-user")).rejects.toMatchObject({
        statusCode: 403,
        message: "Not authorized to access this SMTP config",
      });
    });
  });

  describe("create", () => {
    it("should encrypt all fields and create config (no API key)", async () => {
      const input = {
        smtpHostname: "smtp.test.com",
        smtpUsername: "user",
        smtpPassword: "pass",
        senderEmail: "test@test.com",
      };

      const result = await service.create(USER_ID, input);

      expect(mockEncryptFn).toHaveBeenCalledTimes(4);
      expect(mockRepo.create).toHaveBeenCalledWith(USER_ID, {
        smtpHostname: "encrypted_value",
        smtpUsername: "encrypted_value",
        smtpPassword: "encrypted_value",
        senderEmail: "encrypted_value",
      });
      expect(result).toEqual(mockConfig);
    });
  });

  describe("update", () => {
    it("should encrypt and update config", async () => {
      const result = await service.update(CONFIG_ID, USER_ID, { smtpHostname: "new.host" });
      expect(mockEncryptFn).toHaveBeenCalledWith("new.host", TEST_AES_KEY);
      expect(mockRepo.update).toHaveBeenCalled();
      expect(result).toEqual(mockConfig);
    });

    it("should throw 404 when config not found", async () => {
      (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(service.update("nonexistent", USER_ID, {})).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("should throw 403 when not owned", async () => {
      await expect(service.update(CONFIG_ID, "other-user", {})).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("should pass isActive without encryption", async () => {
      await service.update(CONFIG_ID, USER_ID, { isActive: false });
      expect(mockRepo.update).toHaveBeenCalledWith(CONFIG_ID, { isActive: false });
    });
  });

  describe("delete", () => {
    it("should delete config", async () => {
      await service.delete(CONFIG_ID, USER_ID);
      expect(mockRepo.delete).toHaveBeenCalledWith(CONFIG_ID);
    });

    it("should throw 404 when config not found", async () => {
      (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(service.delete("nonexistent", USER_ID)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("should throw 403 when not owned", async () => {
      await expect(service.delete(CONFIG_ID, "other-user")).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });
});
