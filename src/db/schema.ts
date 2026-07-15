// src/db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";


// Create a read-only object mapping
export const EmailStatus = {
  Pending: 'pending',
  Sent: 'sent',
  Failed: 'failed',
} as const;

// // Create a type out of that object ('pending' | 'sent' | 'failed')
 export type EmailStatusType = typeof EmailStatus[keyof typeof EmailStatus];

// export const emailLogs = sqliteTable("email_log", {
//   id: integer("id").primaryKey({ autoIncrement: true }),
//   to: text("to").notNull(),
//   subject: text("subject").notNull(),
//   messageId: text("message_id").notNull(),
//   sentAt: text("sent_at").notNull()
// });

export const logs = sqliteTable("logs",{
  //id : integer("id").primaryKey({autoIncrement: true}),
  id: text('id').primaryKey(),
  smtpMessageId : text("smpt_message_id"),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  logMessage : text("log_message").notNull(),
  sentAt: text("sent_at").notNull(), 
  status: text('status').$type<EmailStatusType>().default(EmailStatus.Pending),
});