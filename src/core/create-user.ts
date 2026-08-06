// drizzle-orm/d1 used indirectly via createDatabase
import { user, apikey } from '@/db/schema';
import { createId } from "@paralleldrive/cuid2";
import { generateApiKey } from 'generate-api-key';
import { getPlatformProxy } from "wrangler";
import type { Bindings } from "@/index";
import { createDatabase } from "@/db/connection";
import { createConfig } from '@/config/config';
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
    const smtpHostName = await prompt(rl, 'SMTP Hostname (Login URL): ');
    const senderEmail = await prompt(rl, 'Sender Email (email used to send mails): ');
    
    rl.close();

    const fixedName = "Maki Admin";
    const now = new Date();

    const userId = createId();
    const fullKey = generateApiKey({
      method: 'uuidv4',
      prefix: 'mk',
    }) as unknown as string;
    const uniqueEmail = `admin_${createId()}@makisend.local`


    // Encrypt all sensitive values in parallel
    const config = createConfig(env);
    const db = createDatabase(config.db);
    const aesKey = config.aesKey

    // Encrypt all sensitive values in parallel
    const [
    encryptedUniqueEmail,
    encryptedSmtpUsername,
    encryptedSmtpPassword,
    encryptedSmtpHostName,
    encryptedSenderEmail,
] = await Promise.all([
    encrypt(uniqueEmail,aesKey),
    encrypt(smtpUsername, aesKey),
    encrypt(smtpPassword, aesKey),
    encrypt(smtpHostName, aesKey),
    encrypt(senderEmail, aesKey),
]);

    console.log('\n Provisioning system admin user and generating API key...\n');
    // 1. Create the Better Auth User
    await db.insert(user).values({
      id: userId,
      name: fixedName,
      email: encryptedUniqueEmail,
      smtpUsername : encryptedSmtpUsername,
      smtpPassword : encryptedSmtpPassword,
      smtpHostName : encryptedSmtpHostName,
      senderEmail : encryptedSenderEmail, 
      emailVerified: true,
    });

    // 2. Create the API Key mapping
    await db.insert(apikey).values({
      referenceId: userId,
      key: fullKey,
      name: "Admin Default Key",
      remaining: 10,
      createdAt: now,
      updatedAt: now,
    });

    console.log('Account successfully provisioned!\n');
    console.log(`User ID:       ${userId}`);
    console.log(`Email:         ${uniqueEmail}`);
    console.log(`API Key:       ${fullKey}`);
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