import { describe, it, expect, vi, beforeEach } from "vitest";

import { SendEmailService } from "@/send-email/send_email.service";
import { Bindings } from "@/index";

// -----------------------------------------------------------------------------
// Mock Setup
// -----------------------------------------------------------------------------

// Hoist mock function to ensure it's available before module evaluation
const { mockEncryptFn } = vi.hoisted(() => ({
  mockEncryptFn: vi.fn(),
}));

const mockSaveEmailLogFn = vi.fn();
const mockNodemailerSendFn = vi.fn();

// Mock utils: preserve original utilities (e.g., cleanHtml) but override `encrypt`
vi.mock("@/common/utils", async (importActual) => {
  const actualUtils = await importActual<typeof import("@/common/utils")>();
  return {
    ...actualUtils,
    encrypt: mockEncryptFn,
  };
});

// Mock repository: intercept instantiation and route calls to our spy
vi.mock("@/send-email/send_email.repository", () => ({
  SendEmailRepository: class {
    saveEmailLog = mockSaveEmailLogFn;
  },
}));

// Mock nodemailer: bypass real network calls during testing
vi.mock("nodemailer", () => ({
  createTransport: vi.fn().mockImplementation(() => ({
    sendMail: mockNodemailerSendFn,
  })),
}));

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------
describe("EmailService", () => {
  let service: SendEmailService;
  let testBindings: Bindings;

  beforeEach(() => {
    // Define safe, mocked environment configuration
    testBindings = {
      HOST: "localhost",
      PORT: 587,
      SMTP_USER: "test-user",
      SMTP_PASSWORD: "test-password",
      SENDER_EMAIL: "system@example.com",
      AES_256_KEY: "DUMMY_KEY_NO_LONGER_CHECKED",
      makisend_db: {} as any, // Safe as empty object since the repository is fully mocked
    } as Bindings;

    // Instantiate the service with the mocked configuration
    service = new SendEmailService(testBindings);
  });

  it("should process and save email information successfully", async () => {
    // Arrange: Configure mock return values for all dependencies
    mockNodemailerSendFn.mockResolvedValue({ messageId: "mock-smtp-id-12345" });
    mockSaveEmailLogFn.mockResolvedValue(true);
    mockEncryptFn.mockResolvedValue("mocked_encrypted_string_data");

    const inputData = {
      to: "test@example.com",
      subject: "Hello",
      text: "This is the plain text body required by validation.",
      html: "<p>This is the HTML body required by validation.</p>",
    };

    // Act: Execute the target service method
    const result = await service.sendEmail(inputData);

    // Assert: Verify the service response
    expect(result.message).toBe("Email sent successfully");

    // Assert: Verify internal dependencies were triggered correctly
    expect(mockNodemailerSendFn).toHaveBeenCalledTimes(1);
    expect(mockSaveEmailLogFn).toHaveBeenCalledTimes(1);
    expect(mockEncryptFn).toHaveBeenCalledWith(
      "test@example.com",
      "DUMMY_KEY_NO_LONGER_CHECKED"
    );

    // Assert: Verify the repository received the correctly formatted payload
    expect(mockSaveEmailLogFn).toHaveBeenCalledWith(
      "mocked_encrypted_string_data", // Encrypted recipient email
      "Hello",                         // Subject
      "mock-smtp-id-12345",            // Mock messageId from nodemailer
      expect.any(String),              // ISO Timestamp string
      expect.any(Number)               // Performance duration (ms)
    );
  });
});