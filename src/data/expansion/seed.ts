import { randomUuid } from '../domain'
import { demoAccounts } from '../demo-seed'
import type { DemoState } from '../demo-seed'
import type { CheckInStatus } from '../types'
import type { CertificateActivity, CertificateRecord, CertificateSettings, EventSetup, SeatMap, SecurityLimits } from './types'

export type DemoAttempt = {
  id: string; event_id: string; ticket_id: string | null; gate_id: string | null
  staff_id: string; result: CheckInStatus; happened_at: string; occurrences: number
}

export interface DemoExpansion extends EventSetup {
  maps: SeatMap[]
  attempts: DemoAttempt[]
  limits: Record<string, SecurityLimits>
  settings: Record<string, CertificateSettings>
  activities: (Omit<CertificateActivity,'present_count'> & { event_id: string; participants: string[] })[]
  certificates: (CertificateRecord & { participant_id: string })[]
}

export function seedExpansion(state: DemoState): DemoExpansion {
  const summit = state.events.find(event => event.id === 'tech-summit-brasil')
  const event_id = 'tech-summit-brasil'
  const seatSector = 'demo-auditorio'
  const staffId = demoAccounts.staff.id
  const expansion: DemoExpansion = {
    sectors: summit ? [
      { id: seatSector, event_id, name: 'Auditório universitário', description: 'Use a portaria principal e apresente seu ingresso na entrada.', capacity: 18, seated: true },
      { id: 'demo-setor-vip', event_id, name: 'Sala VIP', description: 'Entrada pela portaria VIP.', capacity: 12, seated: false },
    ] : [],
    types: summit ? [
      { id: 'demo-modalidade-auditorio', event_id, sector_id: seatSector, name: 'Pista', description: 'Escolha um assento para acompanhar as palestras.', capacity: 18, per_person: 1, color: '#a78bfa', active: true, deadline: null },
      { id: 'demo-modalidade-vip', event_id, sector_id: 'demo-setor-vip', name: 'VIP', description: 'Acesso à sala VIP e ao encontro com palestrantes.', capacity: 12, per_person: 2, color: '#f2bd73', active: true, deadline: null },
    ] : [],
    gates: summit ? [
      { id: 'demo-portaria-auditorio', event_id, sector_id: seatSector, name: 'Portaria Auditório', staff_ids: [staffId] },
      { id: 'demo-portaria-vip', event_id, sector_id: 'demo-setor-vip', name: 'Portaria VIP', staff_ids: [staffId] },
      { id: 'demo-portaria-geral', event_id, sector_id: null, name: 'Portaria Geral', staff_ids: [staffId] },
    ] : [],
    maps: summit ? [{ sector_id: seatSector, rows: 3, columns: 7, stage: 'Palco',
      seats: Array.from({ length: 21 }, (_, i) => ({
        id: 'demo-assento-' + i, row_no: Math.floor(i / 7) + 1, column_no: i % 7 + 1,
        kind: i % 7 === 3 ? 'aisle' : i === 0 ? 'accessible' : i === 20 ? 'blocked' : 'standard', taken: false,
      })),
    }] : [],
    attempts: state.checkIns.flatMap(log => {
      const ticket = state.tickets.find(row => row.id === log.ticketId)
      return ticket ? [{
        id: randomUuid(), event_id: ticket.event_id, ticket_id: ticket.id, staff_id: log.validatorId,
        gate_id: ticket.event_id === event_id ? 'demo-portaria-geral' : null,
        result: 'valid', happened_at: log.time, occurrences: 1,
      }] : []
    }),
    limits: {}, settings: {}, activities: [], certificates: [],
  }
  if (summit) {
    expansion.attempts.push({
      id: randomUuid(), event_id, ticket_id: null, staff_id: staffId, gate_id: 'demo-portaria-vip',
      result: 'not_found', happened_at: new Date(Date.now() - 2 * 60_000).toISOString(), occurrences: 1,
    })
  }

  const organizer = state.profiles.find(user => user.id === demoAccounts.organizer.id)
  const participant = state.profiles.find(user => user.id === demoAccounts.participant.id)
  if (organizer && participant) {
    const date = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const completed = 'demo-jornada-universitaria'
    const ticketId = randomUuid()
    const details = {
      event_name: 'Jornada Universitária de Inovação', organizer_name: 'Faculdade Horizonte (demonstração)',
      participant_name: participant.display_name, hours: 6, event_date: date.slice(0, 10),
      participation_text: 'Participou da jornada acadêmica de inovação e tecnologia.',
      logo_url: null, signature_url: null,
    }
    state.events.push({
      id: completed, owner_id: organizer.id, title: details.event_name, description: 'Evento acadêmico fictício concluído.',
      category: 'Educação', cover_url: '/images/technology.webp', starts_at: date, venue: 'Auditório Horizonte',
      city: 'São Paulo, SP', capacity: 1, status: 'published', is_demo: true, issued_count: 1, reserved_count: 1,
      present_count: 1, created_at: date,
    })
    state.tickets.push({
      id: ticketId, event_id: completed, participant_id: participant.id, code: randomUuid(), issued_at: date,
      cancelled_at: null, checked_in_at: date,
    })
    state.checkIns.push({ ticketId, time: date, validatorId: organizer.id })
    expansion.attempts.push({
      id: randomUuid(), event_id: completed, ticket_id: ticketId, gate_id: null, staff_id: organizer.id,
      result: 'valid', happened_at: date, occurrences: 1,
    })
    expansion.settings[completed] = { ...details, enabled: true, completes_at: null, completed_at: date }
    expansion.certificates.push({
      id: randomUuid(), code: randomUuid(), event_id: completed, participant_id: participant.id,
      details, issued_at: date, revoked_at: null,
    })
  }
  return expansion
}
