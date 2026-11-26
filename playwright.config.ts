import { defineConfig, devices } from '@playwright/test'

const publicKey = process.env.EVENTPASS_TEST_PUBLIC_KEY
const apiUrl = process.env.EVENTPASS_TEST_API_URL ?? 'http://127.0.0.1:54321'
const demoUrl = 'http://localhost:4173'
const connectedUrl = 'http://localhost:4174'
const servers = [{
  command: 'npm run dev -- --host localhost --port 4173 --strictPort',
  url: demoUrl,
  env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  reuseExistingServer: false,
}]

if (publicKey) {
  const databaseUrl = process.env.EVENTPASS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const mailpitUrl = process.env.EVENTPASS_TEST_MAILPIT_URL ?? 'http://127.0.0.1:54324'
  if (![apiUrl, databaseUrl, mailpitUrl].every(url => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))) {
    throw new Error('Use uma instância local e descartável do Supabase para os testes de navegador.')
  }
  servers.push({
    command: 'npm run dev -- --host localhost --port 4174 --strictPort',
    url: connectedUrl,
    env: { VITE_SUPABASE_URL: apiUrl, VITE_SUPABASE_PUBLISHABLE_KEY: publicKey },
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
