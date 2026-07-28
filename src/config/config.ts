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
}

export function createConfig(env: Bindings): Config {
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
  };
}
