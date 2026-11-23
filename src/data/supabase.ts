import { createClient } from '@supabase/supabase-js'
import type { Admission } from './expansion/types'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { SupabaseConfig } from './supabase-config'
import { coverTypes, maxCoverSize, pageSize, randomUuid, ticketCodePattern, toPage } from './domain'
import type { CheckInResult, DashboardSnapshot, DataService, EventInput, EventRecord, Profile, RosterEntry, TeamMember, Ticket, TicketWithEvent } from './types'

declare const __EVENTSCAN_SUPABASE_CONFIG__: SupabaseConfig
const config = __EVENTSCAN_SUPABASE_CONFIG__

export const configIssue = config.mode === 'invalid' ? config.message : null
export const supabase = config.mode === 'supabase' ? createClient(config.url, config.key) : null
export const isDemo = config.mode === 'demo'

type Response = { data: unknown; error: { message: string } | null }

export function value<T>(response: Response): T {
  if (response.error) throw new Error(response.error.message)
  return response.data as T
}

async function allRows<T>(fetch: (start: number, end: number) => PromiseLike<Response>) {
  const rows: T[] = []
  const limit = 250
  for (let start = 0; ; start += limit) {
    const batch = value<T[]>(await fetch(start, start + limit - 1))
    rows.push(...batch)
    if (batch.length < limit) return rows
  }
}

export async function loadProfile(userId: string) {
  if (!supabase) throw new Error('Configure o acesso ao Supabase.')
  return value<Profile>(await supabase.from('profiles').select('*').eq('id', userId).single())
}

function createDataService(client: NonNullable<typeof supabase>): DataService {
  const listeners = new Set<() => void>()
  let channel: RealtimeChannel | null = null
  let channelVersion = 0

  async function saveEvent(
    actor: Profile, input: EventInput, file?: File, event?: { id: string; revision: number },
  ) {
    let object: string | undefined
    let coverUrl = input.cover_url
    const bucket = client.storage.from('event-covers')
    if (file) {
      if (!coverTypes.includes(file.type) || file.size > maxCoverSize) {
        throw new Error('Use uma imagem JPEG, PNG, WebP ou AVIF de até 5 MB.')
      }
      const extension = file.type.split('/')[1]
      object = `${actor.id}/${randomUuid()}.${extension}`
      value(await bucket.upload(object, file, { contentType: file.type, cacheControl: '3600' }))
      coverUrl = bucket.getPublicUrl(object).data.publicUrl
    }
    const result = await client.rpc(event ? 'update_event' : 'create_event', {
      ...(event ? { p_event: event.id, p_revision: event.revision } : {}),
      p_title: input.title, p_description: input.description, p_category: input.category, p_cover_url: coverUrl,
      p_starts_at: input.starts_at, p_venue: input.venue, p_city: input.city, p_capacity: input.capacity,
    })
    // Clean up only for an explicit database rejection, since a network failure can follow a commit.
    if (object && result.error && /^(22|23|42)[0-9A-Z]{3}$/.test(result.error.code)) await bucket.remove([object])
    return value<EventRecord>(result)
  }

  return {
    publicEvents: () => {
      const now = new Date().toISOString()
      return allRows<EventRecord>((from, to) => client.from('events').select('*')
        .eq('status', 'published').gt('starts_at', now).order('starts_at').order('id').range(from, to))
    },

    async event(id) {
      if (!ticketCodePattern.test(id)) return null
      return value<EventRecord | null>(await client.from('events').select('*').eq('id', id).maybeSingle())
    },

    async myTickets(actor) {
      const [tickets, admissions] = await Promise.all([
        allRows<TicketWithEvent>((from, to) => client.from('tickets')
          .select('*, event:events!tickets_event_id_fkey(*)')
          .eq('participant_id', actor.id).order('issued_at', { ascending: false }).order('id').range(from, to)),
        allRows<{ id: string; details: Admission }>((from, to) => client.rpc('my_ticket_admissions').range(from, to)),
      ])
      const byId = new Map(admissions.map(row => [row.id, row.details]))
      return tickets.map(ticket => ({ ...ticket, admission: byId.get(ticket.id) }))
    },

    async reserve(_actor, eventId) {
      return value<Ticket>(await client.rpc('reserve_ticket', { p_event: eventId }))
    },

    create: (actor, input, file) => saveEvent(actor, input, file),

    update: (actor, id, revision, input, file) => saveEvent(actor, input, file, { id, revision }),

    async changeStatus(_actor, eventId, status) {
      return value<EventRecord>(await client.rpc('set_event_status', { p_event: eventId, p_status: status }))
    },

    managedEvents: actor => allRows<EventRecord>((from, to) => {
      const query = client.from('events').select('*')
      if (actor.role === 'organizer') query.eq('owner_id', actor.id)
      return query.order('created_at', { ascending: false }).order('id').range(from, to)
    }),

    checkInEvents: () => allRows<EventRecord>((from, to) => client.rpc('list_checkin_events').range(from, to)),

    async validate(_actor, eventId, code, gate = null) {
      return value<CheckInResult>(await client.rpc('validate_at_gate', { p_event: eventId, p_code: code, p_gate: gate }))
    },

    async dashboard() {
      return value<DashboardSnapshot>(await client.rpc('dashboard_snapshot'))
    },

    async roster(_actor, eventId, page) {
      const start = page * pageSize
      return toPage(value<RosterEntry[]>(await client.rpc('event_roster', { p_event: eventId }).range(start, start + pageSize)))
    },

    async cancelTicket(_actor, eventId, ticketId) {
      value(await client.rpc('cancel_ticket', { p_event: eventId, p_ticket: ticketId }))
    },

    team: (_actor, eventId) => allRows<TeamMember>((from, to) => client.rpc('event_team', { p_event: eventId }).range(from, to)),

    async assignStaff(_actor, eventId, email) {
      value(await client.rpc('assign_event_staff', { p_event: eventId, p_email: email }))
    },

    async removeStaff(_actor, eventId, userId) {
      value(await client.rpc('remove_event_staff', { p_event: eventId, p_user: userId }))
    },

    async accounts(_actor, page, onlyOrganizers) {
      const start = page * pageSize
      const query = client.from('profiles').select('*')
      if (onlyOrganizers) query.eq('role', 'organizer')
      return toPage(value<Profile[]>(await query.order('created_at', { ascending: false }).order('id').range(start, start + pageSize)))
    },

    watch(listener) {
      listeners.add(listener)
      if (!channel) {
        channelVersion += 1
        const notify = () => { for (const subscriber of listeners) subscriber() }
        channel = client.channel(`eventpass-events-${channelVersion}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, notify)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'event_activity' }, notify)
          .on('system', {}, ({ extension, status }) => {
            if (extension === 'postgres_changes' && status === 'ok') notify()
          })
          .subscribe()
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size && channel) {
          const previous = channel
          channel = null
          void client.removeChannel(previous)
        }
      }
    },
  }
}

export const realData = supabase ? createDataService(supabase) : null
