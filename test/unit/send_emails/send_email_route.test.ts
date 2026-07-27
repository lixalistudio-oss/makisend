import { describe, it, vi, expect } from "vitest";
import { Hono } from "hono";

import { error_handler } from "@/common/error_handler";
import SendEmailRouter, { sendEmailRoute } from "@/send-email/send_email.routes";

// -----------------------------------------------------------------------------
// Application Setup
// -----------------------------------------------------------------------------
const app = new Hono();
app.onError(error_handler);

// -----------------------------------------------------------------------------
// Mocking
// -----------------------------------------------------------------------------
// Mock the email service to isolate the route handler and control its output
const mockSendFn = vi.fn();

vi.mock("@/send-email/send_email.service", () => {
  return {
    SendEmailService: class {
      sendEmail = mockSendFn;
    },
  };
});

// -----------------------------------------------------------------------------
// Route Registration
// -----------------------------------------------------------------------------
sendEmailRoute(SendEmailRouter);
app.route("/send-email", SendEmailRouter);

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------
describe("Email Service", () => {
  describe("Sending Email Route", () => {
    it("POST /send-email should return 201 on success", async () => {
      // Arrange: Define the expected resolved value for the mocked service
      mockSendFn.mockResolvedValue({ message: "Email sent successfully" });

      // Act: Simulate a POST request using Hono's in-memory request handler
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "gedeon@example.com",
          subject: "Testing Feature Modules",
          text: "This text body is long enough to pass validation.",
          html: "<p>This HTML content is valid and sanitized.</p>",
        }),
      });

      // Assert: Verify the response status and payload structure
      expect(res.status).toBe(201);
      
      const json = await res.json();
      expect(json).toEqual({
        success: true,
        data: { message: "Email sent successfully" },
      });
    });
  });
});