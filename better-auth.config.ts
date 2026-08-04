import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import { apiKey } from "@better-auth/api-key"
import { Config } from "@/config/config";

// 2. Factory function for your Request Handlers
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

//Static export explicitly for the Better Auth CLI / Build scripts
export const auth = betterAuth({
  database: drizzleAdapter({} as any, { 
    provider: "sqlite", 
  }),
  secret: "cli-dummy-secret-placeholder",
  baseURL: "http://localhost:8787",
  plugins: [
        apiKey() 
    ]
});
