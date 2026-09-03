import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'tests/design-rules.test.mjs',
      'tests/**/*.spec.ts',
      'tests/**/*.spec.tsx'
    ],
    exclude: ['tests/e2e/**'],
    setupFiles: ['./tests/setup.ts']
  }
})
