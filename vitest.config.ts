import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The env-gated RLS/security integration suite lives under tests/rls/ with a
    // *.rls-test.ts suffix (which already does NOT match *.test.ts). This explicit
    // exclude is belt-and-suspenders so the default `npm run test` NEVER runs it —
    // use `npm run test:rls` (vitest.rls.config.ts) for that suite instead.
    exclude: ['tests/rls/**', '**/node_modules/**'],
  },
})
