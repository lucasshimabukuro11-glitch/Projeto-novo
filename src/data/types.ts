import type { Admission } from './expansion/types'

export const categories = ['Música', 'Tecnologia', 'Gastronomia', 'Cultura', 'Educação', 'Negócios', 'Outros'] as const
export type Category = (typeof categories)[number]
export type Role = 'participant' | 'organizer' | 'admin'
export type EventStatus = 'draft' | 'published' | 'cancelled'

export interface Profile {
  id: string
  email: string
  display_name: string
  role: Role
  created_at: string
}

export interface EventRecord {
  id: string
  owner_id: string
  title: string
  description: string
  category: Category
  cover_url: string | null
  starts_at: string
  venue: string
  city: string
  capacity: number
  status: EventStatus
  is_demo: boolean
  issued_count: number
  reserved_count: number
  present_count: number
  created_at: string
}

export type EventInput = Pick<EventRecord, 'title' | 'description' | 'category' | 'cover_url' | 'starts_at' | 'venue' | 'city' | 'capacity'>
export type ChartEvent = Pick<EventRecord, 'id' | 'title' | 'starts_at' | 'capacity' | 'reserved_count' | 'present_count'>

export interface Ticket {
  id: string
  event_id: string
  participant_id: string
  code: string
  issued_at: string
  cancelled_at: string | null
  checked_in_at: string | null
  type_id?: string | null
  sector_id?: string | null
  seat_id?: string | null
  request_id?: string | null
}

export type TicketWithEvent = Ticket & { event: EventRecord; admission?: Admission }
export type TeamMember = Pick<Profile, 'id' | 'display_name' | 'email'>
export type RosterEntry = Omit<Ticket, 'code' | 'event_id' | 'participant_id'> & Pick<Profile, 'display_name' | 'email'>

export type CheckInStatus = 'valid' | 'used' | 'not_found' | 'cancelled' | 'wrong_event' | 'forbidden' | 'event_unavailable' | 'wrong_sector' | 'gate_required' | 'rate_limited'
export type CheckInResult = ({ status: 'valid' | 'used'; checked_in_at: string }
  | { status: Exclude<CheckInStatus, 'valid' | 'used'> }) & Partial<Admission & { participant_name: string; event_title: string }>

export interface Activity {
  id: string
  kind: 'issued' | 'checked_in'
  happened_at: string
  event_title: string
  display_name: string
}

export interface DashboardSnapshot {
  totals: { events: number; issued: number; present: number; reserved: number; capacity: number }
  accounts: { total: number; organizers: number } | null
  chart: ChartEvent[]
  activity: Activity[]
}

export interface Page<T> {
  rows: T[]
  hasMore: boolean
}

export interface DataService {
  publicEvents(): Promise<EventRecord[]>
  event(id: string, viewer: Profile | null): Promise<EventRecord | null>
  myTickets(viewer: Profile): Promise<TicketWithEvent[]>
  reserve(viewer: Profile, eventId: string): Promise<Ticket>
  create(viewer: Profile, input: EventInput, cover?: File): Promise<EventRecord>
  changeStatus(viewer: Profile, eventId: string, status: 'published' | 'cancelled'): Promise<EventRecord>
  managedEvents(viewer: Profile): Promise<EventRecord[]>
  checkInEvents(viewer: Profile): Promise<EventRecord[]>
  validate(viewer: Profile, eventId: string, code: string, gate?: string | null): Promise<CheckInResult>
  dashboard(viewer: Profile): Promise<DashboardSnapshot>
  roster(viewer: Profile, eventId: string, page: number): Promise<Page<RosterEntry>>
  cancelTicket(viewer: Profile, eventId: string, ticketId: string): Promise<void>
  team(viewer: Profile, eventId: string): Promise<TeamMember[]>
  assignStaff(viewer: Profile, eventId: string, email: string): Promise<void>
  removeStaff(viewer: Profile, eventId: string, userId: string): Promise<void>
  accounts(viewer: Profile, page: number, onlyOrganizers: boolean): Promise<Page<Profile>>
  watch(listener: () => void): () => void
}
