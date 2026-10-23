import { user, smtpConfig, apikey } from '@/db/schema';
import { createId } from "@paralleldrive/cuid2";
import { getPlatformProxy } from "wrangler";
import type { Bindings } from "@/index";
import { createDatabase } from "@/db/connection";
import { createConfig } from '@/config/config';
import { createAuth } from '@/lib/auth';
import * as readline from 'node:readline/promises';
import { encrypt } from './crypto';
import { eq, desc } from 'drizzle-orm';

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  const answer = await rl.question(question);
  if (!answer.trim()) {//
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

  try {
    // Prompt for SMTP attributes (no name needed)
    console.log('\n SMTP Configuration Required\n');

    const smtpUsername = await prompt(rl, 'SMTP Username: ');
    const smtpPassword = await prompt(rl, 'SMTP Password: ');
    const smtpHostName = await prompt(rl, 'SMTP Hostname (e.g. smtp.gmail.com): ');
    const senderEmail = await prompt(rl, 'Sender Email: ');

    rl.close();

    const config = createConfig(env);
    const db = createDatabase(config.db);
    const aesKey = config.aesKey;

    // Create user
    const userId = createId();
    const uniqueEmail = `admin_${createId()}@makisend.local`;
    const encryptedEmail = await encrypt(uniqueEmail, aesKey);

    await db.insert(user).values({
      id: userId,
      email: encryptedEmail,
      emailVerified: true,
    });

    // Create SMTP config
    const smtpConfigId = createId();
    const [
      encryptedSmtpUsername,
      encryptedSmtpPassword,
      encryptedSmtpHostName,
      encryptedSenderEmail,
    ] = await Promise.all([
      encrypt(smtpUsername, aesKey),
      encrypt(smtpPassword, aesKey),
      encrypt(smtpHostName, aesKey),
      encrypt(senderEmail, aesKey),
    ]);

    await db.insert(smtpConfig).values({
      id: smtpConfigId,
      userId: userId,
      smtpUsername: encryptedSmtpUsername,
      smtpPassword: encryptedSmtpPassword,
      smtpHostname: encryptedSmtpHostName,
      senderEmail: encryptedSenderEmail,
    });

    // Create API Key via Better Auth (linked to SMTP config)
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

    // Link API key to SMTP config
    // Find the most recently created key for this user
    const latestKey = await db
      .select({ id: apikey.id })
      .from(apikey)
      .where(eq(apikey.referenceId, userId))
      .orderBy(desc(apikey.createdAt))
      .limit(1);

    if (!latestKey[0]) {
      throw new Error("Failed to find created API key");
    }

    await db
      .update(apikey)
      .set({ smtpConfigId: smtpConfigId })
      .where(eq(apikey.id, latestKey[0].id));

    console.log('Account successfully provisioned!\n');
    console.log(`User ID:          ${userId}`);
    console.log(`Email:            ${uniqueEmail}`);
    console.log(`API Key:          ${result.key}`);
    console.log(`SMTP Config ID:   ${smtpConfigId}`);
    console.log(`SMTP Username:    ${smtpUsername}`);
    console.log(`SMTP Hostname:    ${smtpHostName}`);
    console.log(`Sender Email:     ${senderEmail}`);
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
