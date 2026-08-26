// drizzle-orm/d1 used indirectly via createDatabase
import { user } from '@/db/schema';
import { createId } from "@paralleldrive/cuid2";
import { getPlatformProxy } from "wrangler";
import type { Bindings } from "@/index";
import { createDatabase } from "@/db/connection";
import { createConfig } from '@/config/config';
import { createAuth } from '@/lib/auth';
import * as readline from 'node:readline/promises';
import { encrypt } from './crypto';

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  const answer = await rl.question(question);
  if (!answer.trim()) {
    throw new Error(`"${question}" cannot be empty`);
  }
  return answer.trim();
}

async function main() {
  const { env, dispose } = await getPlatformProxy<Bindings>();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

    console.log('\n SMTP Configuration Required\n');

  try {
    // Prompt for SMTP attributes
    const smtpUsername = await prompt(rl, 'SMTP Username: ');
    const smtpPassword = await prompt(rl, 'SMTP Password: ');
    const smtpHostName = await prompt(rl, 'SMTP Hostname (e.g. smtp.gmail.com): ');
    const senderEmail = await prompt(rl, 'Sender Email: ');
    
    rl.close();

    const userId = createId();
    const uniqueEmail = `admin_${createId()}@makisend.local`;

    // Encrypt all sensitive values in parallel
    const config = createConfig(env);
    const db = createDatabase(config.db);
    const aesKey = config.aesKey;

    const [
      encryptedUniqueEmail,
      encryptedSmtpUsername,
      encryptedSmtpPassword,
      encryptedSmtpHostName,
      encryptedSenderEmail,
    ] = await Promise.all([
      encrypt(uniqueEmail, aesKey),
      encrypt(smtpUsername, aesKey),
      encrypt(smtpPassword, aesKey),
      encrypt(smtpHostName, aesKey),
      encrypt(senderEmail, aesKey),
    ]);

    console.log('\n Provisioning system admin user and generating API key...\n');

    // 1. Create the user record
    await db.insert(user).values({
      id: userId,
      name: "Maki Admin",
      email: encryptedUniqueEmail,
      smtpUsername: encryptedSmtpUsername,
      smtpPassword: encryptedSmtpPassword,
      smtpHostName: encryptedSmtpHostName,
      senderEmail: encryptedSenderEmail,
      emailVerified: true,
    });

    // 2. Create API Key via Better Auth (properly hashed)
    const auth = createAuth(env);
    const result = await auth.api.createApiKey({
      body: {
        userId: userId,
        name: "Admin Default Key",
        prefix: "mk_",
        remaining: 10,
      },
    });

    if (!result.key) {
      throw new Error("Failed to create API key");
    }

    console.log('Account successfully provisioned!\n');
    console.log(`User ID:       ${userId}`);
    console.log(`Email:         ${uniqueEmail}`);
    console.log(`API Key:       ${result.key}`);
    console.log(`SMTP Username:     ${smtpUsername}`);
    console.log(`SMTP Password:     ${smtpPassword}`);
    console.log(`SMTP HOSTNAME:  ${smtpHostName}`);
    console.log(`Sender Email:  ${senderEmail}`);
    console.log('\n Save the API key — it cannot be retrieved later.\n');

  } catch (error) {
    rl.close();
    console.log('Script execution failed:', error);
    process.exit(1);
  } finally {
    await dispose();
  }
}

main();
