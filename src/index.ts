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
// Variable globale qui stockera l'instance unique de Prisma
let prisma: PrismaClient | null = null

// Fonction qui retourne l'instance existante, ou la crée si c'est la première requête
const getPrisma = (db: D1Database) => {
  if (!prisma) {
    const adapter = new PrismaD1(db)
    prisma = new PrismaClient({ adapter })
  }
  return prisma
}

// --- ROUTE 1: Send Email & Save to DB ---
app.post('/send-email', async (c) => {
  // Réutilise l'instance unique de Prisma
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

    const info = await transporter.sendMail(mailOptions)

    // Sauvegarde dans la DB via l'instance unique
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
    console.error("Error:", err)
    return c.json({ success: false, error: err.message }, 500)
  }
})

// --- ROUTE 2: Read the Database ---
app.get('/logs', async (c) => {
  // Réutilise la même instance unique de Prisma
  const db = getPrisma(c.env.makisend_db)
  
  const logs = await db.emailLog.findMany({
    orderBy: { sentAt: 'desc' }
  })
  
  return c.json({ success: true, data: logs })
})

export default app