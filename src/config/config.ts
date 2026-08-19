import { AppError } from "@/core/errors";
import type { Bindings } from "@/index";

export interface SmtpConfig {
  smtpHostName: string;
  senderEmail: string;
  smtpUsername: string;
  smtpPassword: string;
}
export interface UserConfig
{
  userId : string
}
export interface Config {
  // smtp: SmtpConfig;
  port: number;
  aesKey: string;
  db: D1Database;
  inngestConfig : number;
  betterAuthSecret : string;
  betterAuthUrl : string
}


export function createConfig(env: Bindings): Config {
  if (!env.AES_256_KEY) {
    throw new AppError(500, "AES_256_KEY environment variable is required");
  }

  if (!env.makisend_db) {
    throw new AppError(500, "makisend_db environment variable is required");
  }

  return {
    // smtp: {
    //   host: env.HOST,
    
    //   user: env.SMTP_USER,
    //   password: env.SMTP_PASSWORD,
    // },
    port: env.PORT,
  
    aesKey: env.AES_256_KEY,

    
    db: env.makisend_db,
    inngestConfig : env.INNGEST_DEV,
    betterAuthSecret : env.BETTER_AUTH_SECRET,
    betterAuthUrl : env.BETTER_AUTH_URL
  };
}
