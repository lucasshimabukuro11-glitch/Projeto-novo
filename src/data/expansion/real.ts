import { supabase, value } from '../supabase'
import type { ExpansionService } from './types'

export function connectedExpansion(): ExpansionService {
  const client = supabase!
  async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return value<T>(await client.rpc(name, args))
  }

  return {
    setup: (_, event) => rpc('event_setup', { p_event: event }),
    saveOption: (_, event, kind, data) => rpc('save_event_option', { p_event: event, p_kind: kind, p_data: data }),
    options: event => rpc('event_ticket_options', { p_event: event }),
    map: sector => rpc('sector_seat_map', { p_sector: sector }),
    saveMap: (_, event, sector, map) => rpc('save_sector_map', {
      p_event: event, p_sector: sector, p_rows: map.rows, p_columns: map.columns, p_stage: map.stage, p_cells: map.cells,
    }),
    reserve: (_, event, type, seat, request) => rpc('reserve_typed_ticket', { p_event: event, p_type: type, p_seat: seat, p_request: request }),
    gates: (_, event) => rpc('checkin_gate_options', { p_event: event }),
    gateActivity: (_, event, gate) => rpc('gate_monitor', { p_event: event, p_gate: gate }),
    monitor: (_, event) => rpc('event_monitor', { p_event: event }),
    auditGates: async () => {
      const rows: Awaited<ReturnType<ExpansionService['auditGates']>> = []
      for (let offset = 0; ; offset += 250) {
        const part = value<typeof rows>(await client.rpc('audit_gates').range(offset, offset + 249))
        rows.push(...part)
        if (part.length < 250) return rows
      }
    },
    audit: (_, filters, offset, limit) => rpc('validation_audit', {
      p_event: filters.event, p_gate: filters.gate, p_result: filters.result, p_from: filters.from,
      p_until: filters.until, p_offset: offset, p_limit: limit,
    }),
    limits: (_, event) => rpc('get_security_limits', { p_event: event }),
    saveLimits: (_, event, limits) => rpc('save_security_limits', { p_event: event, p_limits: limits }),
    certificateSetup: (_, event) => rpc('certificate_setup', { p_event: event }),
    saveCertificate: (_, event, input) => rpc('save_certificate_settings', { p_event: event, p_settings: input }),
    saveActivity: (_, event, id, name, required) => rpc('save_certificate_activity', {
      p_event: event, p_activity: id, p_name: name, p_required: required,
    }),
    recordActivity: (_, event, id, email, present) => rpc('record_certificate_activity', {
      p_event: event, p_activity: id, p_email: email, p_present: present,
    }),
    myCertificates: () => rpc('my_certificate_events'),
    issue: (_, event) => rpc('issue_certificate', { p_event: event }),
    revoke: (_, event, id) => rpc('revoke_certificate', { p_event: event, p_certificate: id }),
    verify: code => rpc('verify_certificate', { p_code: code }),
  }
}
