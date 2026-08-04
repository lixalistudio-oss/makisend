import { drizzle } from 'drizzle-orm/d1';
import { user,apikey } from '@/db/schema';
import { createId } from "@paralleldrive/cuid2";  // Adjust path to your createId function
import { generateApiKey } from 'generate-api-key'; 
import type { Config } from "@/config/config";
import { getPlatformProxy } from "wrangler";
import type { Bindings } from "@/index";
import { createDatabase } from "@/db/connection";
import { createConfig } from '@/config/config';


async function main() {
  const { env, dispose } = await getPlatformProxy<Bindings>();

  
  const fixedName = "Maki Admin";
  const now = new Date();
  
  // Generate required unique values using your functions
  const userId = createId();
  const fullKey = generateApiKey({
  method: 'uuidv5',
  name: 'production app',
  namespace: '0f3819f3-b417-4c4c-b674-853473800265',
  prefix: 'mk'
}) as unknown as string
  const uniqueEmail = `admin_${createId()}@makisend.local`;

  // Extract metadata attributes from the key structure
  const prefix = "mk";
  

  console.log('⏳ Provisioning system admin user and generating API key...');

  try {
    const config = createConfig(env);
    const db = createDatabase(config.db);
   
      // 1. Create the Better Auth User
      await db.insert(user).values({
        id: userId,
        name: fixedName,
        email: uniqueEmail,
        emailVerified: true,
      });

      // 2. Create the API Key mapping using your generated values
      await db.insert(apikey).values({
        referenceId: userId,
        key: fullKey,
        name: "Admin Default Key",
        remaining: 10, 
        createdAt: now, 
        updatedAt: now,
      });

      console.log('✅ Account successfully provisioned!');
      console.log(`👤 User ID:   ${userId}`);
      console.log(`📧 Email:     ${uniqueEmail}`);
      console.log(`🔑 API Key:   ${fullKey}`);

  } catch (error) {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  }
}

main();
