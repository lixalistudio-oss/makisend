import { describe, it, expect, vi, beforeEach } from "vitest";
import { SmtpConfigService } from "@/smtp-config/smtp-config.service";
import type { ISmtpConfigRepository, SmtpConfigRecord } from "@/smtp-config/smtp-config.types";

const { mockEncryptFn, mockDecryptFn, mockCheckSmtpConnection, mockSendTestEmail } = vi.hoisted(() => ({
  mockEncryptFn: vi.fn(),
  mockDecryptFn: vi.fn(),
  mockCheckSmtpConnection: vi.fn(),
  mockSendTestEmail: vi.fn(),
}));

vi.mock("@/core/crypto", () => ({
  encrypt: mockEncryptFn,
  decrypt: mockDecryptFn,
}));

vi.mock("@/core/logger", () => ({
  pinoLogger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/smtp-config/smtp-connection", () => ({
  checkSmtpConnection: mockCheckSmtpConnection,
  sendTestEmail: mockSendTestEmail,
}));

const TEST_AES_KEY = "a".repeat(64);
const USER_ID = "user-123";
const CONFIG_ID = "config-123";

const mockConfig: SmtpConfigRecord = {
  id: CONFIG_ID,
  userId: USER_ID,
  smtpHostname: "encrypted_host",
  smtpPort: 465,
  smtpSecurity: "tls",
  smtpUsername: "encrypted_user",
  smtpPassword: "encrypted_pass",
  senderEmail: "encrypted_sender",
  isActive: true,
  lastCheckAt: null,
  lastCheckOk: null,
  lastCheckError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// create()/update() must return plaintext like the read paths do
const decryptedConfig: SmtpConfigRecord = {
  ...mockConfig,
  smtpHostname: "decrypted_encrypted_host",
  smtpUsername: "decrypted_encrypted_user",
  smtpPassword: "decrypted_encrypted_pass",
  senderEmail: "decrypted_encrypted_sender",
};

describe("SmtpConfigService", () => {
  let service: SmtpConfigService;
  let mockRepo: ISmtpConfigRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEncryptFn.mockResolvedValue("encrypted_value");
    mockDecryptFn.mockImplementation((val: string) => Promise.resolve(`decrypted_${val}`));
    mockCheckSmtpConnection.mockResolvedValue({ ok: true });
    mockSendTestEmail.mockResolvedValue({ ok: true, messageId: "<test@example.com>" });

    mockRepo = {
      findByUserId: vi.fn() as ISmtpConfigRepository["findByUserId"],
      findAll: vi.fn() as ISmtpConfigRepository["findAll"],
      findById: vi.fn() as ISmtpConfigRepository["findById"],
      create: vi.fn() as ISmtpConfigRepository["create"],
      update: vi.fn() as ISmtpConfigRepository["update"],
      delete: vi.fn() as ISmtpConfigRepository["delete"],
    };
    (mockRepo.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValue([mockConfig]);
    (mockRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([mockConfig]);
    (mockRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (mockRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (mockRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (mockRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    service = new SmtpConfigService(mockRepo, TEST_AES_KEY);
  });

  describe("findAllByUser", () => {
    it("should return configs for user", async () => {
      const result = await service.findAllByUser(USER_ID);
      expect(result).toEqual([{
        ...mockConfig,
        smtpHostname: "decrypted_encrypted_host",
        smtpUsername: "decrypted_encrypted_user",
        smtpPassword: "decrypted_encrypted_pass",
        senderEmail: "decrypted_encrypted_sender",
      }]);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe("findByIdAndUser", () => {
    it("should return config when found and owned", async () => {
      const result = await service.findByIdAndUser(CONFIG_ID, USER_ID);
      expect(result).toEqual({
        ...mockConfig,
        smtpHostname: "decrypted_encrypted_host",
        smtpUsername: "decrypted_encrypted_user",
        smtpPassword: "decrypted_encrypted_pass",
        senderEmail: "decrypted_encrypted_sender",
      });
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
        smtpPort: 465,
        smtpSecurity: "tls" as const,
        smtpUsername: "user",
        smtpPassword: "pass",
        senderEmail: "test@test.com",
      };

      const result = await service.create(USER_ID, input);

      expect(mockEncryptFn).toHaveBeenCalledTimes(4);
      expect(mockRepo.create).toHaveBeenCalledWith(USER_ID, {
        smtpHostname: "encrypted_value",
        smtpPort: 465,
        smtpSecurity: "tls",
        smtpUsername: "encrypted_value",
        smtpPassword: "encrypted_value",
        senderEmail: "encrypted_value",
      });
      expect(result).toEqual(decryptedConfig);
    });
  });

  describe("update", () => {
    it("should encrypt and update config", async () => {
      const result = await service.update(CONFIG_ID, USER_ID, { smtpHostname: "new.host" });
      expect(mockEncryptFn).toHaveBeenCalledWith("new.host", TEST_AES_KEY);
      expect(mockRepo.update).toHaveBeenCalled();
      expect(result).toEqual(decryptedConfig);
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

    it("should adopt the usual security when only the port changes", async () => {
      await service.update(CONFIG_ID, USER_ID, { smtpPort: 587 });
      expect(mockRepo.update).toHaveBeenCalledWith(CONFIG_ID, {
        smtpPort: 587,
        smtpSecurity: "starttls",
      });
    });

    it("should keep an explicitly chosen security", async () => {
      await service.update(CONFIG_ID, USER_ID, { smtpPort: 465, smtpSecurity: "starttls" });
      expect(mockRepo.update).toHaveBeenCalledWith(CONFIG_ID, {
        smtpPort: 465,
        smtpSecurity: "starttls",
      });
    });

    it("should update security without touching the port", async () => {
      await service.update(CONFIG_ID, USER_ID, { smtpSecurity: "tls" });
      expect(mockRepo.update).toHaveBeenCalledWith(CONFIG_ID, { smtpSecurity: "tls" });
    });
  });

  describe("connection checks and test sends", () => {
    it("checks unsaved credentials without storing them", async () => {
      const input = {
        smtpHostname: "smtp.test.com",
        smtpPort: 587,
        smtpSecurity: "starttls" as const,
        smtpUsername: "user",
        smtpPassword: "pass",
      };

      await expect(service.checkConnection(input)).resolves.toEqual({ ok: true });
      expect(mockCheckSmtpConnection).toHaveBeenCalledWith({
        smtpHostName: "smtp.test.com",
        smtpPort: 587,
        smtpSecurity: "starttls",
        smtpUsername: "user",
        smtpPassword: "pass",
      });
      expect(mockEncryptFn).not.toHaveBeenCalled();
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("checks a saved configuration with its decrypted credentials", async () => {
      await service.checkConnectionById(CONFIG_ID, USER_ID);

      expect(mockCheckSmtpConnection).toHaveBeenCalledWith({
        smtpHostName: "decrypted_encrypted_host",
        smtpPort: 465,
        smtpSecurity: "tls",
        smtpUsername: "decrypted_encrypted_user",
        smtpPassword: "decrypted_encrypted_pass",
        senderEmail: "decrypted_encrypted_sender",
      });
    });

    it("sends a test email from the saved configuration's own sender", async () => {
      const email = { to: "dest@example.com", subject: "Probe", text: "hello" };
      await expect(service.sendTest(CONFIG_ID, USER_ID, email)).resolves.toEqual({
        ok: true,
        messageId: "<test@example.com>",
      });

      expect(mockSendTestEmail).toHaveBeenCalledWith(
        {
          smtpHostName: "decrypted_encrypted_host",
          smtpPort: 465,
          smtpSecurity: "tls",
          smtpUsername: "decrypted_encrypted_user",
          smtpPassword: "decrypted_encrypted_pass",
          senderEmail: "decrypted_encrypted_sender",
        },
        email,
      );
    });
  });

  describe("scheduled health check", () => {
    it("checks every configuration and stores the outcome", async () => {
      const second = { ...mockConfig, id: "config-456" };
      (mockRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([mockConfig, second]);
      mockCheckSmtpConnection
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: false,
          reason: "authentication",
          message: "The server refused the user name or the password.",
        });

      await expect(service.checkAll()).resolves.toEqual({ checked: 2, healthy: 1 });

      expect(mockCheckSmtpConnection).toHaveBeenCalledTimes(2);
      expect(mockRepo.update).toHaveBeenNthCalledWith(1, CONFIG_ID, {
        lastCheckAt: expect.any(Date),
        lastCheckOk: true,
        lastCheckError: null,
      });
      expect(mockRepo.update).toHaveBeenNthCalledWith(2, "config-456", {
        lastCheckAt: expect.any(Date),
        lastCheckOk: false,
        lastCheckError: "The server refused the user name or the password.",
      });
    });

    it("records a failed check when the stored configuration cannot be decrypted", async () => {
      mockDecryptFn.mockRejectedValueOnce(new Error("decrypt failed"));

      await expect(service.checkAll()).resolves.toEqual({ checked: 1, healthy: 0 });
      expect(mockCheckSmtpConnection).not.toHaveBeenCalled();
      expect(mockRepo.update).toHaveBeenCalledWith(CONFIG_ID, {
        lastCheckAt: expect.any(Date),
        lastCheckOk: false,
        lastCheckError: "The stored SMTP configuration could not be read.",
      });
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
