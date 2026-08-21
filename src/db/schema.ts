import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

export const emailLogs = sqliteTable("email_logs", {
  internalId: text("internalId").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  smtpId: text("smtp_id").notNull(),
  sentAt: text("sent_at").notNull(),
  emailProcessingTimeMs: integer("email_processing_time"),
});

export const emailHistories = sqliteTable("email_histories", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  emailId: text("email_id").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});
