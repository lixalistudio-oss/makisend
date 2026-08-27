import { describe, it, expect, vi, beforeEach } from "vitest";

import { SendEmailService } from "@/send-email/send-email.service";
import type {
  EmailInput,
  IEmailRepository,
  IEmailTransport,
} from "@/send-email/send-email.types";

// vi.hoisted runs before module mocking — these references must exist
// before vi.mock calls resolve, otherwise the mock factory can't find them.
const { mockEncryptFn, mockCleanHtmlFn } = vi.hoisted(() => ({
  mockEncryptFn: vi.fn(),
  mockCleanHtmlFn: vi.fn(),
}));

vi.mock("@/core/crypto", () => ({
  encrypt: mockEncryptFn,
}));

vi.mock("@/core/html-sanitizer", () => ({
  cleanHtml: mockCleanHtmlFn,
}));

describe("SendEmailService", () => {
  let service: SendEmailService;
  let mockTransport: IEmailTransport;
  let mockRepository: IEmailRepository;

  const TEST_AES_KEY = "a".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();

    mockTransport = {
      send: vi.fn().mockResolvedValue({ messageId: "mock-smtp-id-12345" }),
    };

    mockRepository = {
      saveEmailLog: vi.fn().mockResolvedValue(undefined),
      saveEmailHistory: vi.fn().mockResolvedValue(undefined),
    };

    mockEncryptFn.mockResolvedValue("mocked_encrypted_string_data");
    mockCleanHtmlFn.mockReturnValue("<p>cleaned html</p>");

    service = new SendEmailService(
      mockTransport,
      mockRepository,
      TEST_AES_KEY,
    );
  });

  it("should process and save email information successfully", async () => {
    const inputData: EmailInput = {
      to: "test@example.com",
      subject: "Hello",
      text: "This is the plain text body required by validation.",
      html: "<p>This is the HTML body required by validation.</p>",
    };

    const result = await service.sendEmail(inputData);

    expect(result.message).toBe("Email successfully dispatched");
    expect(mockTransport.send).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveEmailLog).toHaveBeenCalledTimes(1);

    // Verify encrypt is called with the raw recipient and the AES key.
    expect(mockEncryptFn).toHaveBeenCalledWith(
      "test@example.com",
      TEST_AES_KEY,
    );

    // The HTML must be sanitized before reaching the transport.
    expect(mockCleanHtmlFn).toHaveBeenCalledWith(inputData.html);

    // saveEmailLog signature: (internalId, userId, encryptedTo, subject, smtpId, sentAt, durationMs)
    expect(mockRepository.saveEmailLog).toHaveBeenCalledWith(
      expect.any(String),
      "system",
      "mocked_encrypted_string_data",
      "Hello",
      "mock-smtp-id-12345",
      expect.any(String),
      expect.any(Number),
    );
  });

  it("should propagate email delivery failures as AppError 500", async () => {
    mockTransport.send = vi.fn().mockRejectedValue(new Error("SMTP down"));

    await expect(
      service.sendEmail({
        to: "test@example.com",
        subject: "Hello",
        text: "This is the plain text body required by validation.",
        html: "<p>This is the HTML body required by validation.</p>",
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      message: "Email delivery failed",
    });
  });

  it("should call encrypt with the raw recipient address", async () => {
    await service.sendEmail({
      to: "alice@corp.com",
      subject: "Key check",
      text: "Verifying the correct key is passed through.",
      html: "<p>HTML body for key check.</p>",
    });

    expect(mockEncryptFn).toHaveBeenCalledWith("alice@corp.com", TEST_AES_KEY);
  });

  it("should pass the cleaned HTML to the transport", async () => {
    mockCleanHtmlFn.mockReturnValue("<p>sanitized</p>");

    await service.sendEmail({
      to: "bob@test.com",
      subject: "Sanitize check",
      text: "Ensuring HTML is cleaned before sending.",
      html: "<script>alert('xss')</script><p>real content</p>",
    });

    expect(mockTransport.send).toHaveBeenCalledWith(
      expect.objectContaining({ html: "<p>sanitized</p>" }),
    );
  });
});
