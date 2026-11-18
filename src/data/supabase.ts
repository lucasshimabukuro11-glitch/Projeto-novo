import { createClient } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { coverTypes, maxCoverSize, pageSize, randomUuid, ticketCodePattern, toPage } from './domain'
import type { CheckInResult, DashboardSnapshot, DataService, EventRecord, Profile, RosterEntry, TeamMember, Ticket, TicketWithEvent } from './types'

const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()

function canUseKey(value: string) {
  if (value.startsWith('sb_publishable_')) return true
  try {
    const payload = value.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')
    return JSON.parse(atob(payload)).role === 'anon'
  } catch {
    return false
  }
}

function validateConfig() {
  if (!url && !key) return null
  if (!url || !key) return 'Preencha a URL e a chave pública do Supabase no arquivo de ambiente.'
  if (!canUseKey(key)) return 'Configure uma chave publishable ou anon do Supabase.'
  try {
    if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error()
  } catch {
    return 'Informe uma URL do Supabase válida.'
  }
  return null
}

export const configIssue = validateConfig()
export const supabase = url && key && !configIssue ? createClient(url, key) : null
export const isDemo = !url && !key

type Response = { data: unknown; error: { message: string } | null }

function value<T>(response: Response): T {
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

    myTickets: actor => allRows<TicketWithEvent>((from, to) => client.from('tickets')
      .select('*, event:events!tickets_event_id_fkey(*)')
      .eq('participant_id', actor.id).order('issued_at', { ascending: false }).order('id').range(from, to)),

    async reserve(_actor, eventId) {
      return value<Ticket>(await client.rpc('reserve_ticket', { p_event: eventId }))
    },

    async create(actor, input, file) {
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
      const result = await client.rpc('create_event', {
        p_title: input.title, p_description: input.description, p_category: input.category, p_cover_url: coverUrl,
        p_starts_at: input.starts_at, p_venue: input.venue, p_city: input.city, p_capacity: input.capacity,
      })
      // Clean up only for an explicit database rejection, since a network failure can follow a commit.
      if (object && result.error && /^(22|23|42)[0-9A-Z]{3}$/.test(result.error.code)) await bucket.remove([object])
      return value<EventRecord>(result)
    },

    async changeStatus(_actor, eventId, status) {
      return value<EventRecord>(await client.rpc('set_event_status', { p_event: eventId, p_status: status }))
    },

    managedEvents: actor => allRows<EventRecord>((from, to) => {
      const query = client.from('events').select('*')
      if (actor.role === 'organizer') query.eq('owner_id', actor.id)
      return query.order('created_at', { ascending: false }).order('id').range(from, to)
    }),

    checkInEvents: () => allRows<EventRecord>((from, to) => client.rpc('list_checkin_events').range(from, to)),

    async validate(_actor, eventId, code) {
      return value<CheckInResult>(await client.rpc('validate_ticket', { p_event: eventId, p_code: code }))
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
        channel = client.channel(`eventpass-events-${channelVersion}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
            for (const subscriber of listeners) subscriber()
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
