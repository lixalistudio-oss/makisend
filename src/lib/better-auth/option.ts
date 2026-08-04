import { BetterAuthOptions } from 'better-auth';
import { apiKey } from "@better-auth/api-key"

export const betterAuthOptions: BetterAuthOptions = {
  appName: 'YOUR_APP_NAME',
  /**
   * Base path for Better Auth.
   * @default "/api/auth"
   */
  basePath: '/api',
   plugins: [
        apiKey() 
    ]

  // .... More options
};