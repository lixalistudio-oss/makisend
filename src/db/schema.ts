// src/db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";

export const emailLogs = sqliteTable("email_logs", {
  internalId: text('internalId').primaryKey().$defaultFn(() => createId()),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  smtpId: text("smtp_id").notNull(),
  sentAt: text("sent_at").notNull(), 
  emailProcessingTimeMs: integer('email_processing_time'),
});

// export const logs = sqliteTable("logs",{
//   id : text('id').primaryKey().$defaultFn(() => createId()),
//   endpoint : text("endpoint").notNull(),
//   message : text("message").notNull(),
//   message_details : text("message_details").notNull(),
//   sentAt: text("sent_at").notNull(), 
// });

