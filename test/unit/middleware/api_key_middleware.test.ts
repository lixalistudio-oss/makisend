// import { Hono } from "hono";
// import { describe, it, expect, vi, beforeEach } from "vitest";
// import { apiKeyMiddleware } from "@/middleware/api-key.middleware"; // Adjust path
// import { AppError } from "@/core/errors";
// import * as dbModule from "@/db/connection";
// import * as cryptoModule from "@/core/crypto";
// import { Bindings, UserInfoVariables } from "@/index";
// import { pinoLogger } from "@/core/logger";

// // 1. Mock the external dependencies
// vi.mock("@/db/connection");
// vi.mock("@/core/crypto");

// describe("API Key Middleware", () => {
//   let app = new Hono<{ Bindings: Bindings,Variables: UserInfoVariables }>();
//   const mockConfig = { db: "mock-db-instance", aesKey: "super-secret-key" } as any;

//   // Create a mock Drizzle query chain
//   const mockDbQuery = {
//     select: vi.fn().mockReturnThis(),
//     from: vi.fn().mockReturnThis(),
//     innerJoin: vi.fn().mockReturnThis(),
//     where: vi.fn().mockReturnThis(),
//     limit: vi.fn(), // We will control the result of this in each test
//   };

//   beforeEach(() => {
//     vi.resetAllMocks();

//     // Tell the mocked createDatabase to return our mock query chain
//     vi.mocked(dbModule.createDatabase).mockReturnValue(mockDbQuery as any);

//     // Tell the mocked decrypt to just return "decrypted_" + the input
//     vi.mocked(cryptoModule.decrypt).mockImplementation(async (text) => `decrypted_${text}`);

//     // 2. Setup the test app
//     app = new Hono<{ Bindings: Bindings,Variables: UserInfoVariables }>();
    
//     // Apply the middleware
//     app.use("*", apiKeyMiddleware(mockConfig));
    
//     // Add a dummy route to verify the middleware passed and context is set
//     app.get("/test", (c) => {
//       const smtp = c.get("smtpConfig");
//       const user = c.get("userConfig");
//       return c.json({ 
//         success: true, 
//         sender: smtp.senderEmail,
//         userId: user.userId 
//       });
//     });

//     // 3. Catch the AppError thrown by your middleware so it returns proper HTTP statuses
//     app.onError((err, c) => {
//       if (err instanceof AppError) {
//         pinoLogger.error({ error: err }, "Internal Server Error");
//          throw new AppError(500, "Internal Server Error");
//       }
//       return c.json({ error: "Internal Server Error" }, 500);
//     });
//   });

//   // --- THE TESTS ---

//   it("should return 401 if no headers are provided", async () => {
//     const res = await app.request("/send-email");
//     expect(res.status).toBe(401);
//     const body = (await res.json()) as { error: string };
//     expect(body.error ).toContain("Missing");
//   });

//   it("should return 401 if the key does not start with 'mk.'", async () => {
//     const res = await app.request("/test", {
//       headers: { "x-api-key": "invalid_prefix_123" },
//     });
//     expect(res.status).toBe(401);
//   });

//   it("should return 403 if the API key is not found in the database", async () => {
//     // Simulate database returning empty array
//     mockDbQuery.limit.mockResolvedValueOnce([]);

//     const res = await app.request("/test", {
//       headers: { "x-api-key": "mk.unknown-key" },
//     });
//     expect(res.status).toBe(403);
//   });

//   it("should allow request with valid x-api-key and set context", async () => {
//     // Simulate database returning a valid record
//     mockDbQuery.limit.mockResolvedValueOnce([{
//       userId: "user_123",
//       smtpUsername: "enc_user",
//       smtpPassword: "enc_pass",
//       smtpHostName: "enc_host",
//       senderEmail: "enc_email",
//     }]);

//     const res = await app.request("/test", {
//       headers: { "x-api-key": "mk.valid-key-123" },
//     });

//     expect(res.status).toBe(200);
//     const body = await res.json() as { success: boolean; sender: string; userId: string };
//     // Verify the middleware decrypted and attached data to the context
//     expect(body.success).toBe(true);
//     expect(body.sender).toBe("decrypted_enc_email");
//     expect(body.userId).toBe("user_123");
//   });

//   it("should allow request with valid Authorization Bearer header", async () => {
//     mockDbQuery.limit.mockResolvedValueOnce([{
//       userId: "user_456",
//       smtpUsername: "enc_user",
//       smtpPassword: "enc_pass",
//       smtpHostName: "enc_host",
//       senderEmail: "enc_email",
//     }]);

//     const res = await app.request("/test", {
//       headers: { "Authorization": "Bearer mk.valid-key-456" },
//     });

//     expect(res.status).toBe(200);
//   });

//   it("should trim invisible spaces from the Bearer token", async () => {
//     mockDbQuery.limit.mockResolvedValueOnce([{
//       userId: "user_789",
//       smtpUsername: "u", smtpPassword: "p", smtpHostName: "h", senderEmail: "e",
//     }]);

//     // Notice the trailing space in the header
//     const res = await app.request("/test", {
//       headers: { "Authorization": "Bearer mk.valid-key-789 " }, 
//     });

//     expect(res.status).toBe(200);
//   });
// });