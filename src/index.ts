/// <reference types="@cloudflare/workers-types" /> // Provides Cloudflare-specific types (like D1Database) to TypeScript

import { Hono } from 'hono'
import * as nodemailer from 'nodemailer'
import { PrismaD1 } from '@prisma/adapter-d1'
import { PrismaClient } from '@prisma/client'

// Defines the shape of Cloudflare environment variables and bindings available at runtime
type Bindings = {
  SMTP_USER: string
  SMTP_PASSWORD: string
  makisend_db: D1Database 
  SENDER_EMAIL: string
  HOST: string
  PORT: number
}

const app = new Hono<{ Bindings: Bindings }>()

// --- ROUTE 1: Send Email & Save to DB ---
app.post('/send-email', async (c) => {
  // Initialize Prisma using the D1 adapter to connect to Cloudflare's serverless database
  const adapter = new PrismaD1(c.env.makisend_db)
  const prisma = new PrismaClient({ adapter })

  // Configure the SMTP transporter using environment variables for security
  const transporter = nodemailer.createTransport({
    host: c.env.HOST,
    port: c.env.PORT,
    secure: false, // Uses STARTTLS
    auth: {
      user: c.env.SMTP_USER,
      pass: c.env.SMTP_PASSWORD,
    },
  } as any) // 'as any' bypasses strict TS checks for nodemailer's Cloudflare compatibility

  try {
    const { to, subject, text, html } = await c.req.json()

    const mailOptions = {
      from: c.env.SENDER_EMAIL,
      to: to,
      subject: subject,
      text: text,
      html: html,
    }

    // Attempt to send the email via SMTP
    const info = await transporter.sendMail(mailOptions)

    // Persist the successful email transaction to the D1 database
    await prisma.emailLog.create({
      data: {
        to: to,
        subject: subject,
        messageId: info.messageId,
      }
    })

    return c.json({ 
      success: true, 
      message: "Email successfully sent and logged to D1!",
      messageId: info.messageId 
    })
  } catch (err: any) {
    console.error("Error:", err)
    return c.json({ success: false, error: err.message }, 500)
  }
})

// --- ROUTE 2: Read the Database ---
app.get('/logs', async (c) => {
  // Re-initialize Prisma for this specific request context
  const adapter = new PrismaD1(c.env.makisend_db)
  const prisma = new PrismaClient({ adapter })
  
  // Fetch all email logs, ordered by most recent first
  const logs = await prisma.emailLog.findMany({
    orderBy: { sentAt: 'desc' }
  })
  
  return c.json({ success: true, data: logs })
})

export default app