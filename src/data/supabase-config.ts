export type SupabaseConfig =
  | { mode: 'supabase'; url: string; key: string }
  | { mode: 'demo' }
  | { mode: 'invalid'; message: string }

function isPublicKey(value: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true
  const parts = value.split('.')
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return false

  try {
    const payload = parts[1].replaceAll('-', '+').replaceAll('_', '/')
    return JSON.parse(atob(payload)).role === 'anon'
  } catch {
    return false
  }
}

export function resolveSupabaseConfig(rawUrl: string, rawKey: string, development: boolean): SupabaseConfig {
  const url = rawUrl.trim()
  const key = rawKey.trim()
  if (!url && !key && development) return { mode: 'demo' }
  if (!url || !key) {
    return { mode: 'invalid', message: 'Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para conectar o EventScan.' }
  }

  try {
    const parsed = new URL(url)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if (parsed.username || parsed.password || parsed.search || parsed.hash ||
      !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local))) {
      throw new Error()
    }
  } catch {
    return { mode: 'invalid', message: 'Informe a URL HTTPS do projeto Supabase. O Supabase local pode usar HTTP em localhost.' }
  }

  if (!isPublicKey(key)) {
    return { mode: 'invalid', message: 'Configure uma chave pública publishable ou anon do Supabase.' }
  }
  return { mode: 'supabase', url, key }
}
