// src/db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const emailLogs = sqliteTable("email_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  messageId: text("message_id").notNull(),
  // D1 uses SQLite, so we store timestamps as integers. 
  // Drizzle will automatically convert this to a JS Date object.
   sentAt: text("sent_at").notNull()
});

export const logs = sqliteTable("logs",{
  id : integer("id").primaryKey({autoIncrement: true}),
  endpoint : text("endpoint").notNull(),
  message : text("message").notNull(),
  message_details : text("details"),
  sentAt: text("sent_at").notNull(), 
});