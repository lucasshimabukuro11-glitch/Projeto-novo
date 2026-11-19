import type { Admission, AuditFilters, Eligibility, SecurityLimits, SeatKind } from './types.ts'

export const defaultLimits: SecurityLimits = { reuse: 3, invalid_streak: 5, wrong_sector: 4, staff_rate: 90, max_per_minute: 240 }
export const emptyAuditFilters: AuditFilters = { event: null, gate: null, result: null, from: null, until: null }

export const seatKindLabels: Record<SeatKind, string> = {
  standard: 'Disponível', accessible: 'Acessível', blocked: 'Indisponível', aisle: 'Corredor',
}

export const alertLabels = {
  reuse: 'Tentativas repetidas de reutilização',
  invalid_streak: 'Códigos inválidos consecutivos',
  wrong_sector: 'Tentativas em setor incompatível',
  staff_rate: 'Volume de validações acima do limite de alerta',
}

export const eligibilityLabels: Record<Eligibility, string> = {
  eligible: 'Disponível para emissão',
  unavailable: 'Emissão indisponível',
  checkin: 'Aguardando check-in',
  completion: 'Aguardando conclusão do evento',
  activities: 'Presença obrigatória pendente',
}

export function seatLabel(row: number, column: number) {
  return String.fromCharCode(64 + row) + column
}

export function seatKey(row: number, column: number) {
  return row + ':' + column
}

export function admissionLabel(admission: Admission) {
  return [admission.type_name, admission.sector_name, admission.seat && `Assento ${admission.seat}`].filter(Boolean).join(' · ')
}

export function csvCell(value: string | number | null) {
  const raw = String(value ?? '')
  const safe = /^[\t\r\n]|^\s*[=+@-]/.test(raw) ? "'" + raw : raw
  return '"' + safe.replaceAll('"', '""') + '"'
}

export function certificateCode(input: string) {
  const text = input.trim()
  try {
    const url = new URL(text)
    return url.searchParams.get('codigo') ?? text
  } catch {
    return text
  }
}
