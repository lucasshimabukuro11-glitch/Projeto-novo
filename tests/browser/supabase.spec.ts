import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import pg from 'pg'
import { createEvent, useQrAsCamera } from './helpers'

async function logIn(page: Page, email: string, password: string) {
  await page.goto('/entrar')
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}

test('navegador usa Supabase Auth, Storage, reserva e check-in do início ao fim', async ({ page: organizer, browser }) => {
  test.setTimeout(60_000)
  const key = process.env.EVENTPASS_TEST_PUBLIC_KEY!
  const client = createClient('http://127.0.0.1:54321', key, { auth: { persistSession: false, autoRefreshToken: false } })
  const db = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
  await db.connect()
  const run = randomUUID().slice(0, 10)
  const ownerEmail = `ui-organizador-${run}@example.test`
  const staffEmail = `ui-equipe-${run}@example.test`
  const participantEmail = `ui-participante-${run}@example.test`
  const password = 'Teste-' + randomUUID()
  const title = 'Evento acadêmico ' + run
  const participantContext = await browser.newContext({ baseURL: 'http://localhost:4174' })
  const staffContext = await browser.newContext({ baseURL: 'http://localhost:4174', viewport: { width: 390, height: 844 } })
  let ownerId: string | undefined
  let eventPath: string | undefined

  try {
    for (const [email, display_name] of [[ownerEmail, 'Organizador Teste'], [staffEmail, 'Equipe Teste']]) {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { display_name } } })
      expect(error, error?.message).toBeNull()
      if (email === ownerEmail) {
        ownerId = data.user!.id
        await db.query("update public.profiles set role = 'organizer' where id = $1", [ownerId])
      }
    }

    await logIn(organizer, ownerEmail, password)
    eventPath = await createEvent(organizer, title, 2)
    const eventId = eventPath.split('/').pop()!
    await organizer.getByLabel('E-mail do funcionário').fill(staffEmail)
    await organizer.getByRole('button', { name: 'Autorizar funcionário' }).click()
    await expect(organizer.getByText('Funcionário autorizado para este evento.')).toBeVisible()
    await organizer.getByRole('link', { name: 'Visão geral' }).click()
    await expect(organizer.getByTestId('metric-present')).toContainText('0')

    const participant = await participantContext.newPage()
    await participant.goto(eventPath)
    await participant.getByRole('link', { name: 'Reserve seu ingresso' }).click()
    await participant.getByLabel('Nome completo').fill('Participante Teste')
    await participant.getByLabel('E-mail', { exact: true }).fill(participantEmail)
    await participant.getByLabel('Senha', { exact: true }).fill(password)
    await participant.getByRole('button', { name: 'Criar minha conta' }).click()
    await expect(participant.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await participant.getByRole('button', { name: 'Reservar ingresso' }).click()
    await expect(participant.getByText('Apresente este QR Code na entrada.')).toBeVisible()
    const code = await participant.getByLabel('Código do ingresso').inputValue()
    const qr = await participant.locator('.qr-tile svg').evaluate(node => new XMLSerializer().serializeToString(node))

    const staff = await staffContext.newPage()
    await logIn(staff, staffEmail, password)
    await expect(staff.getByRole('heading', { name: 'Meus ingressos' })).toBeVisible()
    await staff.goto('/check-in?evento=' + eventId)
    await expect(staff.getByLabel('Evento em atendimento')).toHaveValue(eventId)
    await useQrAsCamera(staff, qr)
    await staff.getByRole('button', { name: 'Abrir câmera' }).click()
    await expect(staff.getByRole('heading', { name: 'Entrada autorizada' })).toBeVisible({ timeout: 12000 })
    await expect(organizer.getByTestId('metric-present')).toContainText('1', { timeout: 10000 })
    await expect(participant.getByText('Check-in realizado', { exact: true })).toBeVisible({ timeout: 10000 })

    await staff.getByLabel('Código do ingresso').fill(code)
    await staff.getByRole('button', { name: 'Validar ingresso' }).click()
    await expect(staff.getByText('Ingresso já utilizado')).toBeVisible()
    const records = await db.query('select count(*)::int as total from public.check_ins where event_id = $1', [eventId])
    expect(records.rows[0].total).toBe(1)
  } finally {
    await participantContext.close()
    await staffContext.close()
    if (ownerId) {
      const ownerEvents = await db.query('select id, cover_url from public.events where owner_id = $1', [ownerId])
      const ids = ownerEvents.rows.map(row => row.id)
      const photos = ownerEvents.rows.filter(row => row.cover_url)
        .map(row => new URL(row.cover_url).pathname.split('/event-covers/')[1])
      if (photos.length) {
        await client.auth.signInWithPassword({ email: ownerEmail, password })
        await client.storage.from('event-covers').remove(photos)
      }
      await db.query('delete from public.check_ins where event_id = any($1)', [ids])
      await db.query('delete from public.tickets where event_id = any($1)', [ids])
      await db.query('delete from public.events where id = any($1)', [ids])
    }
    await db.query('delete from auth.users where email = any($1)', [[ownerEmail, staffEmail, participantEmail]])
    await db.end()
  }
})
