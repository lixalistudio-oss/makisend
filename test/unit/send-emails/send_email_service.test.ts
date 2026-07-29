import { describe, it, expect, vi, beforeEach } from "vitest";

import { SendEmailService } from "@/send-email/send-email.service";
import type {
  EmailInput,
  IEmailRepository,
  IEmailTransport,
} from "@/send-email/send-email.types";

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

  beforeEach(() => {
    mockTransport = {
      send: vi.fn().mockResolvedValue({ messageId: "mock-smtp-id-12345" }),
    };

    mockRepository = {
      saveEmailLog: vi.fn().mockResolvedValue(undefined),
    };

    mockEncryptFn.mockResolvedValue("mocked_encrypted_string_data");
    mockCleanHtmlFn.mockReturnValue("<p>cleaned html</p>");

    service = new SendEmailService(
      mockTransport,
      mockRepository,
      "DUMMY_KEY_NO_LONGER_CHECKED",
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

    expect(result.message).toBe("Email sent successfully");
    expect(mockTransport.send).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveEmailLog).toHaveBeenCalledTimes(1);
    expect(mockEncryptFn).toHaveBeenCalledWith(
      "test@example.com",
      "DUMMY_KEY_NO_LONGER_CHECKED",
    );
    expect(mockCleanHtmlFn).toHaveBeenCalledWith(inputData.html);

    expect(mockRepository.saveEmailLog).toHaveBeenCalledWith(
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
});
