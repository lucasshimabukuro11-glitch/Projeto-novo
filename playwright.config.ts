import { defineConfig, devices } from '@playwright/test'

const publicKey = process.env.EVENTPASS_TEST_PUBLIC_KEY
const demoUrl = 'http://localhost:4173'
const connectedUrl = 'http://localhost:4174'
const servers = [{
  command: 'npm run dev -- --host localhost --port 4173 --strictPort',
  url: demoUrl,
  env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  reuseExistingServer: false,
}]

if (publicKey) {
  servers.push({
    command: 'npm run dev -- --host localhost --port 4174 --strictPort',
    url: connectedUrl,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: publicKey },
    reuseExistingServer: false,
  })
}

export default defineConfig({
  testDir: './tests/browser',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath: process.env.EVENTPASS_TEST_CHROMIUM },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'demo', testMatch: ['eventpass.spec.ts','eventscan.spec.ts'], use: { baseURL: demoUrl } },
    ...(publicKey ? [{ name: 'supabase-local', testMatch: ['supabase.spec.ts', 'supabase-onboarding.spec.ts', 'privileged-accounts.spec.ts'], use: { baseURL: connectedUrl } }] : []),
  ],
  webServer: servers,
})
