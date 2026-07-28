import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

export const emailLogs = sqliteTable("email_logs", {
  internalId: text("internalId").primaryKey().$defaultFn(() => createId()),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  smtpId: text("smtp_id").notNull(),
  sentAt: text("sent_at").notNull(),
  emailProcessingTimeMs: integer("email_processing_time"),
});

