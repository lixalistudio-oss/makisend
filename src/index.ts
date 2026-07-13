/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import * as nodemailer from 'nodemailer'
import { PrismaD1 } from '@prisma/adapter-d1'
import { PrismaClient } from '@prisma/client'

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
let prisma: PrismaClient | null = null

const getPrisma = (db: D1Database) => {
  if (!prisma) {
    const adapter = new PrismaD1(db)
    prisma = new PrismaClient({ adapter })
  }
  return prisma
}

// --- ROUTE: Send Email & Log Transaction ---
app.post('/send-email', async (c) => {
  const db = getPrisma(c.env.makisend_db)

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

    // Log the successful operation in the unified audit table
    await db.logs.create({
      data: {
        endpoint: '/send-email',
        message: 'Email sent successfully',
        details: JSON.stringify({ to, messageId: info.messageId }),
      }
    })

    // Log the specific email details in the dedicated table
    await db.emailLog.create({
      data: {
        to,
        subject,
        messageId: info.messageId,
      }
    })

    return c.json({ 
      success: true, 
      message: 'Email successfully sent and logged to D1',
      messageId: info.messageId 
    })

  } catch (err: any) {
    console.error('Error during email process:', err)
    
    // Attempt to log the failure in the unified audit table
    try {
      await db.logs.create({
        data: {
          endpoint: '/send-email',
          message: err.message || 'Unknown error occurred',
          details: err.stack || JSON.stringify(err),
        }
      })
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
  const db = getPrisma(c.env.makisend_db)
  
  const allLogs = await db.logs.findMany({
    orderBy: { timestamp: 'desc' }
  })
  
  return c.json({ success: true, data: allLogs })
})

// --- ROUTE: Read Specific Email Logs ---
app.get('/email-logs', async (c) => {
  const db = getPrisma(c.env.makisend_db)
  
  const emailLogs = await db.emailLog.findMany({
    orderBy: { sentAt: 'desc' }
  })
  
  return c.json({ success: true, data: emailLogs })
})

export default app