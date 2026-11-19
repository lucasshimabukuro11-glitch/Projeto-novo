import type { CheckInStatus, EventRecord, Page, Ticket } from './types.ts'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo',
})
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
})

export const pageSize = 15
export const maxCoverSize = 5 * 1024 * 1024
export const coverTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
export const ticketCodePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const roleLabels = { participant: 'Participante', organizer: 'Organizador', admin: 'Administrador' } as const
export const eventStatusLabels = { draft: 'Rascunho', published: 'Publicado', cancelled: 'Cancelado' } as const

export const checkInMessages: Record<CheckInStatus, { title: string; detail: string }> = {
  valid: { title: 'Entrada autorizada', detail: 'O check-in foi registrado com sucesso.' },
  used: { title: 'Ingresso já utilizado', detail: 'Entrada negada. Já existe um check-in registrado para este ingresso.' },
  not_found: { title: 'Ingresso inexistente', detail: 'Entrada negada. Confira o código e tente novamente.' },
  cancelled: { title: 'Ingresso cancelado', detail: 'Entrada negada. O ingresso ou o evento foi cancelado.' },
  wrong_event: { title: 'Ingresso de outro evento', detail: 'Entrada negada. Confirme o evento selecionado.' },
  forbidden: { title: 'Acesso não autorizado', detail: 'Você não tem permissão para validar ingressos deste evento.' },
  wrong_sector: { title: 'Acesso negado — setor não autorizado', detail: 'Use a portaria do setor indicado no ingresso.' },
  gate_required: { title: 'Selecione uma portaria', detail: 'Este evento exige uma portaria autorizada.' },
  rate_limited: { title: 'Limite de validações atingido', detail: 'Aguarde até um minuto para continuar nesta conta.' },
  event_unavailable: { title: 'Evento indisponível', detail: 'O evento precisa estar publicado para aceitar check-ins.' },
}

export function randomUuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

export function eventDate(instant: string) {
  return dateFormatter.format(new Date(instant)).replaceAll('.', '')
}

export function eventTime(instant: string) {
  return timeFormatter.format(new Date(instant))
}

export function brasiliaInstant(localTime: string) {
  return new Date(`${localTime}:00-03:00`).toISOString()
}

export function searchText(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round(100 * numerator / denominator) : 0
}

export function isUpcoming(event: Pick<EventRecord, 'starts_at'>) {
  return Date.parse(event.starts_at) > Date.now()
}

export function ticketState(ticket: Pick<Ticket, 'checked_in_at' | 'cancelled_at'>, event: Pick<EventRecord, 'status'>) {
  if (ticket.cancelled_at || event.status === 'cancelled') return { label: 'Cancelado', tone: 'danger' } as const
  if (ticket.checked_in_at) return { label: 'Check-in realizado', tone: 'success' } as const
  return { label: 'Confirmado', tone: 'success' } as const
}

export function toPage<T>(rows: T[]): Page<T> {
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize }
}
