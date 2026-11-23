import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveSupabaseConfig } from './src/data/supabase-config.ts'

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_SUPABASE_')
  const supabaseConfig = resolveSupabaseConfig(
    env.VITE_SUPABASE_URL ?? '',
    env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
    command === 'serve' && !isPreview,
  )
  return {
    plugins: [react(), tailwindcss()],
    // Include only the result of validation in the browser bundle.
    envPrefix: [],
    define: { __EVENTSCAN_SUPABASE_CONFIG__: JSON.stringify(supabaseConfig) },
  }
})
