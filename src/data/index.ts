import { demoData } from './demo'
import { realData } from './supabase'

export const data = realData ?? demoData

const messageMap: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
  'User already registered': 'Já existe uma conta com esse e-mail.',
  'Failed to fetch': 'Não foi possível conectar. Confira a conexão e tente novamente.',
}

export function errorMessage(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  return messageMap[message] ?? (message || 'Algo deu errado. Tente novamente.')
}
