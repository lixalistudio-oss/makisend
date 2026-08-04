import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1"; // Or your preferred driver
import { Config } from "@/config/config";

export const getAuth = (config: Config) => {
  const db = drizzle(config.db);

  return betterAuth({
    database: drizzleAdapter(db, { 
      provider: "sqlite", 
    }),
    secret: config.better_auth_secret,
    baseURL: config.better_auth_url,
   
  });
};
