/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono';
import * as nodemailer from 'nodemailer';
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { emailLogs, logs } from "./db/schema";
import { encrypt, decrypt } from '../crypto';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod'; // Ensure z is imported
import { EmailSchema } from '../email_schema';
import sanitizeHtml from 'sanitize-html';


type Bindings = { // Used to initialize the env variables with their types
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
let drizzleClient: ReturnType<typeof drizzle> | null = null;// On start up can either be typeof drizzle or null depending on the if the drizzle instance is called

const getDrizzle = (db: D1Database) => {
  if (!drizzleClient) {
    drizzleClient = drizzle(db);
    }
  return drizzleClient;
};

// --- ROUTE: Send Email & Log Transaction ---
app.post('/send-email',  zValidator('json', EmailSchema, (result, c) => {
    if (!result.success) {
      const errors = z.flattenError(result.error); 
      return c.json({
        error: 'Validation échouée',
        details: {
          fieldErrors: errors.fieldErrors, // Errors on specific fields
          formErrors: errors.formErrors     // Errors on the whole object
        }
      }, 400); // <-- HTTP 400 Bad Request
    }
  }), async (c) => {
  const startTime = performance.now(); //  1. Démarrage du chronomètre ici
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
     // CRITICAL: Force IPv4 to bypass the local workerd network warning
    family: 4,
    tls: {
      rejectUnauthorized: true // Prevents Man-in-the-Middle attacks
    }
  } as any);

  try {
    const { to, subject, text, html } = await c.req.json();
    
    
    //Set the different allowed email tags for the email sending
      const allowedEmailTags = [
  // Typography & Headings
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "pre", "code",
  
  // Layout & Container Elements
  "div", "address", "blockquote",
  
  // Table Elements (Crucial for Email Layouts)
  "table", "tbody", "thead", "tfoot", "tr", "td", "th", "col", "colgroup", "caption",
  
  // Links
  "a",
  
  // Lists
  "ul", "ol", "li", "dl", "dt", "dd",
  
  // Inline Formatting & Semantic Emphasis
  "span", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", 
  "abbr", "cite", "data", "dfn", "kbd", "mark", "q", "samp", "time", "var",

  // Semantic Modern Structural Elements (Supported by modern webmail, falls back gracefully to div-like behavior in Outlook)
  "article", "aside", "footer", "header", "main", "section"
  ];
    const cleanHtml = sanitizeHtml(html, {
  allowedTags: allowedEmailTags ,
  allowedAttributes: {
    'a': [ 'href' ]
  },
  allowedIframeHostnames: ['www.youtube.com']
});//Sanitize and purify the dirty html from the request
  

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
      html : cleanHtml,
    });
    const durationMs = Math.round(performance.now() - startTime);

    // 3. Update log with success details and SMTP receipt
    await db.update(logs)
      .set({
        message: "Email sent successfully",
        message_details: JSON.stringify({ 
          to: encryptedTo, 
          messageId: info.messageId 
        }),
        sentAt: new Date().toISOString(),
        emailProcessingTimeMs: durationMs // <-- Stockage de la durée ici
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
        message_details: JSON.stringify({ error: err.message, stack: err.stack }),//used this way because the decrypt function in crypto.ts expects a json string
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
      
    
       const  parsedDetails = JSON.parse(log.message_details);
        
        // FIX: parsedDetails.to is a STRING containing JSON, not an object.
        // We check if it's a string that starts with '{' (our encrypted format)
        if (typeof parsedDetails.to === 'string' && parsedDetails.to.startsWith('{')) {
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