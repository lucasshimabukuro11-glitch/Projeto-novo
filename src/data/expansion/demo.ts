import { isUpcoming, randomUuid, ticketCodePattern } from '../domain'
import { transact } from '../demo-store'
import type { DemoState } from '../demo-seed'
import type { CheckInResult, CheckInStatus, EventRecord, Profile, Ticket } from '../types'
import { defaultLimits, seatKey, seatLabel } from './domain'
import { seatKinds } from './types'
import type { AlertKind, CertificateRecord, Eligibility, ExpansionService, GateActivity, MonitorSnapshot, SaleOption, ValidationRow } from './types'
import type { DemoExpansion } from './seed'

type State = DemoState & { expansion: DemoExpansion }
const stamp = () => new Date().toISOString()
const activeTickets = (state: State, id: string) => state.tickets.filter(t => t.event_id === id && !t.cancelled_at)
const canManage = (actor: Profile, event: EventRecord) => actor.role === 'organizer' && event.owner_id === actor.id
const staffOf = (state: State, actor: Profile, id: string) => state.staff.some(s => s.eventId === id && s.userId === actor.id)
const canReview = (actor: Profile, event: EventRecord) => actor.role === 'admin' || canManage(actor, event)
const within = (time: string, minutes: number) => Date.parse(time) > Date.now() - minutes * 60_000

function owned(state: State, actor: Profile, id: string) {
  const event = state.events.find(e => e.id === id)
  if (!event || !canManage(actor, event)) throw new Error('Você não pode configurar este evento.')
  return event
}

function ticketOptions(state: State, event: EventRecord) {
  const tickets = activeTickets(state, event.id)
  const types = state.expansion.types.filter(t => t.event_id === event.id)
  const options: SaleOption[] = types.filter(t => t.active && (!t.deadline || Date.parse(t.deadline) > Date.now())).map(type => {
    const sector = state.expansion.sectors.find(s => s.id === type.sector_id)!
    const seats = state.expansion.maps.find(map => map.sector_id === sector.id)?.seats ?? []
    const remaining = seats.filter(s => ['standard', 'accessible'].includes(s.kind) && !tickets.some(t => t.seat_id === s.id)).length
    const sector_available = Math.max(0, Math.min(event.capacity - event.reserved_count,
      sector.capacity - tickets.filter(t => t.sector_id === sector.id).length,
      sector.seated ? remaining : sector.capacity))
    return {
      ...type, sector_name: sector.name, sector_rules: sector.description, seated: sector.seated, sector_available,
      available: Math.max(0,Math.min(sector_available,type.capacity - tickets.filter(t => t.type_id === type.id).length)),
    }
  })
  return { configured: types.length > 0, options }
}

export function demoAdmission(state: State, ticket: Ticket) {
  const type = state.expansion.types.find(t => t.id === ticket.type_id)
  const sector = state.expansion.sectors.find(s => s.id === ticket.sector_id)
  const seat = state.expansion.maps.find(m => m.sector_id === sector?.id)?.seats.find(s => s.id === ticket.seat_id)
  return { type_name: type?.name ?? 'Geral', color: type?.color ?? null, sector_name: sector?.name ?? 'Geral',
    seat: seat ? seatLabel(seat.row_no,seat.column_no) : null }
}

const limitsFor = (state: State, id: string | null) => state.expansion.limits[id ?? 'global'] ?? state.expansion.limits.global ?? defaultLimits

export function demoValidate(state: State, actor: Profile, id: string, code: string, gateId: string | null): CheckInResult {
  const event = state.events.find(e => e.id === id)
  if (!event) return { status: 'forbidden' }
  const gate = state.expansion.gates.find(g => g.id === gateId && g.event_id === id
    && (canManage(actor,event) || (staffOf(state,actor,id) && g.staff_ids?.includes(actor.id))))
  const normalized = code.trim().toLowerCase()
  const ticket = ticketCodePattern.test(normalized) ? state.tickets.find(t => t.code === normalized) : undefined
  const ticketDetails = ticket?.event_id === id ? {
    ...demoAdmission(state, ticket), event_title: event.title, participant_name: state.profiles.find(p => p.id === ticket.participant_id)?.display_name,
  } : {}
  const attempts = state.expansion.attempts
  const total = attempts.filter(a => a.event_id === id && a.staff_id === actor.id && a.result !== 'rate_limited' && within(a.happened_at,1)).length
  let result: CheckInResult
  if (total >= limitsFor(state,id).max_per_minute) result = { status: 'rate_limited' }
  else if (!(canManage(actor,event) || staffOf(state,actor,id)) || (gateId && !gate)) result = { status: 'forbidden' }
  else if (event.status === 'draft') result = { status: 'event_unavailable' }
  else if (!gateId && state.expansion.gates.some(g => g.event_id === id)) result = { status: 'gate_required' }
  else if (!ticket) result = { status: 'not_found' }
  else if (ticket.event_id !== id) result = { status: 'wrong_event' }
  else if (ticket.cancelled_at || event.status === 'cancelled') result = { status: 'cancelled', ...ticketDetails }
  else if ((gate?.sector_id ?? null) !== (ticket.sector_id ?? null)) result = { status: 'wrong_sector', ...ticketDetails }
  else if (ticket.checked_in_at) result = { status: 'used', checked_in_at: ticket.checked_in_at, ...ticketDetails }
  else {
    ticket.checked_in_at = stamp()
    event.present_count += 1
    state.checkIns.push({ ticketId: ticket.id, validatorId: actor.id, time: ticket.checked_in_at })
    result = { status: 'valid', checked_in_at: ticket.checked_in_at, ...ticketDetails }
  }
  const prior = result.status === 'rate_limited' && attempts.find(a => a.event_id === id && a.staff_id === actor.id
    && a.gate_id === (gate?.id ?? null) && a.result === 'rate_limited' && within(a.happened_at,1))
  if (prior) prior.occurrences += 1
  else attempts.push({
    id: randomUuid(), event_id: id, ticket_id: result.participant_name && ticket?.event_id === id ? ticket.id : null,
    gate_id: gate?.id ?? null, staff_id: actor.id, result: result.status, happened_at: stamp(), occurrences: 1,
  })
  return result
}

function demoGateActivity(state: State, event: string, gate: string | null): GateActivity {
  const entries = state.expansion.attempts.filter(a => a.event_id === event && a.gate_id === gate)
    .sort((a,b) => b.happened_at.localeCompare(a.happened_at))
  const allowed = entries.filter(a => a.result === 'valid').reduce((sum,a) => sum + a.occurrences,0)
  return { allowed, denied: entries.reduce((sum,a) => sum + a.occurrences,0) - allowed, recent: entries.slice(0,6) }
}

function demoMonitor(state: State, event: EventRecord): MonitorSnapshot {
  const tickets = state.tickets.filter(row => row.event_id === event.id)
  const attempts = state.expansion.attempts.filter(row => row.event_id === event.id)
  const gates = state.expansion.gates.filter(row => row.event_id === event.id).map(g => ({ id: g.id as string | null, name: g.name }))
  if (!gates.length || attempts.some(a => !a.gate_id)) gates.push({ id: null, name: 'Entrada geral' })
  const sum = (result: (value: CheckInStatus) => boolean) => attempts.filter(a => result(a.result)).reduce((n,row) => n + row.occurrences,0)
  const hours = new Map<string, { hour: string; allowed: number; denied: number }>()
  const types = new Map<string,number>()
  for (const a of attempts.filter(a => within(a.happened_at,24 * 60))) {
    const hour = a.happened_at.slice(0,13) + ':00:00.000Z'
    const record = hours.get(hour) ?? { hour, allowed: 0, denied: 0 }
    record[a.result === 'valid' ? 'allowed' : 'denied'] += a.occurrences
    hours.set(hour,record)
  }
  for (const t of tickets) {
    const label = demoAdmission(state,t).type_name
    types.set(label,(types.get(label) ?? 0) + 1)
  }
  const recent = attempts.filter(a => within(a.happened_at,5) && a.result !== 'rate_limited')
  const alerts: MonitorSnapshot['alerts'] = []
  const thresholds = limitsFor(state,event.id)
  for (const id of new Set(recent.map(a => a.staff_id))) {
    const rows = recent.filter(a => a.staff_id === id).sort((a,b) => b.happened_at.localeCompare(a.happened_at))
    const cutoff = rows.findIndex(a => a.result !== 'not_found')
    const counts: Record<AlertKind,number> = {
      reuse: rows.filter(a => a.result === 'used').length,
      invalid_streak: cutoff < 0 ? rows.length : cutoff,
      wrong_sector: rows.filter(a => a.result === 'wrong_sector').length,
      staff_rate: rows.filter(a => within(a.happened_at,1)).length,
    }
    const staff_name = state.profiles.find(p => p.id === id)?.display_name ?? 'Conta removida'
    for (const kind of Object.keys(counts) as AlertKind[]) {
      if (counts[kind] >= thresholds[kind]) alerts.push({ staff_name, kind, amount: counts[kind] })
    }
  }
  const sale = ticketOptions(state,event)
  const seatsBySector = new Map<string,{ offered: number; available: number }>()
  for (const option of sale.options) {
    const offered = (seatsBySector.get(option.sector_id)?.offered ?? 0) + option.available
    seatsBySector.set(option.sector_id,{ offered,available: option.sector_available })
  }
  const remaining = event.capacity - event.reserved_count
  const offered = [...seatsBySector.values()].reduce((sum,s) => sum + Math.min(s.offered,s.available),0)
  return {
    issued: event.issued_count, present: event.present_count, absent: event.reserved_count - event.present_count,
    available: event.status === 'published' && isUpcoming(event) ? (sale.configured ? Math.min(remaining,offered) : remaining) : 0,
    denied: sum(result => result !== 'valid'), reused: sum(result => result === 'used'),
    per_minute: attempts.filter(a => a.result === 'valid' && within(a.happened_at,1)).length,
    sectors: state.expansion.sectors.filter(s => s.event_id === event.id).map(s => ({
      name: s.name, capacity: s.capacity, reserved: tickets.filter(t => t.sector_id === s.id && !t.cancelled_at).length,
      present: tickets.filter(t => t.sector_id === s.id && t.checked_in_at).length,
    })),
    types: [...types].map(([name,issued]) => ({ name, issued })),
    gates: gates.map(g => ({ ...g, activity: demoGateActivity(state,event.id,g.id) })),
    hours: [...hours.values()].sort((a,b) => a.hour.localeCompare(b.hour)), alerts,
  }
}

function eligibility(state: State, event: EventRecord, viewer: Profile): Eligibility {
  const settings = state.expansion.settings[event.id]
  if (!settings?.enabled || event.status !== 'published') return 'unavailable'
  if (!activeTickets(state,event.id).some(t => t.participant_id === viewer.id && t.checked_in_at)) return 'checkin'
  if (!settings.completed_at && (!settings.completes_at || Date.parse(settings.completes_at) > Date.now())) return 'completion'
  if (state.expansion.activities.some(a => a.event_id === event.id && a.required && !a.participants.includes(viewer.id))) return 'activities'
  return 'eligible'
}

export const demoExpansion: ExpansionService = {
  setup: (actor,id) => transact(false,state => {
    owned(state,actor,id)
    const { sectors,types,gates } = state.expansion
    return { sectors: sectors.filter(s => s.event_id === id), types: types.filter(t => t.event_id === id), gates: gates.filter(g => g.event_id === id) }
  }),
  saveOption: (actor,id,kind,fields) => transact(true,state => {
    const event = owned(state,actor,id)
    if (event.status === 'cancelled') throw new Error('O evento foi cancelado.')
    const { sectors,types,gates } = state.expansion
    const name = String(fields.name ?? '').trim()
    const item = String(fields.id || randomUuid())
    const capacity = Number(fields.capacity)
    const sector = sectors.find(row => row.id === fields.sector_id && row.event_id === id)
    const registered = activeTickets(state,id)
    if (kind === 'gate_member') {
      const gate = gates.find(row => row.id === item && row.event_id === id)
      const userId = String(fields.user_id)
      if (!gate || !state.staff.some(s => s.eventId === id && s.userId === userId)) throw new Error('Adicione a conta à equipe do evento.')
      const grants = new Set(gate.staff_ids ?? [])
      if (fields.enabled) grants.add(userId)
      else grants.delete(userId)
      gate.staff_ids = [...grants]
      return
    }
    if (name.length < 2) throw new Error('Informe o nome.')
    const description = String(fields.description ?? '')
    if (kind === 'sector') {
      if (capacity < 1 || capacity + sectors.filter(s => s.event_id === id && s.id !== item).reduce((n,s) => n + s.capacity,0) > event.capacity) {
        throw new Error('A soma dos setores deve respeitar a capacidade do evento.')
      }
      if (registered.filter(t => t.sector_id === item).length > capacity || types.some(t => t.sector_id === item && t.capacity > capacity)) {
        throw new Error('A capacidade não pode ser menor que as reservas ou modalidades deste setor.')
      }
      const existing = sectors.find(s => s.id === item && s.event_id === id)
      if (sectors.some(s => s.event_id === id && s.id !== item && s.name === name)) throw new Error('Já existe um setor com esse nome.')
      if (existing) Object.assign(existing,{ name, description, capacity })
      else sectors.push({ id: item,event_id: id,name,description,capacity,seated: Boolean(fields.seated) })
      return
    }
    if (kind === 'gate') {
      if (fields.sector_id && !sector) throw new Error('Escolha um setor deste evento.')
      const existing = gates.find(g => g.id === item && g.event_id === id)
      if (gates.some(g => g.event_id === id && g.id !== item && g.name === name)) throw new Error('Já existe uma portaria com esse nome.')
      if (existing) existing.name = name
      else gates.push({ id: item,event_id: id,name,sector_id: sector?.id ?? null,staff_ids: [] })
      return
    }
    const limit = Number(fields.per_person)
    if (!sector || capacity < 1 || capacity > sector.capacity || limit < 1 || limit > Math.min(20,capacity)) throw new Error('Confira o setor, a quantidade e o limite por pessoa.')
    if (registered.filter(t => t.type_id === item).length > capacity) throw new Error('A quantidade não pode ser menor que as reservas.')
    if (types.some(t => t.event_id === id && t.id !== item && t.name === name)) throw new Error('Já existe uma modalidade com esse nome.')
    const record = { id: item,event_id: id,sector_id: sector.id,name,description,capacity,per_person: limit,
      color: String(fields.color),active: Boolean(fields.active),deadline: fields.deadline ? String(fields.deadline) : null }
    const existing = types.find(t => t.id === item && t.event_id === id)
    if (existing && existing.sector_id !== sector.id) throw new Error('O setor da modalidade está fixado.')
    if (existing) Object.assign(existing,record)
    else types.push(record)
  }),
  options: (id,actor) => transact(false,state => {
    const event = state.events.find(e => e.id === id)
    return event && (event.status === 'published' || (actor && canManage(actor,event))) ? ticketOptions(state,event) : null
  }),
  map: (id,actor) => transact(false,state => {
    const map = state.expansion.maps.find(m => m.sector_id === id)
    const sector = state.expansion.sectors.find(s => s.id === id)
    const event = state.events.find(e => e.id === sector?.event_id)
    if (!map || !event || (event.status !== 'published' && (!actor || !canManage(actor,event)))) return null
    const tickets = activeTickets(state,event.id)
    return { ...map, seats: map.seats.filter(s => s.row_no <= map.rows && s.column_no <= map.columns)
      .map(s => ({ ...s,taken: tickets.some(ticket => ticket.seat_id === s.id) })) }
  }),
  saveMap: (actor,event,id,input) => transact(true,state => {
    const target = owned(state,actor,event)
    if (target.status === 'cancelled' || !state.expansion.sectors.some(s => s.id === id && s.event_id === event && s.seated)) throw new Error('Selecione um setor com assentos.')
    const { rows,columns,stage,cells } = input
    if (rows < 1 || rows > 26 || columns < 1 || columns > 30 || !stage.trim()) throw new Error('Dimensões inválidas.')
    const index = state.expansion.maps.findIndex(m => m.sector_id === id)
    const previous = state.expansion.maps[index]?.seats ?? []
    const tickets = activeTickets(state,event)
    if (previous.some(s => tickets.some(t => t.seat_id === s.id) &&
      (s.row_no > rows || s.column_no > columns || ['blocked','aisle'].includes(cells[seatKey(s.row_no,s.column_no)])))) {
      throw new Error('O mapa removeria ou bloquearia um assento já reservado.')
    }
    const seats = Array.from({ length: rows * columns },(_,i) => {
      const row_no = Math.floor(i / columns) + 1
      const column_no = i % columns + 1
      const seat = previous.find(s => s.row_no === row_no && s.column_no === column_no)
      const kind = cells[seatKey(row_no,column_no)] ?? 'standard'
      if (!seatKinds.includes(kind)) throw new Error('Tipo de assento inválido.')
      return { id: seat?.id ?? randomUuid(),row_no,column_no,kind,taken: false }
    })
    const map = { sector_id: id,rows,columns,stage: stage.trim(), seats: [...seats,...previous.filter(s => s.row_no > rows || s.column_no > columns)] }
    if (index < 0) state.expansion.maps.push(map)
    else state.expansion.maps[index] = map
  }),
  reserve: (actor,id,typeId,seatId,requestId) => transact(true,state => {
    const event = state.events.find(e => e.id === id)
    if (actor.role !== 'participant' || !event || event.status !== 'published') throw new Error('Este evento não está disponível para inscrições.')
    const existing = state.tickets.find(t => t.event_id === id && t.participant_id === actor.id && t.request_id === requestId)
    if (existing) {
      if (existing.seat_id !== seatId || existing.type_id !== typeId) throw new Error('A solicitação já foi usada para outro ingresso.')
      return existing
    }
    const option = ticketOptions(state,event).options.find(type => type.id === typeId)
    if (!option || !isUpcoming(event)) throw new Error('As inscrições para esta modalidade estão encerradas.')
    const current = activeTickets(state,id)
    if (current.filter(t => t.type_id === typeId && t.participant_id === actor.id).length >= option.per_person) throw new Error('Você atingiu o limite desta modalidade.')
    if (option.seated) {
      const map = state.expansion.maps.find(m => m.sector_id === option.sector_id)
      const free = map?.seats.some(s => s.id === seatId && s.row_no <= map.rows && s.column_no <= map.columns && ['accessible','standard'].includes(s.kind))
      if (!free) throw new Error('Selecione um assento disponível deste setor.')
      if (current.some(t => t.seat_id === seatId)) throw new Error('Este assento foi reservado. Escolha outro lugar.')
    } else if (seatId) throw new Error('Este setor não tem assentos marcados.')
    if (!option.available) throw new Error('Não há vagas disponíveis nesta modalidade.')
    const ticket: Ticket = { id: randomUuid(),event_id: id,participant_id: actor.id,code: randomUuid(),
      issued_at: stamp(),type_id: typeId,sector_id: option.sector_id,seat_id: seatId,request_id: requestId,cancelled_at: null,checked_in_at: null }
    state.tickets.push(ticket)
    event.issued_count += 1
    event.reserved_count += 1
    return ticket
  }),
  gates: (actor,id) => transact(false,state => {
    const event = state.events.find(e => e.id === id)
    if (!event || !(canManage(actor,event) || staffOf(state,actor,id))) throw new Error('Você não tem acesso a este evento.')
    const gates = state.expansion.gates.filter(g => g.event_id === id)
    return { required: gates.length > 0, gates: gates.filter(g => canManage(actor,event) || g.staff_ids?.includes(actor.id)) }
  }),
  gateActivity: (actor,id,gateId) => transact(false,state => {
    const event = state.events.find(e => e.id === id)
    const gate = state.expansion.gates.find(g => g.id === gateId && g.event_id === id)
    if (!event || !(canReview(actor,event) || (staffOf(state,actor,id) && gate?.staff_ids?.includes(actor.id)))) throw new Error('Você não tem acesso a esta portaria.')
    return demoGateActivity(state,id,gateId)
  }),
  monitor: (actor,id) => transact(false,state => {
    const event = state.events.find(e => e.id === id)
    if (!event || !canReview(actor,event)) throw new Error('Você não tem acesso a este painel.')
    return demoMonitor(state,event)
  }),
  auditGates: actor => transact(false,state => state.expansion.gates.filter(g => state.events.some(e => e.id === g.event_id && canReview(actor,e)))),
  audit: (actor,filters,offset,limit) => transact(false,state => {
    if (actor.role === 'participant') throw new Error('Você não tem acesso a este histórico.')
    const allowed = new Map(state.events.filter(event => canReview(actor,event)).map(e => [e.id,e.title]))
    const rows = state.expansion.attempts.filter(a => allowed.has(a.event_id)
      && (!filters.event || filters.event === a.event_id) && (!filters.gate || filters.gate === a.gate_id)
      && (!filters.result || filters.result === a.result) && (!filters.from || a.happened_at >= filters.from)
      && (!filters.until || a.happened_at <= filters.until))
      .sort((a,b) => b.happened_at.localeCompare(a.happened_at))
    return { total: rows.length, occurrences: rows.reduce((sum,row) => sum + row.occurrences,0),
      rows: rows.slice(offset,offset + limit).map((row): ValidationRow => ({
        ...row,event_title: allowed.get(row.event_id)!,gate_name: state.expansion.gates.find(g => g.id === row.gate_id)?.name ?? null,
        staff_name: state.profiles.find(p => p.id === row.staff_id)?.display_name ?? null,
      })),
    }
  }),
  limits: (actor,id) => transact(false,state => {
    if (actor.role !== 'admin') owned(state,actor,id ?? '')
    return limitsFor(state,id)
  }),
  saveLimits: (actor,id,limits) => transact(true,state => {
    if (actor.role !== 'admin') owned(state,actor,id ?? '')
    if (limits.max_per_minute < limits.staff_rate) throw new Error('O limite de bloqueio deve ser maior ou igual ao alerta.')
    state.expansion.limits[id ?? 'global'] = limits
  }),
  certificateSetup: (actor,id) => transact(false,state => {
    owned(state,actor,id)
    return { settings: state.expansion.settings[id] ?? null,
      activities: state.expansion.activities.filter(a => a.event_id === id).map(a => ({ ...a,present_count: a.participants.length })),
      issued: state.expansion.certificates.filter(c => c.event_id === id) }
  }),
  saveCertificate: (actor,id,input) => transact(true,state => {
    owned(state,actor,id)
    const { completed,...settings } = input
    state.expansion.settings[id] = { ...settings, completed_at: completed ? state.expansion.settings[id]?.completed_at ?? stamp() : null }
  }),
  saveActivity: (actor,event,id,name,required) => transact(true,state => {
    owned(state,actor,event)
    const activity = state.expansion.activities.find(a => a.event_id === event && a.id === id)
    if (!name.trim()) throw new Error('Informe o nome da atividade.')
    if (activity) Object.assign(activity,{ name, required })
    else state.expansion.activities.push({ id: randomUuid(),event_id: event, name,required,participants: [] })
  }),
  recordActivity: (actor,event,id,email,present) => transact(true,state => {
    owned(state,actor,event)
    const activity = state.expansion.activities.find(a => a.event_id === event && a.id === id)
    const participant = state.profiles.find(p => p.email.toLowerCase() === email.trim().toLowerCase())
    if (!activity || !participant || !activeTickets(state,event).some(t => t.participant_id === participant.id && t.checked_in_at)) {
      throw new Error('A conta precisa de um check-in válido neste evento.')
    }
    const members = new Set(activity.participants)
    if (present) members.add(participant.id)
    else members.delete(participant.id)
    activity.participants = [...members]
  }),
  myCertificates: actor => transact(false,state => state.events.flatMap(event => {
    const certificate = state.expansion.certificates.find(c => c.event_id === event.id && c.participant_id === actor.id)
    if (!certificate && (!state.expansion.settings[event.id]?.enabled || !activeTickets(state,event.id).some(t => t.participant_id === actor.id))) return []
    return [{ event_id: event.id,title: event.title,starts_at: event.starts_at,eligibility: eligibility(state,event,actor),certificate: certificate ?? null }]
  })),
  issue: (actor,id) => transact(true,state => {
    const existing = state.expansion.certificates.find(c => c.event_id === id && c.participant_id === actor.id)
    if (existing?.revoked_at) throw new Error('Este certificado foi revogado.')
    if (existing) return existing
    const event = state.events.find(e => e.id === id)
    if (!event || eligibility(state,event,actor) !== 'eligible') throw new Error('A inscrição ainda não atende aos requisitos do certificado.')
    const template = state.expansion.settings[id]
    const details = {
      participant_name: actor.display_name,event_name: template.event_name,organizer_name: template.organizer_name,
      hours: template.hours,event_date: template.event_date,participation_text: template.participation_text,
      logo_url: template.logo_url,signature_url: template.signature_url,
    }
    const record: CertificateRecord = { id: randomUuid(),code: randomUuid(),event_id: id,issued_at: stamp(),revoked_at: null,details }
    state.expansion.certificates.push({ ...record,participant_id: actor.id })
    return record
  }),
  revoke: (actor,event,id) => transact(true,state => {
    const target = state.events.find(e => e.id === event)
    if (!target || !canReview(actor,target)) throw new Error('Você não pode revogar este certificado.')
    const record = state.expansion.certificates.find(c => c.event_id === event && c.id === id)
    if (!record) throw new Error('Certificado inexistente neste evento.')
    record.revoked_at ??= stamp()
  }),
  verify: code => transact(false,state => {
    const record = state.expansion.certificates.find(c => c.code === code.trim().toLowerCase())
    if (!record) return { status: 'not_found' }
    if (record.revoked_at) return { status: 'revoked' }
    const { logo_url: _logo,signature_url: _signature,...details } = record.details
    return { status: 'valid',issued_at: record.issued_at,details }
  }),
}
