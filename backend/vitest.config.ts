// vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';


export default defineConfig({
  plugins: [tsconfigPaths()], // Tells Vitest to resolve the @/ alias
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
