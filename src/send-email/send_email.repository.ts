import { emailLogs } from "../db/schema";
import { drizzle } from "drizzle-orm/d1";

// 1. REPOSITORY Blueprint Contract
export interface EmailRepository {
  saveEmailLog(
    to: string, 
    subject: string, 
    smtpId: string, 
    sentAt: string, 
    emailProcessingTimeMs: number
  ): Promise<void>;
}

// 2. ACTUAL D1 REPOSITORY WITH DRIZZLE
export class SendEmailRepository implements EmailRepository {
  // Use ReturnType helper utility to strictly type the Drizzle connection handle
  private dbDrizzle: ReturnType<typeof drizzle>;

  constructor(db: any) {
    // Turn Cloudflare's raw D1 adapter into a functional Drizzle instance at initialization
    this.dbDrizzle = drizzle(db);
  }
 
async saveEmailLog(
    to: string, 
    subject: string, 
    smtpId: string, 
    sentAt: string, 
    emailProcessingTimeMs: number
  ): Promise<void> {
    // Execute a direct Drizzle insert with shorthand ES6 object syntax
    await this.dbDrizzle.insert(emailLogs).values({
      to,
      subject,
      smtpId,
      sentAt,
      emailProcessingTimeMs
    });
  }
}
