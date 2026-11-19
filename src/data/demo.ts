import { isUpcoming, maxCoverSize, coverTypes, pageSize, randomUuid, toPage } from './domain'
import { demoAccounts } from './demo-seed'
import type { DemoPersona, DemoState } from './demo-seed'
import { transact, watchDemo } from './demo-store'
import { demoAdmission, demoValidate } from './expansion/demo'
import type { Activity, DataService, EventRecord, Profile, Ticket } from './types'

const sessionKey = 'eventpass.demo.profile'

export function demoProfile() {
  const id = sessionStorage.getItem(sessionKey)
  if (!id) return Promise.resolve(null)
  return transact(false, state => state.profiles.find(profile => profile.id === id) ?? null)
}

export async function signInDemo(persona: DemoPersona) {
  const id = demoAccounts[persona].id
  const profile = await transact(false, state => state.profiles.find(record => record.id === id)!)
  sessionStorage.setItem(sessionKey, profile.id)
  return profile
}

export async function signInDemoEmail(email: string) {
  const profile = await transact(false, state => state.profiles.find(record =>
    record.role === 'participant' && record.email === email.trim().toLowerCase()
  ))
  if (!profile) throw new Error('Não encontramos uma conta fictícia com esse e-mail.')
  sessionStorage.setItem(sessionKey, profile.id)
  return profile
}

export async function signUpDemo(displayName: string, email: string) {
  const profile = await transact(true, state => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail.endsWith('@example.test')) throw new Error('Use um endereço fictício terminado em @example.test.')
    if (state.profiles.some(record => record.email === normalizedEmail)) throw new Error('Este e-mail fictício já está cadastrado.')
    const record: Profile = {
      id: randomUuid(), display_name: displayName.trim(), email: normalizedEmail,
      role: 'participant', created_at: new Date().toISOString(),
    }
    state.profiles.push(record)
    return record
  })
  sessionStorage.setItem(sessionKey, profile.id)
  return profile
}

export function signOutDemo() {
  sessionStorage.removeItem(sessionKey)
}

function ownedEvent(state: DemoState, actor: Profile, id: string) {
  const event = state.events.find(row => row.id === id && row.owner_id === actor.id)
  if (actor.role !== 'organizer' || !event) throw new Error('Você não pode gerenciar este evento.')
  return event
}

function canCheckIn(state: DemoState, actor: Profile, event: EventRecord) {
  return (actor.role === 'organizer' && event.owner_id === actor.id)
    || state.staff.some(row => row.eventId === event.id && row.userId === actor.id)
}

function upcomingFirst(a: EventRecord, b: EventRecord) {
  return a.starts_at.localeCompare(b.starts_at)
}

function readCover(file: File) {
  if (!coverTypes.includes(file.type) || file.size > maxCoverSize) {
    throw new Error('Use uma imagem JPEG, PNG, WebP ou AVIF de até 5 MB.')
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Não foi possível abrir a imagem.'))
    reader.readAsDataURL(file)
  })
}

export const demoData: DataService = {
  publicEvents: () => transact(false, state => state.events.filter(row => row.status === 'published' && isUpcoming(row)).sort(upcomingFirst)),

  event: (id, actor) => transact(false, state => {
    const event = state.events.find(row => row.id === id)
    if (!event) return null
    const visible = event.status === 'published' || (actor && (
      actor.role === 'admin' || canCheckIn(state, actor, event)
      || state.tickets.some(ticket => ticket.event_id === id && ticket.participant_id === actor.id)
    ))
    return visible ? event : null
  }),

  myTickets: actor => transact(false, state => state.tickets
    .filter(row => row.participant_id === actor.id)
    .sort((a, b) => b.issued_at.localeCompare(a.issued_at))
    .map(row => ({ ...row, event: state.events.find(event => event.id === row.event_id)!, admission: demoAdmission(state, row) }))),

  reserve: (actor, id) => transact(true, state => {
    if (actor.role !== 'participant') throw new Error('É necessária uma conta de participante para reservar.')
    const event = state.events.find(row => row.id === id)
    if (!event || event.status !== 'published') throw new Error('Este evento não está disponível para inscrições.')
    const existing = state.tickets.find(row => row.event_id === id && row.participant_id === actor.id && !row.type_id)
    if (existing?.cancelled_at) throw new Error('Seu ingresso para este evento foi cancelado.')
    if (existing) return existing
    if (state.expansion.types.some(type => type.event_id === id)) throw new Error('Selecione uma modalidade de ingresso.')
    if (!isUpcoming(event)) throw new Error('As inscrições para este evento foram encerradas.')
    if (event.reserved_count >= event.capacity) throw new Error('Este evento está lotado.')
    const ticket: Ticket = {
      id: randomUuid(), event_id: id, participant_id: actor.id, code: randomUuid(),
      issued_at: new Date().toISOString(), checked_in_at: null, cancelled_at: null,
    }
    state.tickets.push(ticket)
    event.issued_count += 1
    event.reserved_count += 1
    return ticket
  }),

  async create(actor, input, file) {
    if (actor.role !== 'organizer') throw new Error('Apenas organizadores podem criar eventos.')
    if (!isUpcoming(input)) throw new Error('Escolha uma data futura.')
    const cover_url = file ? await readCover(file) : input.cover_url
    return transact(true, state => {
      const event: EventRecord = {
        ...input, cover_url, owner_id: actor.id, id: randomUuid(), status: 'draft',
        is_demo: true, reserved_count: 0, present_count: 0, issued_count: 0, created_at: new Date().toISOString(),
      }
      state.events.push(event)
      return event
    })
  },

  changeStatus: (actor, id, status) => transact(true, state => {
    const event = ownedEvent(state, actor, id)
    if (event.status === status) return event
    if (event.status === 'cancelled' || (status === 'published' && !isUpcoming(event))) {
      throw new Error('Não foi possível alterar o status desse evento.')
    }
    event.status = status
    return event
  }),

  managedEvents: actor => transact(false, state => state.events
    .filter(row => actor.role === 'admin' || (actor.role === 'organizer' && row.owner_id === actor.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))),

  checkInEvents: actor => transact(false, state => state.events
    .filter(row => row.status === 'published' && canCheckIn(state, actor, row)).sort(upcomingFirst)),

  validate: (actor, id, code, gate = null) => transact(true, state => demoValidate(state, actor, id, code, gate)),

  dashboard: actor => transact(false, state => {
    if (actor.role === 'participant') throw new Error('Você não pode acessar este painel.')
    const events = state.events.filter(row => actor.role === 'admin' || row.owner_id === actor.id)
    const published = events.filter(row => row.status === 'published')
    const totals = {
      events: events.length,
      issued: events.reduce((sum, row) => sum + row.issued_count, 0),
      present: published.reduce((sum, row) => sum + row.present_count, 0),
      reserved: published.reduce((sum, row) => sum + row.reserved_count, 0),
      capacity: published.reduce((sum, row) => sum + row.capacity, 0),
    }
    const activity: Activity[] = []
    for (const ticket of state.tickets) {
      const event = events.find(row => row.id === ticket.event_id)
      if (!event) continue
      const participant = state.profiles.find(row => row.id === ticket.participant_id)!
      const common = { id: ticket.id, event_title: event.title, display_name: participant.display_name }
      activity.push({ ...common, kind: 'issued', happened_at: ticket.issued_at })
      if (ticket.checked_in_at) activity.push({ ...common, kind: 'checked_in', happened_at: ticket.checked_in_at })
    }
    return {
      totals, chart: published.sort(upcomingFirst).slice(-8),
      accounts: actor.role === 'admin' ? {
        total: state.profiles.length, organizers: state.profiles.filter(row => row.role === 'organizer').length,
      } : null,
      activity: activity.sort((a, b) => b.happened_at.localeCompare(a.happened_at)).slice(0, 10),
    }
  }),

  roster: (actor, id, page) => transact(false, state => {
    ownedEvent(state, actor, id)
    const rows = state.tickets.filter(ticket => ticket.event_id === id).sort((a, b) => b.issued_at.localeCompare(a.issued_at))
    return toPage(rows.slice(page * pageSize, (page + 1) * pageSize + 1).map(ticket => {
      const { display_name, email } = state.profiles.find(record => record.id === ticket.participant_id)!
      return { id: ticket.id, issued_at: ticket.issued_at, checked_in_at: ticket.checked_in_at, cancelled_at: ticket.cancelled_at, display_name, email }
    }))
  }),

  cancelTicket: (actor, id, ticketId) => transact(true, state => {
    const event = ownedEvent(state, actor, id)
    const ticket = state.tickets.find(row => row.id === ticketId && row.event_id === id)
    if (!ticket || ticket.cancelled_at || ticket.checked_in_at) throw new Error('Apenas ingressos ativos e sem check-in podem ser cancelados.')
    ticket.cancelled_at = new Date().toISOString()
    event.reserved_count -= 1
  }),

  team: (actor, id) => transact(false, state => {
    ownedEvent(state, actor, id)
    return state.staff.filter(row => row.eventId === id).map(row => {
      const { id: userId, display_name, email } = state.profiles.find(record => record.id === row.userId)!
      return { id: userId, display_name, email }
    })
  }),

  assignStaff: (actor, id, email) => transact(true, state => {
    ownedEvent(state, actor, id)
    const member = state.profiles.find(row => row.email === email.trim().toLowerCase())
    if (!member || member.id === actor.id) throw new Error('Informe o e-mail de outra conta EventScan.')
    if (!state.staff.some(row => row.eventId === id && row.userId === member.id)) {
      state.staff.push({ eventId: id, userId: member.id })
    }
  }),

  removeStaff: (actor, id, userId) => transact(true, state => {
    ownedEvent(state, actor, id)
    state.staff = state.staff.filter(row => row.eventId !== id || row.userId !== userId)
    for (const gate of state.expansion.gates.filter(row => row.event_id === id)) {
      gate.staff_ids = gate.staff_ids?.filter(member => member !== userId)
    }
  }),

  accounts: (actor, page, onlyOrganizers) => transact(false, state => {
    if (actor.role !== 'admin') throw new Error('Apenas administradores podem consultar as contas.')
    const rows = state.profiles.filter(record => !onlyOrganizers || record.role === 'organizer')
    return toPage(rows.slice(page * pageSize, (page + 1) * pageSize + 1))
  }),

  watch: watchDemo,
}
