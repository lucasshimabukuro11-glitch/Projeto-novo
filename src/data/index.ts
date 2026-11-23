import { demoData } from './demo'
import { realData } from './supabase'

export const data = realData ?? demoData

const messageMap: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
  'User already registered': 'Já existe uma conta com esse e-mail.',
  'New password should be different from the old password.': 'Escolha uma senha diferente da atual.',
  'Invalid API key': 'A chave pública do Supabase não foi aceita. Confira a configuração do EventScan.',
}

export function errorMessage(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed|unable to connect/i.test(message)) {
    return 'Não foi possível conectar ao Supabase. Confira a conexão e tente novamente.'
  }
  return messageMap[message] ?? (message || 'Algo deu errado. Tente novamente.')
}
