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

// --- SINGLETON PRISMA ---
let prisma: PrismaClient | null = null

const getPrisma = (db: D1Database) => {
  if (!prisma) {
    const adapter = new PrismaD1(db)
    prisma = new PrismaClient({ adapter })
  }
  return prisma
}

// --- ROUTE 1: Send Email & Save to DB ---
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
      to: to,
      subject: subject,
      text: text,
      html: html,
    }

    // 1. Tenter d'envoyer l'email
    const info = await transporter.sendMail(mailOptions)

    // 2. Sauvegarder le succès dans la DB
    await db.emailLog.create({
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
    console.error("Error during email process:", err)
    
    // 3. TENTER DE LOGGER L'ERREUR DANS D1 (Observabilité)
    try {
      await db.errorLog.create({
        data: {
          endpoint: '/send-email',
          errorMessage: err.message || 'Unknown error occurred',
          errorDetails: err.stack || JSON.stringify(err),
        }
      })
      console.log("Error successfully logged to D1.")
    } catch (dbErr) {
      // Si la DB est aussi en panne, on le logue juste en console pour éviter un crash en cascade
      console.error("CRITICAL: Failed to log error to D1:", dbErr)
    }

    // 4. Retourner une réponse propre au client
    return c.json({ 
      success: false, 
      error: "Failed to send email. The issue has been logged for review." 
    }, 500)
  }
})

// --- ROUTE 2: Read the Database (Email Logs) ---
app.get('/logs', async (c) => {
  const db = getPrisma(c.env.makisend_db)
  
  const logs = await db.emailLog.findMany({
    orderBy: { sentAt: 'desc' }
  })
  
  return c.json({ success: true, data: logs })
})

// --- ROUTE 3: Read Error Logs (Pour le superviseur/debug) ---
app.get('/errors', async (c) => {
  const db = getPrisma(c.env.makisend_db)
  
  const errors = await db.errorLog.findMany({
    orderBy: { timestamp: 'desc' }
  })
  
  return c.json({ success: true, data: errors })
})

export default app