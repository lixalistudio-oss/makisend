import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateSmtpTransport, mockSendMail, mockClose } = vi.hoisted(() => ({
  mockCreateSmtpTransport: vi.fn(),
  mockSendMail: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock("@/smtp-config/smtp-connection", () => ({
  createSmtpTransport: mockCreateSmtpTransport,
}));

import { SmtpEmailTransport } from "@/transports";

const config = {
  smtpHostName: "smtp.example.com",
  smtpPort: 587,
  smtpSecurity: "starttls" as const,
  smtpUsername: "user@example.com",
  smtpPassword: "secret",
  senderEmail: "sender@example.com",
};

const email = {
  to: "dest@example.com",
  subject: "Subject",
  text: "Plain text",
  html: "<p>HTML</p>",
};

describe("SmtpEmailTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSmtpTransport.mockReturnValue({
      sendMail: mockSendMail,
      close: mockClose,
    });
    mockSendMail.mockResolvedValue({ messageId: "<message@example.com>" });
  });

  it("builds the transport from the configuration's own SMTP settings", () => {
    new SmtpEmailTransport(config);
    expect(mockCreateSmtpTransport).toHaveBeenCalledWith(config);
  });

  it("sends with the configured sender and returns the provider message id", async () => {
    const transport = new SmtpEmailTransport(config);

    await expect(transport.send(email)).resolves.toEqual({
      messageId: "<message@example.com>",
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: config.senderEmail,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("closes the transport when the send fails, so workerd does not hang", async () => {
    mockSendMail.mockRejectedValue(new Error("SMTP down"));
    const transport = new SmtpEmailTransport(config);

    await expect(transport.send(email)).rejects.toThrow("SMTP down");
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
