import { randomUuid } from './domain'
import type { EventRecord, Profile, Ticket } from './types.ts'

export interface DemoState {
  profiles: Profile[]
  events: EventRecord[]
  tickets: Ticket[]
  staff: { eventId: string; userId: string }[]
  checkIns: { ticketId: string; validatorId: string; time: string }[]
}

export const demoAccounts = {
  participant: { id: 'demo-participante', display_name: 'Marina Costa', email: 'marina@example.test', role: 'participant' },
  organizer: { id: 'demo-organizador', display_name: 'Rafael Almeida', email: 'organizador@example.test', role: 'organizer' },
  staff: { id: 'demo-equipe', display_name: 'Pedro Santos', email: 'equipe@example.test', role: 'participant' },
  admin: { id: 'demo-admin', display_name: 'Camila Rocha', email: 'admin@example.test', role: 'admin' },
} satisfies Record<string, Omit<Profile, 'created_at'>>

export type DemoPersona = keyof typeof demoAccounts

function futureDate(days: number, hour: number) {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hour + 3)).toISOString()
}

export function seedDemo(): DemoState {
  const now = new Date().toISOString()
  const owner_id = demoAccounts.organizer.id
  const base = { owner_id, status: 'published', is_demo: true, created_at: now } as const
  const events: EventRecord[] = [
    {
      ...base, id: 'aurora-music-festival', title: 'Aurora Music Festival', category: 'Música',
      cover_url: '/images/music.webp', starts_at: futureDate(22, 19),
      venue: 'Arena Aurora, Av. das Nações, 1400', city: 'São Paulo, SP', capacity: 120,
      description: 'Uma noite de música ao vivo, luzes e energia com artistas da cena eletrônica e indie.',
      reserved_count: 4, present_count: 2, issued_count: 4,
    },
    {
      ...base, id: 'tech-summit-brasil', title: 'Tech Summit Brasil', category: 'Tecnologia',
      cover_url: '/images/technology.webp', starts_at: futureDate(29, 9),
      venue: 'Centro de Convenções Horizonte, Rua Central, 220', city: 'São Paulo, SP', capacity: 80,
      description: 'Palestras e conversas sobre inovação, inteligência artificial e o futuro da tecnologia.',
      reserved_count: 2, present_count: 1, issued_count: 2,
    },
    {
      ...base, id: 'festival-sabores-da-cidade', title: 'Sabores da Cidade', category: 'Gastronomia',
      cover_url: '/images/food.webp', starts_at: futureDate(37, 16),
      venue: 'Praça do Mercado, Rua das Palmeiras, 25', city: 'Curitiba, PR', capacity: 60,
      description: 'Explore cozinhas locais, produtores artesanais e novos sabores em uma feira ao ar livre.',
      reserved_count: 1, present_count: 0, issued_count: 1,
    },
  ]
  const profiles: Profile[] = Object.values(demoAccounts).map(profile => ({ ...profile, created_at: now }))
  const tickets: Ticket[] = []
  const checkIns: DemoState['checkIns'] = []
  const names = ['Luiza Pereira', 'Bruno Lima', 'Sofia Martins', 'Ana Ribeiro', 'João Lopes', 'Helena Silva', 'Miguel Dias']
  let index = 0
  for (const event of events) {
    for (let attendee = 0; attendee < event.reserved_count; attendee += 1) {
      index += 1
      const id = `demo-inscrito-${index}`
      profiles.push({
        id, display_name: names[index - 1], email: `inscrito${index}@example.test`,
        role: 'participant', created_at: now,
      })
      const ticketId = `demo-ingresso-${index}`
      const issuedAt = new Date(Date.now() - (25 + index * 14) * 60_000).toISOString()
      const checkedAt = attendee < event.present_count ? new Date(Date.now() - index * 8 * 60_000).toISOString() : null
      tickets.push({
        id: ticketId, event_id: event.id, participant_id: id, code: randomUuid(),
        issued_at: issuedAt, checked_in_at: checkedAt, cancelled_at: null,
      })
      if (checkedAt) checkIns.push({ ticketId, validatorId: demoAccounts.staff.id, time: checkedAt })
    }
  }
  return { profiles, events, tickets, checkIns, staff: events.map(event => ({ eventId: event.id, userId: demoAccounts.staff.id })) }
}
