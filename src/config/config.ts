import { AppError } from "@/core/errors";
import type { Bindings } from "@/index";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface Config {
  smtp: SmtpConfig;
  senderEmail: string;
  aesKey: string;
  apiKey: string;
  db: D1Database;
  better_auth_secret: string;
  better_auth_url: string;
}

export function createConfig(env: Bindings): Config {
  if (!env.AES_256_KEY) {
    throw new AppError(500, "AES_256_KEY environment variable is required");
  }

  if (!env.makisend_db) {
    throw new AppError(500, "makisend_db environment variable is required");
  }

  return {
    smtp: {
      host: env.HOST,
      port: env.PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
    },
    senderEmail: env.SENDER_EMAIL,
    aesKey: env.AES_256_KEY,
    apiKey: env.API_KEY,
    
    db: env.makisend_db,
    better_auth_secret: env.BETTER_AUTH_SECRET,
    better_auth_url: env.BETTER_AUTH_URL

  };
}
