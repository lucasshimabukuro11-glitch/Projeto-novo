import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const api = process.env.EVENTPASS_TEST_API_URL ?? 'http://127.0.0.1:54321'
const database = process.env.EVENTPASS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const key = process.env.EVENTPASS_TEST_PUBLIC_KEY
const loopback = ['localhost', '127.0.0.1', '[::1]']

function client() {
  return createClient(api, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function ok(request) {
  const { data, error } = await request
  assert.equal(error, null, error?.message)
  return data
}

async function denied(request, reason) {
  const { error } = await request
  assert.ok(error, 'A operação deveria ser rejeitada.')
  if (reason) assert.match(error.message, reason)
}

test('solicitação, revisão e edição segura de evento no Supabase local', async t => {
  assert.ok(key && loopback.includes(new URL(api).hostname) && loopback.includes(new URL(database).hostname),
    'Configure as variáveis do Supabase local.')
  assert.ok(key.startsWith('sb_publishable_') || (key.includes('.') &&
    JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'), 'Use a chave pública local.')

  const db = new pg.Client({ connectionString: database })
  const users = []
  const events = []
  const suffix = randomUUID().slice(0, 8)
  const anonymous = client()
  await db.connect()

  async function actor(name, role) {
    const sdk = client()
    const email = `${name}-${suffix}@example.test`
    const { user, session } = await ok(sdk.auth.signUp({
      email, password: 'Test-' + randomUUID(), options: { data: { display_name: name, role: 'admin' } },
    }))
    assert.ok(session, 'O Supabase local deve confirmar os e-mails da suíte.')
    users.push(user.id)
    if (role) await db.query('update public.profiles set role = $1 where id = $2', [role, user.id])
    return { id: user.id, email, sdk }
  }

  const request = who => who.sdk.rpc('request_organizer', {
    p_organization_name: '   Faculdade EventScan   ', p_contact_email: 'contato@example.test', p_city: 'São Paulo',
  })
  const review = (who, id, decision) => who.sdk.rpc('review_organizer_application', { p_application: id, p_decision: decision })
  const roleOf = who => ok(who.sdk.from('profiles').select('role').eq('id', who.id).single()).then(x => x.role)
  const metadata = {
    p_title: 'Congresso de integração ' + suffix, p_description: 'Evento fictício de teste com reservas preservadas.',
    p_category: 'Educação', p_cover_url: '/images/technology.webp', p_starts_at: new Date(Date.now() + 86400000).toISOString(),
    p_venue: 'Auditório central', p_city: 'São Paulo', p_capacity: 12,
  }

  try {
    const applicant = await actor('solicitante')
    const participant = await actor('participante')
    const organizer = await actor('organizador', 'organizer')
    const admin = await actor('administrador', 'admin')
    let application

    await t.test('contas novas são participantes e só leem suas próprias solicitações', async () => {
      assert.equal(await roleOf(applicant), 'participant')
      application = await ok(request(applicant))
      assert.equal(application.status, 'pending')
      assert.equal(application.organization_name, 'Faculdade EventScan')
      assert.equal((await ok(request(applicant))).id, application.id)
      assert.deepEqual(await ok(participant.sdk.from('organizer_applications').select('id').eq('id', application.id)), [])
      assert.deepEqual(await ok(organizer.sdk.from('organizer_applications').select('id').eq('id', application.id)), [])
      await denied(anonymous.from('organizer_applications').select('id'))
      await denied(applicant.sdk.from('organizer_applications').update({ status: 'approved' }).eq('id', application.id))
      await denied(applicant.sdk.rpc('create_event', metadata), /Apenas organizadores/)
    })

    await t.test('apenas admin revisa, preserva o histórico e atualiza o perfil na mesma transação', async () => {
      await denied(review(applicant, application.id, 'approved'), /Apenas administradores/)
      await denied(review(organizer, application.id, 'approved'), /Apenas administradores/)
      const list = await ok(admin.sdk.from('organizer_applications')
        .select('status, applicant:profiles!organizer_applications_applicant_id_fkey(email)').eq('id', application.id).single())
      assert.equal(list.applicant.email, applicant.email)

      const rejected = await ok(review(admin, application.id, 'rejected'))
      assert.equal(rejected.reviewed_by, admin.id)
      assert.equal(await roleOf(applicant), 'participant')
      await denied(review(admin, application.id, 'approved'), /já foi revisada/)
      const pending = await ok(request(applicant))
      assert.notEqual(pending.id, application.id)
      const approval = await ok(review(admin, pending.id, 'approved'))
      assert.equal((await ok(review(admin, pending.id, 'approved'))).reviewed_at, approval.reviewed_at)
      assert.equal(approval.reviewed_by, admin.id)
      assert.equal(await roleOf(applicant), 'organizer')
      const history = await ok(applicant.sdk.from('organizer_applications').select('status'))
      assert.deepEqual(history.map(row => row.status).sort(), ['approved', 'rejected'])
      await denied(request(applicant), /Apenas participantes/)
    })

    await t.test('proprietário edita informações sem alterar reservas, check-in ou setor', async () => {
      const event = await ok(applicant.sdk.rpc('create_event', metadata))
      events.push(event.id)
      await ok(applicant.sdk.rpc('set_event_status', { p_event: event.id, p_status: 'published' }))
      const ticket = await ok(participant.sdk.rpc('reserve_ticket', { p_event: event.id }))
      await ok(applicant.sdk.rpc('save_event_option', {
        p_event: event.id, p_kind: 'sector', p_data: { name: 'Sala', capacity: 6, seated: false },
      }))
      const input = { ...metadata, p_event: event.id, p_revision: 0, p_title: 'Congresso atualizado', p_venue: 'Auditório Sul' }
      const update = (who, params = input) => who.sdk.rpc('update_event', params)
      await denied(update(participant), /Você não pode editar/)
      await denied(update(organizer), /Você não pode editar/)
      await denied(update(admin), /Você não pode editar/)
      await denied(update(applicant, { ...input, p_capacity: 5 }), /vagas dos setores/)
      const after = await ok(update(applicant, { ...input, p_capacity: 8 }))
      assert.equal(after.id, event.id)
      assert.equal(after.status, 'published')
      assert.equal(after.details_revision, 1)
      assert.equal(after.capacity, 8)
      assert.equal(after.reserved_count, 1)
      await denied(update(applicant), /dados do evento mudaram/)

      const original = await ok(participant.sdk.from('tickets').select('id, code, event:events(title, venue)').eq('id', ticket.id).single())
      assert.deepEqual(original, { id: ticket.id, code: ticket.code, event: { title: input.p_title, venue: input.p_venue } })
      const checkIn = await ok(applicant.sdk.rpc('validate_ticket', { p_event: event.id, p_code: ticket.code }))
      assert.equal(checkIn.status, 'valid')
      const duplicate = await ok(applicant.sdk.rpc('validate_ticket', { p_event: event.id, p_code: ticket.code }))
      assert.equal(duplicate.status, 'used')
      await ok(applicant.sdk.rpc('set_event_status', { p_event: event.id, p_status: 'cancelled' }))
      await denied(update(applicant, { ...input, p_revision: 1 }), /Eventos cancelados/)
    })

    await t.test('aprovação posterior preserva a elegibilidade de ingressos anteriores', async () => {
      const event = await ok(organizer.sdk.rpc('create_event', { ...metadata, p_title: 'Certificado preservado ' + suffix }))
      events.push(event.id)
      await ok(organizer.sdk.rpc('set_event_status', { p_event: event.id, p_status: 'published' }))
      const ticket = await ok(participant.sdk.rpc('reserve_ticket', { p_event: event.id }))
      const scan = await ok(organizer.sdk.rpc('validate_ticket', { p_event: event.id, p_code: ticket.code }))
      assert.equal(scan.status, 'valid')
      await ok(organizer.sdk.rpc('save_certificate_settings', {
        p_event: event.id, p_settings: {
          enabled: true, event_name: 'Certificado de teste', organizer_name: 'Faculdade', hours: 2,
          event_date: new Date().toISOString().slice(0, 10), participation_text: 'Participou do encontro.',
          logo_url: null, signature_url: null, completes_at: null, completed: true,
        },
      }))
      const before = await ok(participant.sdk.rpc('my_certificate_events'))
      assert.ok(before.some(row => row.event_id === event.id && row.eligibility === 'eligible'))
      const pending = await ok(request(participant))
      await ok(review(admin, pending.id, 'approved'))
      assert.equal(await roleOf(participant), 'organizer')
      const issued = await ok(participant.sdk.rpc('issue_certificate', { p_event: event.id }))
      assert.equal(issued.event_id, event.id)
      const proof = await ok(anonymous.rpc('verify_certificate', { p_code: issued.code }))
      assert.equal(proof.status, 'valid')
      await denied(applicant.sdk.rpc('issue_certificate', { p_event: event.id }), /requisitos/)
    })
  } finally {
    try {
      if (events.length) {
        await db.query('delete from public.check_ins where event_id = any($1)', [events])
        await db.query('delete from public.tickets where event_id = any($1)', [events])
        await db.query('delete from public.events where id = any($1)', [events])
      }
      if (users.length) await db.query('delete from auth.users where id = any($1)', [users])
    } finally {
      await db.end()
    }
  }
})
