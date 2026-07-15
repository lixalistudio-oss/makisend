/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono';
import * as nodemailer from 'nodemailer';
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { emailLogs, logs } from "./db/schema";
import { encrypt, decrypt } from '../crypto';

type Bindings = {
  AES_256_KEY: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  makisend_db: D1Database;
  SENDER_EMAIL: string;
  HOST: string;
  PORT: number;
};

const app = new Hono<{ Bindings: Bindings }>();

// Reuse Drizzle instance to avoid re-initialization overhead per request
let drizzleClient: ReturnType<typeof drizzle> | null = null;

const getDrizzle = (db: D1Database) => {
  if (!drizzleClient) {
    drizzleClient = drizzle(db);
    }
  return drizzleClient;
};

// --- ROUTE: Send Email & Log Transaction ---
app.post('/send-email', async (c) => {
  const db = getDrizzle(c.env.makisend_db);
  const secretKey = c.env.AES_256_KEY;

  const transporter = nodemailer.createTransport({
    host: c.env.HOST,
    port: c.env.PORT,
    secure: true,
    auth: {
      user: c.env.SMTP_USER,
      pass: c.env.SMTP_PASSWORD,
    },
    tls: {
      rejectUnauthorized: true // Prevents Man-in-the-Middle attacks
    }
  } as any);

  try {
    const { to, subject, text, html } = await c.req.json();
    const encryptedTo = await encrypt(to, secretKey);

    // 1. Log initialization (PENDING state)
    const [insertedRow] = await db.insert(logs).values({
      endpoint: "/send-email",
      message: "Email record initialized. Delivery status set to PENDING.",
      message_details: JSON.stringify({ to: encryptedTo }),
      sentAt: new Date().toISOString()
    }).returning();//Used to access the last inserted row in the database

    // 2. Send the email
    const info = await transporter.sendMail({
      from: c.env.SENDER_EMAIL,
      to,
      subject,
      text,
      html,
    });

    // 3. Update log with success details and SMTP receipt
    await db.update(logs)
      .set({
        message: "Email sent successfully",
        message_details: JSON.stringify({ 
          to: encryptedTo, 
          messageId: info.messageId 
        }),
        sentAt: new Date().toISOString()
      })
      .where(eq(logs.id, insertedRow.id));

    // 4. Insert dedicated email log record
    await db.insert(emailLogs).values({
      to: encryptedTo,
      subject: subject,
      smtpId: info.messageId,
      sentAt: new Date().toISOString()
    });

    return c.json({ 
      success: true, 
      message: 'Email successfully sent and logged to D1',
      messageId: info.messageId 
    });

  } catch (err: any) {
    console.error('Error during email process:', err);
    
    // Fallback: Log the failure to the unified audit table
    try {
      await db.insert(logs).values({
        endpoint: "/send-email",
        message: err.message || 'Unknown error occurred',
        message_details: err.stack || JSON.stringify(err),
        sentAt: new Date().toISOString()
      });
    } catch (dbErr) {
      console.error('CRITICAL: Failed to log error to D1:', dbErr);
    }

    return c.json({ 
      success: false, 
      error: 'Failed to send email. The issue has been logged for review.' 
    }, 500);
  }
});

// --- ROUTE: Read Unified Logs (Successes and Errors) ---
app.get('/logs', async (c) => {
  const db = getDrizzle(c.env.makisend_db);
  const secretKey = c.env.AES_256_KEY;
  
  const allLogs = await db.select().from(logs).orderBy(desc(logs.sentAt));

  // Decrypt message_details safely (handles the object structure saved in POST route)
  const decryptedLogs = await Promise.all(
    allLogs.map(async (log) => {
       // 1. Directly parse (guaranteed NOT NULL and valid JSON by your schema)
      const parsedDetails = JSON.parse(log.message_details);

      // 2. Decrypt the encrypted field directly
      // Note: Use 'encryptedTo' or 'to' depending on the exact key name you used in your POST route
      if (parsedDetails.to) {
        parsedDetails.to = await decrypt(parsedDetails.to, secretKey);
      }

      return {
        ...log,
        message_details: parsedDetails,
      };
    })
  );

  return c.json({ success: true, data: decryptedLogs });
});

// --- ROUTE: Read Specific Email Logs ---
app.get('/email-logs', async (c) => {
  const db = getDrizzle(c.env.makisend_db);
  const secretKey = c.env.AES_256_KEY;
  
  const allLogs = await db.select().from(emailLogs).orderBy(desc(emailLogs.sentAt));

  const decryptedLogs = await Promise.all(
    allLogs.map(async (emailLog) => {
      return {
        ...emailLog,
        to: await decrypt(emailLog.to, secretKey),
      };
    })
  );

  return c.json({ success: true, data: decryptedLogs });
});

export default app;