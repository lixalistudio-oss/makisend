import { Hono } from "hono";
import { error_handler } from "./common/error_handler";
import SendEmailController from "./send-email/send_email.routes";
import { loggerMiddleware } from "./middleware/middleware_logger";
const app = new Hono()

app.use('*',loggerMiddleware())
app.onError(error_handler)


export type Bindings = { // Used to map and define environment variable types
  AES_256_KEY: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  makisend_db: D1Database;
  SENDER_EMAIL: string;
  HOST: string;
  PORT: number;
};

// sendEmailRoute(SendEmailRouter);
app.route('/send-email', SendEmailController)

// // --- ROUTE: Read Specific Email Logs ---
// app.get('/email-logs', async (c) => {
//   const db = getDrizzle(c.env.makisend_db);
//   const secretKey = c.env.AES_256_KEY;
  
//   const allLogs = await db.select().from(emailLogs).orderBy(desc(emailLogs.sentAt));

//   const decryptedLogs = await Promise.all(
//     allLogs.map(async (emailLog) => {
//       return {
//         ...emailLog,
//         to: await decrypt(emailLog.to, secretKey),
//       };
//     })
//   );

//   return c.json({ success: true, data: decryptedLogs });
// });

 export default app;
