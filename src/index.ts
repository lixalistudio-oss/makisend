/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import * as nodemailer from 'nodemailer'
import { drizzle } from "drizzle-orm/d1"; // <-- The D1 specific driver
import { desc } from "drizzle-orm";
import { emailLogs} from "./db/schema";
import {Logs} from "./db/schema";


type Bindings = {
  SMTP_USER: string
  SMTP_PASSWORD: string
  makisend_db: D1Database 
  SENDER_EMAIL: string
  HOST: string
  PORT: number
}

const app = new Hono<{ Bindings: Bindings }>()

// Singleton pattern to reuse the Prisma instance across requests and avoid connection overhead
let drizzle_client: ReturnType <typeof drizzle> | null = null // Connection pooling used to avoid undefined values for db_client at software startup 
 
const getDrizzle = (db: D1Database) => {
  if (!drizzle_client) {
    drizzle_client = drizzle(db)
  }
  return drizzle_client
}

// --- ROUTE: Send Email & Log Transaction ---
app.post('/send-email', async (c) => {
  const db = getDrizzle(c.env.makisend_db)

  const transporter = nodemailer.createTransport({
    host: c.env.HOST,
    port: c.env.PORT,
    secure: false,
    auth: {
      user: c.env.SMTP_USER,
      pass: c.env.SMTP_PASSWORD,
    },
  } as any)

  try {
    const { to, subject, text, html } = await c.req.json()

    const mailOptions = {
      from: c.env.SENDER_EMAIL,
      to,
      subject,
      text,
      html,
    }

    const info = await transporter.sendMail(mailOptions)
     
     const log: typeof Logs.$inferInsert = {
      endpoint : "/send-email",
      message : "Email sent successfully" ,
      message_details : JSON.stringify({ to, messageId: info.messageId }),
      sentAt: new Date().toISOString()
  };
     await db.insert(Logs).values(log);

     const emailLog : typeof emailLogs.$inferInsert = 
     {
      to,
      subject,
      messageId: info.messageId,
      sentAt: new Date().toISOString()
     }
     await db.insert(emailLogs).values(emailLog);

    return c.json({ 
      success: true, 
      message: 'Email successfully sent and logged to D1',
      messageId: info.messageId 
    })

  } catch (err: any) {
    console.error('Error during email process:', err)
    
    
    // Attempt to log the failure in the unified audit table
    try {
     const log: typeof Logs.$inferInsert = {
      endpoint : "/send-email",
      message : err.message || 'Unknown error occurred',
      message_details : err.stack || JSON.stringify(err),
      sentAt: new Date().toISOString()
  };
     await db.insert(Logs).values(log);
    } catch (dbErr) {
      console.error('CRITICAL: Failed to log error to D1:', dbErr)
    }

    return c.json({ 
      success: false, 
      error: 'Failed to send email. The issue has been logged for review.' 
    }, 500)
  }
})

// --- ROUTE: Read Unified Logs (Successes and Errors) ---
app.get('/logs', async (c) => {
  const db = getDrizzle(c.env.makisend_db)
  
  const allLogs = await db.select().from(Logs).orderBy(desc(Logs.sentAt));
  
  return c.json({ success: true, data: allLogs })
})

// --- ROUTE: Read Specific Email Logs ---
app.get('/email-logs', async (c) => {
  const db = getDrizzle(c.env.makisend_db)
  
  const allLogs = await db.select().from(emailLogs).orderBy(desc(emailLogs.sentAt));
  
  return c.json({ success: true, data: emailLogs })
})

export default app