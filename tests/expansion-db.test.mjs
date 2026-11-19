import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { subscribeToPostgres } from './realtime.mjs'

const api = process.env.EVENTPASS_TEST_API_URL ?? 'http://127.0.0.1:54321'
const database = process.env.EVENTPASS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const key = process.env.EVENTPASS_TEST_PUBLIC_KEY
const local = ['localhost', '127.0.0.1', '[::1]']

function client() {
  return createClient(api,key,{ auth: { autoRefreshToken: false,persistSession: false } })
}

async function ok(request) {
  const { data,error } = await request
  assert.equal(error,null,error?.message)
  return data
}

async function denied(request, expected) {
  const { error } = await request
  assert.ok(error,'Operação deveria ser rejeitada')
  if (expected) assert.match(error.message,expected)
}

async function simultaneous(db,event,name,requests) {
  const locker = new pg.Client({ connectionString: database })
  await locker.connect()
  let work
  try {
    await locker.query('begin')
    await locker.query('select id from public.events where id = $1 for update',[event])
    work = Promise.all(requests.map(task => task()))
    const start = Date.now()
    let count = 0
    while (count < requests.length && Date.now() - start < 5500) {
      count = Number((await db.query("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like $1",['%' + name + '%'])).rows[0].count)
      if (count < requests.length) await delay(30)
    }
    assert.equal(count,requests.length,'Requisições concorrentes devem aguardar o mesmo evento')
    await locker.query('commit')
    return await work
  } finally {
    await locker.end()
    await work
  }
}

test('EventScan 2.0 no Supabase local', async t => {
  assert.ok(key && local.includes(new URL(api).hostname) && local.includes(new URL(database).hostname),
    'Configure a chave pública e os endereços do Supabase local.')
  assert.ok(key.startsWith('sb_publishable_') || (key.includes('.') &&
    JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role === 'anon'), 'Use a chave pública local.')
  const db = new pg.Client({ connectionString: database })
  await db.connect()
  const seed = randomUUID().slice(0,8)
  const visitors = []
  const anonymous = client()
  let event, owner, employee, first, second, legacy, outsider, admin
  let room, vip, roomType, vipType, roomGate, vipGate, generalGate, seat, blocked, admitted, vipTicket
  let certificate, activity

  async function actor(label, role) {
    const connection = client()
    const email = `scan-${label}-${seed}@example.test`
    const auth = await ok(connection.auth.signUp({ email,password: 'Test-' + randomUUID(),options: { data: { display_name: label } } }))
    const user = { id: auth.user.id, email, client: connection }
    visitors.push(user)
    assert.ok(auth.session)
    if (role) await db.query('update public.profiles set role = $1 where id = $2',[role,user.id])
    return user
  }

  const rpc = (user,name,args) => user.client.rpc(name,args)
  const config = (kind, fields, user = owner) => rpc(user,'save_event_option',{ p_event: event.id,p_kind: kind,p_data: fields })
  const fetchOptions = () => ok(rpc(owner,'event_setup',{ p_event: event.id }))
  const reserve = (user,type,seatId,request = randomUUID()) => rpc(user,'reserve_typed_ticket',{
    p_event: event.id,p_type: type,p_seat: seatId,p_request: request,
  })
  const validate = (user,gate,code) => rpc(user,'validate_at_gate',{ p_event: event.id,p_gate: gate,p_code: code })
  const scope = user => rpc(user,'event_monitor',{ p_event: event.id })
  const audit = (user,gate = null,result = null) => rpc(user,'validation_audit',{
    p_event: event.id,p_gate: gate,p_result: result,p_from: null,p_until: null,p_offset: 0,p_limit: 200,
  })
  const issue = user => rpc(user,'issue_certificate',{ p_event: event.id })
  const verify = code => anonymous.rpc('verify_certificate',{ p_code: code })

  try {
    owner = await actor('Organizador','organizer')
    employee = await actor('Equipe')
    first = await actor('Primeiro')
    second = await actor('Segundo')
    outsider = await actor('Outro-organizador','organizer')
    admin = await actor('Administrador','admin')
    event = await ok(rpc(owner,'create_event',{
      p_title: 'Congresso de teste ' + seed,p_description: 'Evento fictício para validar a expansão do EventScan.',
      p_category: 'Educação',p_cover_url: null,p_starts_at: new Date(Date.now() + 86400000).toISOString(),
      p_venue: 'Auditório de teste',p_city: 'São Paulo',p_capacity: 5,
    }))
    await ok(rpc(owner,'set_event_status',{ p_event: event.id,p_status: 'published' }))
    legacy = await ok(rpc(first,'reserve_ticket',{ p_event: event.id }))

    await t.test('setores, modalidades e portarias são isolados pelo evento e preservam ingresso geral', async () => {
      await denied(config('sector',{ name: 'Tentativa',capacity: 1 },outsider),/não pode configurar/)
      await ok(config('sector',{ name: 'Auditório',capacity: 2,seated: true }))
      await ok(config('sector',{ name: 'Sala VIP',capacity: 2,seated: false }))
      await denied(config('sector',{ name: 'Excedente',capacity: 2 }),/soma dos setores/)
      const initial = await fetchOptions()
      room = initial.sectors.find(s => s.seated)
      vip = initial.sectors.find(s => !s.seated)
      await ok(config('type',{ name: 'Auditório',sector_id: room.id,capacity: 2,per_person: 1,color: '#8866ff',active: true }))
      await ok(config('type',{ name: 'VIP',sector_id: vip.id,capacity: 2,per_person: 2,color: '#eac274',active: true }))
      await ok(config('type',{ name: 'Cortesia',sector_id: vip.id,capacity: 2,per_person: 1,color: '#65ded4',active: true }))
      await ok(config('gate',{ name: 'Entrada geral' }))
      await ok(config('gate',{ name: 'Portaria auditório',sector_id: room.id }))
      await ok(config('gate',{ name: 'Portaria VIP',sector_id: vip.id }))
      const prepared = await fetchOptions()
      roomType = prepared.types.find(s => s.sector_id === room.id).id
      vipType = prepared.types.find(s => s.name === 'VIP').id
      assert.equal((await ok(scope(owner))).available,2,'Modalidades do mesmo setor compartilham a lotação.')
      roomGate = prepared.gates.find(s => s.sector_id === room.id).id
      vipGate = prepared.gates.find(s => s.sector_id === vip.id).id
      generalGate = prepared.gates.find(s => !s.sector_id).id
      await denied(anonymous.from('event_sectors').select('*'))
      await denied(rpc(second,'reserve_ticket',{ p_event: event.id }),/Selecione uma modalidade/)
      const old = await ok(rpc(first,'reserve_ticket',{ p_event: event.id }))
      assert.deepEqual([old.id,old.code,old.type_id],[legacy.id,legacy.code,null])
      assert.equal((await ok(validate(owner,generalGate,legacy.code))).status,'valid')
    })

    await t.test('mapa restringe assentos e duas transações não conseguem reservar o mesmo lugar', async () => {
      const mapArgs = { p_event: event.id,p_sector: room.id,p_rows: 1,p_columns: 4,p_stage: 'Palco',p_cells: { '1:1':'accessible','1:3':'aisle','1:4':'blocked' } }
      await denied(rpc(employee,'save_sector_map',mapArgs),/não pode editar/)
      await ok(rpc(owner,'save_sector_map',mapArgs))
      const map = await ok(anonymous.rpc('sector_seat_map',{ p_sector: room.id }))
      assert.deepEqual(map.seats.map(s => s.kind),['accessible','standard','aisle','blocked'])
      assert.ok(map.seats.every(row => !('participant_id' in row)))
      seat = map.seats[0].id
      blocked = map.seats[3].id
      await denied(reserve(first,roomType,blocked),/assento disponível/)
      const results = await simultaneous(db,event.id,'reserve_typed_ticket',[() => reserve(first,roomType,seat),() => reserve(second,roomType,seat)])
      assert.equal(results.filter(r => !r.error).length,1)
      assert.match(results.find(r => r.error).error.message,/assento foi reservado/)
      const winner = results.find(r => r.data).data
      const other = winner.participant_id === first.id ? second : first
      const beforeCancel = await ok(anonymous.rpc('sector_seat_map',{ p_sector: room.id }))
      assert.equal(beforeCancel.seats[0].taken,true)
      await denied(rpc(owner,'save_sector_map',{ ...mapArgs,p_cells: { '1:1': 'aisle' } }),/já reservado/)
      await ok(rpc(owner,'cancel_ticket',{ p_event: event.id,p_ticket: winner.id }))
      assert.equal((await ok(anonymous.rpc('sector_seat_map',{ p_sector: room.id }))).seats[0].taken,false)
      admitted = await ok(reserve(other,roomType,seat))
      assert.equal(admitted.seat_id,seat)
      const tickets = await ok(rpc(other,'my_ticket_admissions'))
      assert.equal(tickets.find(row => row.id === admitted.id).details.seat,'A1')
    })

    await t.test('VIP respeita capacidade, prazo, limite por pessoa e repetição da solicitação', async () => {
      const request = randomUUID()
      vipTicket = await ok(reserve(first,vipType,null,request))
      assert.equal((await ok(reserve(first,vipType,null,request))).id,vipTicket.id)
      assert.notEqual((await ok(reserve(first,vipType,null))).id,vipTicket.id)
      await denied(reserve(first,vipType,null),/limite desta modalidade/)
      await denied(reserve(second,vipType,null),/Não há vagas/)
      const choices = await ok(anonymous.rpc('event_ticket_options',{ p_event: event.id }))
      assert.equal(choices.options.find(o => o.id === vipType).available,0)
      await ok(config('type',{ id: vipType,name: 'VIP',sector_id: vip.id,capacity: 2,per_person: 2,color: '#eac274',active: true,
        deadline: new Date(Date.now() - 1000).toISOString() }))
      await denied(reserve(second,vipType,null),/encerradas/)
    })

    await t.test('portaria errada, reuso concorrente e Realtime não duplicam a presença', async () => {
      await ok(rpc(owner,'assign_event_staff',{ p_event: event.id,p_email: employee.email }))
      assert.equal((await ok(validate(employee,roomGate,admitted.code))).status,'forbidden')
      for (const id of [roomGate,vipGate]) await ok(config('gate_member',{ id,user_id: employee.id,enabled: true }))
      assert.equal((await ok(validate(employee,null,admitted.code))).status,'gate_required')
      let updatedAt = 0
      const subscription = owner.client.channel('eventscan-audit-' + seed).on('postgres_changes',
        { event: '*',schema: 'public',table: 'event_activity',filter: 'event_id=eq.' + event.id },change => { updatedAt = Math.max(updatedAt,Date.parse(change.new.updated_at)) })
      await subscribeToPostgres(subscription)
      const wrong = await ok(validate(employee,vipGate,admitted.code))
      assert.deepEqual([wrong.status,wrong.type_name,wrong.seat],['wrong_sector','Auditório','A1'])
      const activityRow = await ok(owner.client.from('event_activity').select('updated_at').eq('event_id',event.id).single())
      const expectedUpdate = Date.parse(activityRow.updated_at)
      for (let i = 0; updatedAt < expectedUpdate && i < 50; i += 1) await delay(100)
      assert.equal(updatedAt,expectedUpdate,'Tentativa negada também deve disparar Realtime')
      await owner.client.removeChannel(subscription)
      const before = await ok(scope(owner))
      assert.equal(before.present,1)
      const scans = await simultaneous(db,event.id,'validate_at_gate',[
        () => validate(employee,roomGate,admitted.code),() => validate(owner,roomGate,admitted.code),
      ])
      assert.deepEqual(scans.map(scan => scan.data?.status).sort(),['used','valid'])
      assert.equal(scans[0].data.checked_in_at,scans[1].data.checked_in_at)
      await denied(rpc(owner,'cancel_ticket',{ p_event: event.id,p_ticket: admitted.id }),/sem check-in/)
      const after = await ok(scope(owner))
      assert.equal(after.present,before.present+1)
      assert.equal(after.reused,1)
      assert.equal(after.gates.find(g => g.id === roomGate).activity.allowed,1)
      assert.equal((await ok(validate(employee,vipGate,vipTicket.code))).status,'valid')
      assert.equal((await ok(rpc(employee,'gate_monitor',{ p_event: event.id,p_gate: vipGate }))).allowed,1)
      await denied(rpc(employee,'gate_monitor',{ p_event: event.id,p_gate: generalGate }),/não tem acesso/)
    })

    await t.test('auditoria restringe consultas, registra motivos e aplica limites configuráveis', async () => {
      await denied(audit(employee),/não tem acesso/)
      await denied(audit(outsider),/não tem acesso/)
      await denied(employee.client.from('validation_attempts').select('*'))
      await denied(employee.client.from('validation_attempts').insert({ event_id: event.id,result: 'valid' }))
      const rows = await ok(audit(admin,vipGate,'wrong_sector'))
      assert.equal(rows.total,1)
      assert.equal(rows.rows[0].staff_name,'Equipe')
      assert.equal(rows.rows[0].ticket_id,admitted.id)
      const limits = { reuse: 2,invalid_streak: 2,wrong_sector: 2,staff_rate: 5,max_per_minute: 60 }
      await denied(rpc(outsider,'save_security_limits',{ p_event: event.id,p_limits: limits }),/não pode alterar/)
      await ok(rpc(owner,'save_security_limits',{ p_event: event.id,p_limits: limits }))
      assert.equal((await ok(validate(employee,vipGate,'invalido'))).status,'not_found')
      assert.equal((await ok(validate(employee,vipGate,'tambem-invalido'))).status,'not_found')
      assert.ok((await ok(scope(owner))).alerts.some(a => a.kind === 'invalid_streak'))
      await db.query(`insert into public.validation_attempts(event_id,gate_id,staff_id,result)
        select $1,$2,$3,'not_found' from generate_series(1,60)`,[event.id,vipGate,employee.id])
      assert.equal((await ok(validate(employee,vipGate,'invalido'))).status,'rate_limited')
      assert.equal((await ok(validate(employee,vipGate,'invalido'))).status,'rate_limited')
      assert.equal((await ok(audit(owner,vipGate,'rate_limited'))).occurrences,2)
    })

    await t.test('certificação exige conclusão, check-in e atividades e registra emissão e revogação', async () => {
      const template = {
        enabled: true,event_name: 'Certificado de congresso',organizer_name: 'Faculdade Fictícia',hours: 4,
        event_date: new Date().toISOString().slice(0,10),participation_text: 'Participou das atividades do congresso.',
        logo_url: null,signature_url: null,completes_at: null,completed: false,
      }
      await denied(rpc(employee,'save_certificate_settings',{ p_event: event.id,p_settings: template }),/não pode configurar/)
      await ok(rpc(owner,'save_certificate_settings',{ p_event: event.id,p_settings: template }))
      const openMap = await ok(anonymous.rpc('sector_seat_map',{ p_sector: room.id }))
      await ok(reserve(employee,roomType,openMap.seats[1].id))
      assert.equal((await ok(rpc(employee,'my_certificate_events')))[0].eligibility,'checkin')
      await denied(issue(employee),/requisitos/)
      await denied(issue(first),/requisitos/)
      assert.equal((await ok(rpc(first,'my_certificate_events')))[0].eligibility,'completion')
      await ok(rpc(owner,'save_certificate_settings',{ p_event: event.id,p_settings: { ...template,completed: true } }))
      await ok(rpc(owner,'save_certificate_activity',{ p_event: event.id,p_activity: null,p_name: 'Palestra obrigatória',p_required: true }))
      activity = (await ok(rpc(owner,'certificate_setup',{ p_event: event.id }))).activities[0].id
      await denied(issue(first),/requisitos/)
      assert.equal((await ok(rpc(first,'my_certificate_events')))[0].eligibility,'activities')
      await denied(rpc(employee,'record_certificate_activity',{ p_event: event.id,p_activity: activity,p_email: first.email,p_present: true }))
      await ok(rpc(owner,'record_certificate_activity',{ p_event: event.id,p_activity: activity,p_email: first.email,p_present: true }))
      certificate = await ok(issue(first))
      assert.equal((await ok(issue(first))).code,certificate.code)
      assert.deepEqual(await ok(employee.client.from('certificates').select('id')),[])
      const proof = await ok(verify(certificate.code))
      assert.equal(proof.status,'valid')
      assert.equal(proof.details.participant_name,'Primeiro')
      assert.equal(proof.details.organizer_name,'Faculdade Fictícia')
      assert.ok(!('participant_id' in proof) && !('email' in proof.details))
      assert.equal((await ok(verify(randomUUID()))).status,'not_found')
      await ok(rpc(owner,'save_certificate_settings',{ p_event: event.id,p_settings: { ...template,event_name: 'Novo modelo',completed:true } }))
      assert.equal((await ok(verify(certificate.code))).details.event_name,template.event_name)
      await denied(rpc(employee,'revoke_certificate',{ p_event: event.id,p_certificate: certificate.id }))
      await ok(rpc(owner,'revoke_certificate',{ p_event: event.id,p_certificate: certificate.id }))
      assert.deepEqual(await ok(verify(certificate.code)),{ status: 'revoked' })
      await denied(issue(first),/revogado/)
    })
  } finally {
    if (event?.id) {
      await db.query('delete from public.security_limits where scope=$1',[event.id])
      await db.query('delete from public.check_ins where event_id=$1',[event.id])
      await db.query('delete from public.tickets where event_id=$1',[event.id])
      await db.query('delete from public.events where id=$1',[event.id])
    }
    if (visitors.length) await db.query('delete from auth.users where id=any($1)',[visitors.map(user => user.id)])
    await Promise.all(visitors.map(user => user.client.removeAllChannels()))
    await db.end()
  }
})
