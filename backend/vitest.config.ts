// vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


export default defineConfig({
  plugins: [tsconfigPaths()], // Tells Vitest to resolve the @/ alias
  resolve: {
    alias: {
      // workerd built-in that does not exist under Node; tests only need a
      // WorkflowEntrypoint base class to extend (see test/mocks/).
      'cloudflare:workers': resolve(
        dirname(fileURLToPath(import.meta.url)),
        'test/mocks/cloudflare-workers.ts',
      ),
    },
  },
  test: {
    // Enables global test functions like describe, it, expect without importing them
    globals: true, 
    
    // Sets the runtime environment (Node.js is standard for backend/Hono apps)
    environment: 'node', 
    
    // Executes this file before running any tests (ideal for resetting mocks)
    setupFiles: ['./test/setup.ts'], 
    
    // Tells Vitest where to look for your test files
    include: ['test/**/*.{test,spec}.ts'], 
  },
});
