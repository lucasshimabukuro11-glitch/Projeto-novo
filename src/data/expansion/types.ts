import type { CheckInStatus, Profile, Ticket } from '../types'

export interface Sector {
  id: string
  event_id: string
  name: string
  description: string
  capacity: number
  seated: boolean
}

export interface TicketOption {
  id: string
  event_id: string
  sector_id: string
  name: string
  description: string
  capacity: number
  per_person: number
  color: string
  active: boolean
  deadline: string | null
}

export type SaleOption = TicketOption & { sector_name: string; sector_rules: string; seated: boolean; available: number; sector_available: number }
export type Gate = { id: string; event_id: string; sector_id: string | null; name: string; staff_ids?: string[] }
export type EventSetup = { sectors: Sector[]; types: TicketOption[]; gates: Gate[] }
export type SaleOptions = { configured: boolean; options: SaleOption[] }
export type GateOptions = { required: boolean; gates: Gate[] }
export type OptionKind = 'sector' | 'type' | 'gate' | 'gate_member'
export type OptionFields = Record<string, string | number | boolean | null>

export const seatKinds = ['standard', 'accessible', 'blocked', 'aisle'] as const
export type SeatKind = (typeof seatKinds)[number]
export type Seat = { id: string; row_no: number; column_no: number; kind: SeatKind; taken: boolean }
export type SeatMap = { sector_id: string; rows: number; columns: number; stage: string; seats: Seat[] }
export type MapInput = Omit<SeatMap,'sector_id' | 'seats'> & { cells: Record<string, SeatKind> }

export interface Admission {
  type_name: string
  sector_name: string
  seat: string | null
  color: string | null
}

export interface ValidationRow {
  id: string
  event_id: string
  ticket_id: string | null
  gate_id: string | null
  result: CheckInStatus
  happened_at: string
  occurrences: number
  event_title: string
  gate_name: string | null
  staff_name: string | null
}

export type AuditFilters = {
  event: string | null
  gate: string | null
  result: CheckInStatus | null
  from: string | null
  until: string | null
}
export type AuditPage = { rows: ValidationRow[]; total: number; occurrences: number }
export type SecurityLimits = { reuse: number; invalid_streak: number; wrong_sector: number; staff_rate: number; max_per_minute: number }
export type AlertKind = Exclude<keyof SecurityLimits, 'max_per_minute'>
export type GateActivity = {
  allowed: number
  denied: number
  recent: Pick<ValidationRow, 'result' | 'happened_at' | 'occurrences'>[]
}
export type MonitorSnapshot = {
  issued: number
  present: number
  absent: number
  available: number
  denied: number
  reused: number
  per_minute: number
  sectors: { name: string; capacity: number; reserved: number; present: number }[]
  types: { name: string; issued: number }[]
  gates: { id: string | null; name: string; activity: GateActivity }[]
  hours: { hour: string; allowed: number | null; denied: number | null }[]
  alerts: { staff_name: string; kind: AlertKind; amount: number }[]
}

export type CertificateTemplate = {
  event_name: string
  organizer_name: string
  hours: number
  event_date: string
  participation_text: string
  logo_url: string | null
  signature_url: string | null
}
export type CertificateSettings = CertificateTemplate & { enabled: boolean; completes_at: string | null; completed_at: string | null }
export type CertificateInput = Omit<CertificateSettings, 'completed_at'> & { completed: boolean }
export type CertificateActivity = { id: string; name: string; required: boolean; present_count: number }
export type CertificateRecord = {
  id: string
  event_id: string
  code: string
  details: CertificateTemplate & { participant_name: string }
  issued_at: string
  revoked_at: string | null
}
export type CertificateSetup = { settings: CertificateSettings | null; activities: CertificateActivity[]; issued: CertificateRecord[] }
export type Eligibility = 'unavailable' | 'checkin' | 'completion' | 'activities' | 'eligible'
export type CertificateEvent = { event_id: string; title: string; starts_at: string; eligibility: Eligibility; certificate: CertificateRecord | null }
export type Verification = { status: 'not_found' | 'revoked' } |
  { status: 'valid'; issued_at: string; details: Omit<CertificateRecord['details'], 'logo_url' | 'signature_url'> }

export interface ExpansionService {
  setup(viewer: Profile, event: string): Promise<EventSetup>
  saveOption(viewer: Profile, event: string, kind: OptionKind, fields: OptionFields): Promise<void>
  options(event: string, viewer: Profile | null): Promise<SaleOptions | null>
  map(sector: string, viewer: Profile | null): Promise<SeatMap | null>
  saveMap(viewer: Profile, event: string, sector: string, input: MapInput): Promise<void>
  reserve(viewer: Profile, event: string, type: string, seat: string | null, request: string): Promise<Ticket>
  gates(viewer: Profile, event: string): Promise<GateOptions>
  gateActivity(viewer: Profile, event: string, gate: string): Promise<GateActivity>
  monitor(viewer: Profile, event: string): Promise<MonitorSnapshot>
  auditGates(viewer: Profile): Promise<Pick<Gate, 'id' | 'event_id' | 'name'>[]>
  audit(viewer: Profile, filters: AuditFilters, offset: number, limit: number): Promise<AuditPage>
  limits(viewer: Profile, event: string | null): Promise<SecurityLimits>
  saveLimits(viewer: Profile, event: string | null, limits: SecurityLimits): Promise<void>
  certificateSetup(viewer: Profile, event: string): Promise<CertificateSetup>
  saveCertificate(viewer: Profile, event: string, input: CertificateInput): Promise<void>
  saveActivity(viewer: Profile, event: string, id: string | null, name: string, required: boolean): Promise<void>
  recordActivity(viewer: Profile, event: string, id: string, email: string, present: boolean): Promise<void>
  myCertificates(viewer: Profile): Promise<CertificateEvent[]>
  issue(viewer: Profile, event: string): Promise<CertificateRecord>
  revoke(viewer: Profile, event: string, id: string): Promise<void>
  verify(code: string): Promise<Verification>
}
