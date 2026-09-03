import { defineConfig, devices } from '@playwright/test'
import { execFileSync } from 'node:child_process'

if (process.env.E2E_DISPOSABLE_LOCAL_SUPABASE !== '1') {
  throw new Error(
    'E2E_DISPOSABLE_LOCAL_SUPABASE=1 is required because restore tests replace database data.'
  )
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const bunExecutable = process.env.npm_execpath
  if (!bunExecutable) {
    throw new Error('Cannot locate Bun to read the local Supabase environment.')
  }

  const localEnvironment = Object.fromEntries(
    execFileSync(
      bunExecutable,
      ['x', 'supabase', 'status', '-o', 'env'],
      { encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))]
      })
  )

  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: localEnvironment.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:
      localEnvironment.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: localEnvironment.SERVICE_ROLE_KEY,
    SUPABASE_DB_URL: localEnvironment.DB_URL,
    NEXT_PUBLIC_DISABLE_SSO: 'true',
    APP_URL: 'http://localhost:3000'
  })
}

if (!process.env.CI) {
  execFileSync(
    process.execPath,
    ['./node_modules/next/dist/bin/next', 'build'],
    { env: process.env, stdio: 'inherit' }
  )
}

const PORT = process.env.PORT || '3000'
const BASE_URL =
  process.env.PLAYWRIGHT_TEST_BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tmp/playwright-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    locale: 'vi-VN'
  },
  projects: [
    {
      name: '375x667',
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 }
      }
    },
    {
      name: '430x932',
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 430, height: 932 }
      }
    },
    {
      name: '768x1024',
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 }
      }
    },
    {
      name: '1024x768',
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 768 }
      }
    },
    {
      name: '1440x900',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 }
      }
    }
  ],
  webServer: {
    command: `${JSON.stringify(process.execPath)} ./node_modules/next/dist/bin/next start --port ${PORT}`,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    ),
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
})
