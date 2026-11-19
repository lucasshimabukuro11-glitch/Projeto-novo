import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { subscribeToPostgres } from './realtime.mjs'

const baseUrl = process.env.EVENTPASS_TEST_API_URL ?? 'http://127.0.0.1:54321'
const databaseUrl = process.env.EVENTPASS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const publicKey = process.env.EVENTPASS_TEST_PUBLIC_KEY

function ensureLocal(url) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'Use uma instância local e descartável do Supabase.')
}

function client() {
  return createClient(baseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function ok(request) {
  const { data, error } = await request
  assert.equal(error, null, error?.message)
  return data
}

function rpc(actor, name, params) {
  return actor.client.rpc(name, params)
}

async function rejected(request, message) {
  const { error } = await request
  assert.ok(error, 'A operação deveria ser rejeitada.')
  if (message) assert.match(error.message, message)
}

function eventFields(title, capacity) {
  return {
    p_title: title, p_description: 'Evento fictício criado pela suíte de integração do EventScan.',
    p_category: 'Educação', p_cover_url: null, p_starts_at: new Date(Date.now() + 86400000).toISOString(),
    p_venue: 'Auditório da faculdade, Rua Teste, 10', p_city: 'São Paulo, SP', p_capacity: capacity,
  }
}

async function race(db, eventId, functionName, requests) {
  const blocker = new pg.Client({ connectionString: databaseUrl })
  await blocker.connect()
  let pending
  try {
    await blocker.query('begin')
    await blocker.query('select id from public.events where id = $1 for update', [eventId])
    pending = Promise.all(requests.map(request => request()))
    const deadline = Date.now() + 6000
    let waiting = 0
    while (waiting < requests.length && Date.now() < deadline) {
      const { rows } = await db.query(
        "select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and query like $1",
        ['%' + functionName + '%'],
      )
      waiting = rows[0].waiting
      if (waiting < requests.length) await delay(25)
    }
    assert.equal(waiting, requests.length, 'As duas operações precisam estar aguardando a mesma linha.')
    await blocker.query('commit')
    return await pending
  } finally {
    await blocker.end()
    await pending
  }
}

test('fluxo autenticado, políticas e concorrência no Supabase local', async t => {
  ensureLocal(baseUrl)
  ensureLocal(databaseUrl)
  assert.ok(publicKey, 'Informe EVENTPASS_TEST_PUBLIC_KEY com a chave pública do Supabase local.')
  assert.ok(publicKey.startsWith('sb_publishable_') ||
    (publicKey.includes('.') && JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url')).role === 'anon'),
  'A suíte usa apenas a chave pública nas chamadas da API.')

  const db = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 })
  await db.connect()
  const runId = randomUUID().slice(0, 10)
  const users = []
  const events = []
  const anonymous = client()
  let cover
  let owner, staff, first, second, otherOrganizer, admin, mainEvent, raceEvent, firstTicket, cancelledTicket
  const createdAtStart = new Date().toISOString()

  async function user(label, role = 'participant') {
    const actor = { client: client(), email: `${label}-${runId}@example.test` }
    const result = await ok(actor.client.auth.signUp({
      email: actor.email,
      password: randomUUID(),
      options: { data: { display_name: 'Teste ' + label, role: 'admin' } },
    }))
    actor.id = result.user.id
    users.push(actor)
    assert.ok(result.session, 'O Supabase local deve estar configurado para confirmar automaticamente o e-mail.')
    const profile = await ok(actor.client.from('profiles').select('*').eq('id', actor.id).single())
    assert.equal(profile.role, 'participant')
    assert.equal(profile.email, actor.email)
    if (role !== 'participant') await db.query('update public.profiles set role = $1 where id = $2', [role, actor.id])
    return actor
  }

  try {
    await t.test('cadastro real cria participante e só expõe o próprio perfil', async () => {
      owner = await user('organizador', 'organizer')
      staff = await user('funcionario')
      first = await user('primeiro')
      second = await user('segundo')
      otherOrganizer = await user('outro-organizador', 'organizer')
      admin = await user('administrador', 'admin')
      const self = await ok(first.client.from('profiles').select('id'))
      assert.deepEqual(self, [{ id: first.id }])
      await rejected(first.client.from('profiles').update({ role: 'admin' }).eq('id', first.id))
      await rejected(anonymous.from('profiles').select('id'))
      await rejected(rpc(first, 'create_event', eventFields('Evento proibido', 10)), /Apenas organizadores/)
    })

    await t.test('organizador envia capa e publica; catálogo e RLS escondem rascunhos', async () => {
      const photo = await readFile(new URL('../public/images/technology.webp', import.meta.url))
      const flags = { contentType: 'image/webp', upsert: false }
      const file = `${owner.id}/teste-${runId}.webp`
      await rejected(first.client.storage.from('event-covers').upload(file, photo, flags))
      await ok(owner.client.storage.from('event-covers').upload(file, photo, flags))
      cover = file
      const coverUrl = owner.client.storage.from('event-covers').getPublicUrl(file).data.publicUrl
      const uploaded = await fetch(coverUrl)
      assert.equal(uploaded.status, 200)
      assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), photo)

      mainEvent = await ok(rpc(owner, 'create_event', { ...eventFields('Evento principal ' + runId, 2), p_cover_url: coverUrl }))
      events.push(mainEvent.id)
      raceEvent = await ok(rpc(owner, 'create_event', eventFields('Vaga única ' + runId, 1)))
      events.push(raceEvent.id)
      assert.equal(mainEvent.status, 'draft')
      assert.equal(mainEvent.owner_id, owner.id)
      assert.deepEqual(await ok(anonymous.from('events').select('id').in('id', events)), [])
      assert.deepEqual(await ok(otherOrganizer.client.from('events').select('id').in('id', events)), [])
      await rejected(first.client.from('events').update({ status: 'published' }).eq('id', mainEvent.id))
      await rejected(rpc(otherOrganizer, 'set_event_status', { p_event: mainEvent.id, p_status: 'published' }), /não pode gerenciar/)
      for (const id of events) {
        await ok(rpc(owner, 'set_event_status', { p_event: id, p_status: 'published' }))
      }
      assert.equal((await ok(anonymous.from('events').select('id').in('id', events))).length, 2)
    })

    await t.test('equipe é atribuída por evento e organizador alheio não altera permissões', async () => {
      const input = { p_event: mainEvent.id, p_email: staff.email }
      await rejected(rpc(otherOrganizer, 'assign_event_staff', input), /não pode gerenciar/)
      await ok(rpc(owner, 'assign_event_staff', input))
      const sources = await ok(rpc(staff, 'list_checkin_events'))
      assert.deepEqual(sources.map(row => row.id), [mainEvent.id])
      const assigned = await ok(rpc(owner, 'event_team', { p_event: mainEvent.id }))
      assert.equal(assigned[0].id, staff.id)
      assert.deepEqual(await ok(rpc(first, 'list_checkin_events')), [])
    })

    await t.test('reserva emite UUID, evita cópia duplicada e protege códigos e lista de inscritos', async () => {
      await rejected(anonymous.rpc('reserve_ticket', { p_event: mainEvent.id }))
      firstTicket = await ok(rpc(first, 'reserve_ticket', { p_event: mainEvent.id }))
      cancelledTicket = await ok(rpc(second, 'reserve_ticket', { p_event: mainEvent.id }))
      assert.match(firstTicket.code, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      assert.notEqual(firstTicket.code, cancelledTicket.code)
      assert.equal((await ok(rpc(first, 'reserve_ticket', { p_event: mainEvent.id }))).id, firstTicket.id)
      await rejected(rpc(staff, 'reserve_ticket', { p_event: mainEvent.id }), /lotado/)
      await rejected(first.client.from('tickets').insert({ event_id: mainEvent.id, participant_id: first.id }))
      assert.deepEqual(await ok(staff.client.from('tickets').select('code').eq('event_id', mainEvent.id)), [])
      assert.deepEqual(await ok(owner.client.from('tickets').select('code').eq('event_id', mainEvent.id)), [])
      const list = await ok(rpc(owner, 'event_roster', { p_event: mainEvent.id }))
      assert.equal(list.length, 2)
      assert.ok(list.every(row => !('code' in row)))
      await rejected(rpc(staff, 'event_roster', { p_event: mainEvent.id }), /não pode consultar/)
      const tickets = await ok(first.client.from('tickets')
        .select('id, event:events!tickets_event_id_fkey(title)').eq('event_id', mainEvent.id))
      assert.equal(tickets[0].event.title, mainEvent.title)
    })

    await t.test('duas reservas bloqueadas simultaneamente disputam a última vaga', async () => {
      const reserve = actor => () => rpc(actor, 'reserve_ticket', { p_event: raceEvent.id })
      const results = await race(db, raceEvent.id, 'reserve_ticket', [reserve(first), reserve(second)])
      assert.equal(results.filter(result => !result.error).length, 1)
      const failure = results.find(result => result.error)
      assert.match(failure.error.message, /lotado/)
      const tally = await db.query('select capacity, reserved_count from public.events where id = $1', [raceEvent.id])
      assert.deepEqual(tally.rows, [{ capacity: 1, reserved_count: 1 }])
      const count = await db.query('select count(*)::int as total from public.tickets where event_id = $1', [raceEvent.id])
      assert.equal(count.rows[0].total, 1)
    })

    await t.test('validação rejeita acesso indevido, código inexistente, outro evento e cancelado', async () => {
      const validate = (actor, event, code) => ok(rpc(actor, 'validate_ticket', { p_event: event, p_code: code }))
      const params = { p_event: mainEvent.id, p_code: firstTicket.code }
      await rejected(anonymous.rpc('validate_ticket', params))
      assert.equal((await validate(first, mainEvent.id, firstTicket.code)).status, 'forbidden')
      assert.equal((await validate(otherOrganizer, mainEvent.id, firstTicket.code)).status, 'forbidden')
      assert.equal((await validate(admin, mainEvent.id, firstTicket.code)).status, 'forbidden')
      assert.equal((await validate(staff, mainEvent.id, 'inválido')).status, 'not_found')
      assert.equal((await validate(staff, mainEvent.id, randomUUID())).status, 'not_found')
      assert.equal((await validate(owner, raceEvent.id, firstTicket.code)).status, 'wrong_event')
      await rejected(staff.client.from('check_ins').insert({ event_id: mainEvent.id, ticket_id: firstTicket.id, validated_by: staff.id, checked_in_at: new Date().toISOString() }))
      await ok(rpc(owner, 'cancel_ticket', { p_event: mainEvent.id, p_ticket: cancelledTicket.id }))
      assert.equal((await validate(staff, mainEvent.id, cancelledTicket.code)).status, 'cancelled')
      await rejected(rpc(second, 'reserve_ticket', { p_event: mainEvent.id }), /cancelado/)
      const replacement = await ok(rpc(staff, 'reserve_ticket', { p_event: mainEvent.id }))
      assert.notEqual(replacement.id, cancelledTicket.id)
    })

    await t.test('só uma leitura simultânea registra check-in e o painel recebe o novo total', async () => {
      const before = await ok(rpc(owner, 'dashboard_snapshot'))
      let notification
      const realtime = owner.client.channel('test-event-' + runId)
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'events', filter: 'id=eq.' + mainEvent.id,
        }, message => { notification = message.new })
      await subscribeToPostgres(realtime)

      const validate = actor => () => rpc(actor, 'validate_ticket', { p_event: mainEvent.id, p_code: firstTicket.code })
      const [one, two] = await race(db, mainEvent.id, 'validate_ticket', [validate(owner), validate(staff)])
      assert.equal(one.error, null)
      assert.equal(two.error, null)
      assert.deepEqual([one.data.status, two.data.status].sort(), ['used', 'valid'])
      assert.equal(one.data.checked_in_at, two.data.checked_in_at)
      assert.ok(Date.parse(one.data.checked_in_at) >= Date.parse(createdAtStart))

      const after = await ok(rpc(owner, 'dashboard_snapshot'))
      assert.equal(after.totals.present, before.totals.present + 1)
      for (let i = 0; notification?.present_count !== 1 && i < 50; i += 1) await delay(100)
      assert.equal(notification?.present_count, 1, 'O Realtime deve enviar o novo total após o commit.')
      await owner.client.removeChannel(realtime)
      assert.equal(after.totals.issued, 4)
      assert.equal(after.totals.reserved, 3)
      assert.ok(after.activity.some(row => row.id === firstTicket.id && row.kind === 'checked_in'))
      await rejected(rpc(staff, 'dashboard_snapshot'), /não pode acessar/)
      const log = await ok(owner.client.from('check_ins').select('*').eq('ticket_id', firstTicket.id))
      assert.equal(log.length, 1)
      assert.equal(log[0].validated_by, one.data.status === 'valid' ? owner.id : staff.id)
      assert.equal(log[0].checked_in_at, one.data.checked_in_at)
      const ticket = await ok(first.client.from('tickets').select('checked_in_at').eq('id', firstTicket.id).single())
      assert.equal(ticket.checked_in_at, log[0].checked_in_at)
    })

    await t.test('admin consulta contas e eventos; revogar equipe e cancelar evento invalidam acesso', async () => {
      const accounts = await ok(admin.client.from('profiles').select('id,role').in('id', users.map(row => row.id)))
      assert.equal(accounts.length, users.length)
      assert.equal(accounts.filter(row => row.role === 'organizer').length, 2)
      const snapshot = await ok(rpc(admin, 'dashboard_snapshot'))
      assert.ok(snapshot.accounts.organizers >= 2)
      assert.ok(snapshot.totals.events >= 2)
      await ok(rpc(owner, 'remove_event_staff', { p_event: mainEvent.id, p_user: staff.id }))
      const args = { p_event: mainEvent.id, p_code: firstTicket.code }
      assert.equal((await ok(rpc(staff, 'validate_ticket', args))).status, 'forbidden')
      await ok(rpc(owner, 'set_event_status', { p_event: mainEvent.id, p_status: 'cancelled' }))
      assert.equal((await ok(rpc(owner, 'validate_ticket', args))).status, 'cancelled')
      assert.deepEqual(await ok(anonymous.from('events').select('id').eq('id', mainEvent.id)), [])
      const ownTicket = await ok(first.client.from('tickets')
        .select('event:events!tickets_event_id_fkey(status)').eq('id', firstTicket.id).single())
      assert.equal(ownTicket.event.status, 'cancelled')
    })
  } finally {
    if (cover && owner) await owner.client.storage.from('event-covers').remove([cover])
    if (events.length) {
      await db.query('delete from public.check_ins where event_id = any($1)', [events])
      await db.query('delete from public.tickets where event_id = any($1)', [events])
      await db.query('delete from public.events where id = any($1)', [events])
    }
    if (users.length) await db.query('delete from auth.users where id = any($1)', [users.map(row => row.id)])
    for (const actor of users) await actor.client.removeAllChannels()
    await db.end()
  }
})
