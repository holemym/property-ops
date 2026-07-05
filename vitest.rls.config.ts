import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Dedicated config for the ENV-GATED RLS / security integration suite.
// These are heavy integration tests that hit a live, DISPOSABLE Supabase project
// (see .env.rls.example). They are DELIBERATELY excluded from the default
// `npm run test` (see vitest.config.ts `exclude`) and only run via
// `npm run test:rls`. With no RLS_TEST_* creds present every suite skips cleanly.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/rls/**/*.rls-test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
