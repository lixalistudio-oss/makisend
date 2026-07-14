import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';


export default defineConfig({
  dialect: 'sqlite',          // Required for modern Drizzle Kit targeting D1
  schema: './src/db/schema.ts',
  out: './drizzle',           // Drizzle compiles your migration steps here
});