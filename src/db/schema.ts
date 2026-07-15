// src/db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const emailLogs = sqliteTable("email_log", {
  internalId: text('internalId').primaryKey().$defaultFn(() => crypto.randomUUID()),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  smtpId: text("smtp_id").notNull(),
  sentAt: text("sent_at").notNull()
});

export const logs = sqliteTable("logs",{
  id : text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  endpoint : text("endpoint").notNull(),
  message : text("message").notNull(),
  message_details : text("details").notNull(),
  sentAt: text("sent_at").notNull(), 
});