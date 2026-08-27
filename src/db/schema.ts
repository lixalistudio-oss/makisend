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

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  emailVerified: integer("email_verified", { mode: "boolean" }),
  image: text("image"),
  createdAt: integer("created_at"),
  updatedAt: integer("updated_at"),
  smtpUsername: text("smtp_username"),
  smtpPassword: text("smtp_password"),
  smtpHostName: text("smtp_host_name"),
  senderEmail: text("sender_email"),
});
