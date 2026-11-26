import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const api = 'http://127.0.0.1:54321'
const publicKey = process.env.EVENTPASS_TEST_PUBLIC_KEY
const adminKey = process.env.EVENTSCAN_TEST_ADMIN_KEY
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
const suite = publicKey && adminKey ? test : test.skip

function client(token) {
  const global = token ? { headers: { Authorization: 'Bearer ' + token } } : undefined
  return createClient(api, publicKey, { auth, global })
}
function ok(response) {
  assert.ok(!response.error, response.error?.code ?? 'Resposta do Supabase')
  return response.data
}
function runAge(args, input) {
  const result = spawnSync('age', args, { input, stdio: ['pipe', 'pipe', 'ignore'] })
  assert.equal(result.status, 0, 'A operação age deve funcionar')
  return result.stdout
}

suite('provisiona quatro contas, protege a ativação e aplica RLS de produtos', { timeout: 90_000 }, async t => {
  const db = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
  await db.connect()
  const cloudAdmin = createClient(api, adminKey, { auth })
  const directory = mkdtempSync(join(tmpdir(), 'eventscan-local-provisioning-'))
  const run = randomUUID().slice(0, 10)
  const emails = ['admin', 'organizer-1', 'organizer-2', 'organizer-3', 'participant']
    .map(role => role + '-' + run + '@example.test')
  const events = []
  const categories = []
  const accounts = []
  let participant
  let bundle

  function provision(configuration) {
    return spawnSync(process.execPath, ['scripts/provision-eventscan-accounts.mjs', configuration], {
      env: {
        ...process.env, EVENTSCAN_SUPABASE_URL: api, EVENTSCAN_SUPABASE_PUBLISHABLE_KEY: publicKey,
        EVENTSCAN_SUPABASE_ADMIN_KEY: adminKey,
      },
      timeout: 45_000, encoding: 'utf8',
    })
  }

  try {
    await t.test('grava somente o pacote criptografado e verifica quatro logins no Auth', async () => {
      const identity = join(directory, 'identity.txt')
      const generated = spawnSync('age-keygen', ['-o', identity], { stdio: 'ignore' })
      assert.equal(generated.status, 0)
      const recipient = spawnSync('age-keygen', ['-y', identity], { encoding: 'utf8' }).stdout.trim()
      const config = join(directory, 'provision.json')
      const output = join(directory, 'access.age')
      writeFileSync(config, JSON.stringify({
        adminEmail: emails[0], organizerEmails: emails.slice(1, 4), recipient,
        bundlePath: output, siteUrl: 'http://localhost:4174',
      }), { mode: 0o600 })
      const result = provision(config)
      assert.equal(result.status, 0, result.stderr)
      assert.equal((result.stdout.match(/Login inicial validado no Auth/g) ?? []).length, 4)
      const encrypted = readFileSync(output)
      const decrypted = runAge(['--decrypt', '--identity', identity], encrypted)
      bundle = JSON.parse(decrypted.toString('utf8'))
      decrypted.fill(0)
      assert.equal(bundle.accounts.length, 4)
      assert.equal(new Set(bundle.accounts.map(account => account.temporaryPassword)).size, 4)
      for (const account of bundle.accounts) {
        assert.ok(account.temporaryPassword.length >= 35)
        assert.ok(!result.stdout.includes(account.temporaryPassword) && !result.stderr.includes(account.temporaryPassword))
        assert.ok(!encrypted.includes(account.temporaryPassword))
      }

      const repeated = provision(config)
      assert.equal(repeated.status, 0, repeated.stderr)
      assert.deepEqual(readFileSync(output), encrypted)
      const products = ok(await client().from('products').select('id,owner_id,category_id,image_url').eq('is_example', true))
      const owners = ok(await cloudAdmin.rpc('provisioned_account_plan', { p_emails: emails }))
      const scoped = products.filter(product => owners.some(owner => owner.id === product.owner_id))
      assert.equal(scoped.length, 18)
      assert.deepEqual(owners.filter(owner => owner.role === 'organizer')
        .map(owner => scoped.filter(product => product.owner_id === owner.id).length), [6, 6, 6])
      assert.ok(scoped.every(product => product.category_id && /^\/images\/products\/.+\.webp$/.test(product.image_url)))
      const seeded = ok(await cloudAdmin.rpc('seed_provisioned_events'))
      assert.deepEqual(seeded.map(row => [row.slot, Number(row.event_count), Number(row.certificate_event_count)]),
        [['admin', 0, 0], ['organizer-1', 3, 1], ['organizer-2', 3, 1], ['organizer-3', 3, 2]])
      const eventRecords = await db.query(`
        select s.event_id, s.owner_id, s.sample_number, e.is_demo, e.status,
               e.starts_at, cs.enabled, cs.completed_at,
               (select count(*) from public.certificate_activities ca
                where ca.event_id = e.id and ca.required) as activities
        from eventpass_private.provisioned_sample_events s
        join public.events e on e.id = s.event_id
        where s.owner_id = any($1)
      `, [owners.map(row => row.id)])
      assert.equal(eventRecords.rows.length, 9)
      const ticketOptions = await db.query(`
        select e.id,
          (select count(*) from public.event_sectors s where s.event_id = e.id) as sectors,
          (select count(*) from public.ticket_types t
            where t.event_id = e.id and t.active and t.per_person = 1) as ticket_types,
          (select count(*) from public.event_gates g where g.event_id = e.id) as gates
        from public.events e
        where e.id = any($1)
      `, [eventRecords.rows.map(row => row.event_id)])
      assert.ok(ticketOptions.rows.every(row => Number(row.sectors) === 1
        && Number(row.ticket_types) === 1 && Number(row.gates) === 1))
      assert.ok(eventRecords.rows.every(row => row.is_demo && row.status === 'published'
        && new Date(row.starts_at).getTime() > Date.now()))
      assert.equal(eventRecords.rows.filter(row => row.enabled).length, 4)
      assert.ok(eventRecords.rows.filter(row => row.enabled)
        .every(row => row.completed_at === null && Number(row.activities) === 1))
      const certificates = await db.query('select count(*) from public.certificates where event_id = any($1)',
        [eventRecords.rows.map(row => row.event_id)])
      assert.equal(Number(certificates.rows[0].count), 0)
      assert.deepEqual(ok(await cloudAdmin.rpc('seed_provisioned_events')), seeded)
      assert.ok((await client().rpc('seed_provisioned_events')).error,
        'O cadastro de eventos de exemplo é exclusivo da chave administrativa')

    })

    await t.test('rejeita operações de quatro sessões temporárias e invalida senhas iniciais após a troca', async () => {
      for (const account of bundle.accounts) {
        const original = client()
        const login = ok(await original.auth.signInWithPassword({ email: account.email, password: account.temporaryPassword }))
        const stale = client(login.session.access_token)
        assert.equal(ok(await original.rpc('account_credential_state')), 'password_required')
        assert.equal((await original.rpc('dashboard_snapshot')).error?.code, '42501')
        assert.equal((await original.rpc('complete_first_access')).error?.code, '42501')
        const samePassword = await original.auth.updateUser({ password: account.temporaryPassword })
        assert.ok(samePassword.error, 'A senha temporária é rejeitada como nova senha')
        const password = 'Nova-' + randomUUID()
        ok(await original.auth.updateUser({ password }))
        assert.equal(ok(await original.rpc('account_credential_state')), 'finish_required')
        ok(await original.rpc('complete_first_access'))
        assert.equal(ok(await stale.rpc('account_credential_state')), 'sign_in_required')
        assert.equal((await stale.rpc('dashboard_snapshot')).error?.code, '42501')
        assert.ok((await client().auth.signInWithPassword({ email: account.email, password: account.temporaryPassword })).error)

        const active = client()
        ok(await active.auth.signInWithPassword({ email: account.email, password }))
        assert.equal(ok(await active.rpc('account_credential_state')), 'active')
        ok(await active.rpc('dashboard_snapshot'))
        accounts.push({ sdk: active, id: login.user.id })
      }
    })

    await t.test('preserva cadastro de participantes e restringe categorias, produtos e promoção de papel', async () => {
      participant = client()
      const user = ok(await participant.auth.signUp({
        email: emails[4], password: 'Teste-' + randomUUID(),
        options: { data: { display_name: 'Participante de teste', eventscan_account_slot: 'admin' } },
      })).user
      assert.equal(ok(await participant.from('profiles').select('role').eq('id', user.id).single()).role, 'participant')
      const [admin, owner, other] = accounts
      const category = ok(await admin.sdk.from('product_categories').insert({ name: 'Acessórios ' + run }).select().single())
      categories.push(category.id)
      const input = { name: 'Acessório laboratório', category_id: category.id, price_cents: 1990, stock: 14, active: false }
      assert.equal((await participant.from('products').insert({ ...input, owner_id: user.id })).error?.code, '42501')
      assert.equal((await owner.sdk.from('products').insert({ ...input, owner_id: other.id })).error?.code, '42501')
      assert.equal((await owner.sdk.from('product_categories').insert({ name: 'Proibido' })).error?.code, '42501')
      const product = ok(await owner.sdk.from('products').insert({ ...input, owner_id: owner.id }).select().single())
      assert.deepEqual(ok(await other.sdk.from('products').select('id').eq('id', product.id)), [])
      assert.deepEqual(ok(await other.sdk.from('products').update({ stock: 0 }).eq('id', product.id).select('id')), [])
      assert.equal((await owner.sdk.from('products').update({ owner_id: other.id }).eq('id', product.id)).error?.code, '42501')
      assert.equal(ok(await owner.sdk.from('products').update({ stock: 11, active: true }).eq('id', product.id).select().single()).stock, 11)
      assert.equal(ok(await participant.from('products').select('stock').eq('id', product.id).single()).stock, 11)
      assert.deepEqual(ok(await other.sdk.from('products').delete().eq('id', product.id).select('id')), [])
      ok(await admin.sdk.from('products').update({ active: false }).eq('id', product.id).select().single())
      assert.deepEqual(ok(await participant.from('products').select('id').eq('id', product.id)), [])
      ok(await admin.sdk.from('product_categories').update({ active: false }).eq('id', category.id).select().single())
      assert.equal((await owner.sdk.from('products').insert({ ...input, owner_id: owner.id })).error?.code, '22023')

      const change = { p_account: user.id, p_expected_role: 'participant', p_new_role: 'organizer' }
      assert.equal((await participant.rpc('change_account_role', change)).error?.code, '42501')
      assert.equal((await participant.from('profiles').update({ role: 'admin' }).eq('id', user.id)).error?.code, '42501')
      assert.equal((await admin.sdk.rpc('change_account_role', {
        p_account: admin.id, p_expected_role: 'admin', p_new_role: 'participant',
      })).error?.code, '42501')
      const request = { p_organization_name: 'Organização de teste', p_contact_email: emails[4], p_city: 'São Paulo' }
      const application = ok(await participant.rpc('request_organizer', request))
      ok(await admin.sdk.rpc('change_account_role', change))
      assert.equal(ok(await participant.from('profiles').select('role').eq('id', user.id).single()).role, 'organizer')
      assert.equal(ok(await admin.sdk.from('organizer_applications').select('status').eq('id', application.id).single()).status, 'approved')
      const history = ok(await admin.sdk.rpc('recent_account_role_changes'))
      assert.equal(history[0].new_role, 'organizer')
      ok(await admin.sdk.rpc('change_account_role', { ...change, p_expected_role: 'organizer', p_new_role: 'participant' }))
      const applicationAgain = ok(await participant.rpc('request_organizer', request))
      assert.notEqual(applicationAgain.id, application.id)
      assert.ok((await participant.rpc('recent_account_role_changes')).error)
      assert.ok((await admin.sdk.rpc('seed_provisioned_products')).error)
    })

    await t.test('administrador consulta ingressos de um evento e organizador vê apenas seus próprios inscritos', async () => {
      const [admin, owner, other] = accounts
      const event = ok(await owner.sdk.rpc('create_event', {
        p_title: 'Evento acadêmico ' + run, p_description: 'Evento de teste de ingressos e permissões.',
        p_category: 'Educação', p_cover_url: null, p_starts_at: new Date(Date.now() + 86400000).toISOString(),
        p_venue: 'Auditório A', p_city: 'São Paulo', p_capacity: 10,
      }))
      events.push(event.id)
      ok(await owner.sdk.rpc('set_event_status', { p_event: event.id, p_status: 'published' }))
      ok(await participant.rpc('reserve_ticket', { p_event: event.id }))
      const roster = ok(await admin.sdk.rpc('event_roster', { p_event: event.id }))
      assert.equal(roster.length, 1)
      assert.equal(roster[0].email, emails[4])
      assert.equal(Object.hasOwn(roster[0], 'code'), false)
      assert.equal(ok(await owner.sdk.rpc('event_roster', { p_event: event.id })).length, 1)
      assert.equal((await other.sdk.rpc('event_roster', { p_event: event.id })).error?.code, '42501')
    })
  } finally {
    try {
      if (events.length) {
        await db.query('delete from public.tickets where event_id = any($1)', [events])
        await db.query('delete from public.events where id = any($1)', [events])
      }
      const fixtures = await db.query('select id from auth.users where email = any($1)', [emails])
      const ids = fixtures.rows.map(row => row.id)
      await db.query('delete from public.events where owner_id = any($1)', [ids])
      await db.query('delete from eventpass_private.account_role_changes where account_id = any($1)', [ids])
      await db.query('delete from auth.users where id = any($1)', [ids])
      if (categories.length) await db.query('delete from public.product_categories where id = any($1)', [categories])
    } finally {
      await db.end()
      rmSync(directory, { recursive: true, force: true })
    }
  }
})
