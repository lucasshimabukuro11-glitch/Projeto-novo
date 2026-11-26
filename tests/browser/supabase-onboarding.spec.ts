import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import pg from 'pg'

const api = process.env.EVENTPASS_TEST_API_URL ?? 'http://127.0.0.1:54321'
const inbox = process.env.EVENTPASS_TEST_MAILPIT_URL ?? 'http://127.0.0.1:54324'
const database = process.env.EVENTPASS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

function sdk() {
  return createClient(api, process.env.EVENTPASS_TEST_PUBLIC_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function createAccount(email: string, password: string, name: string) {
  const result = await sdk().auth.signUp({ email, password, options: { data: { display_name: name } } })
  expect(result.error?.message ?? '').toBe('')
  return result.data.user!.id
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/entrar')
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}

async function localRecoveryLink(email: string) {
  let link: string | undefined
  await expect.poll(async () => {
    const query = new URLSearchParams({ query: 'to:' + email })
    const response = await fetch(inbox + '/api/v1/search?' + query)
    const messages = await response.json()
    const message = messages.messages?.[0]
    if (!message) return false
    const details = await (await fetch(inbox + '/api/v1/message/' + message.ID)).json()
    const confirmation = String(details.HTML ?? '').match(/href="([^"]+\/auth\/v1\/verify\?[^"]+)"/)?.[1]
    if (!confirmation) return false
    link = confirmation.replaceAll('&amp;', '&')
    return true
  }, { message: 'O Mailpit local deve receber o link de recuperação.', timeout: 12_000 }).toBe(true)
  const address = new URL(link!)
  expect(['localhost', '127.0.0.1']).toContain(address.hostname)
  expect(address.searchParams.get('type')).toBe('recovery')
  return address.href
}

test('recupera senha pelo e-mail local e confirma o login em outra sessão', async ({ page, browser, baseURL }) => {
  const email = `recuperacao-${randomUUID().slice(0, 10)}@example.test`
  const password = 'Inicial-' + randomUUID()
  const newPassword = 'Nova-' + randomUUID()
  const id = await createAccount(email, password, 'Recuperação EventScan')
  const db = new pg.Client({ connectionString: database })
  const secondContext = await browser.newContext({ baseURL })
  await db.connect()

  try {
    await login(page, email, password)
    await expect(page.getByRole('heading', { name: 'Meus ingressos' })).toBeVisible()
    await page.goto('/redefinir-senha')
    await expect(page.getByText('Link de recuperação inválido ou expirado.')).toBeVisible()
    await page.goto('/entrar')
    await page.getByRole('link', { name: 'Esqueci minha senha' }).click()
    await page.getByLabel('E-mail', { exact: true }).fill(email)
    await page.getByRole('button', { name: 'Enviar link de recuperação' }).click()
    await expect(page.getByText('Se houver uma conta com esse e-mail, você receberá um link de recuperação.')).toBeVisible()

    const reset = await secondContext.newPage()
    await reset.goto(await localRecoveryLink(email))
    await expect(reset).toHaveURL(url => url.pathname === '/redefinir-senha' && !url.hash)
    await expect(reset.getByLabel('Nova senha', { exact: true })).toBeVisible()
    await reset.reload()
    await reset.getByLabel('Nova senha', { exact: true }).fill(newPassword)
    await reset.getByLabel('Confirmar nova senha').fill(newPassword)
    await reset.getByRole('button', { name: 'Salvar nova senha' }).click()
    await expect(reset.getByText('Sua senha foi atualizada.')).toBeVisible()
    await reset.getByRole('button', { name: 'Minha conta' }).click()
    await reset.getByRole('button', { name: 'Sair', exact: true }).click()
    await expect(reset.getByRole('link', { name: 'Entrar', exact: true })).toBeVisible()
    await login(reset, email, password)
    await expect(reset.getByText('E-mail ou senha incorretos.')).toBeVisible()
    await login(reset, email, newPassword)
    await expect(reset.getByRole('heading', { name: 'Meus ingressos' })).toBeVisible()
    await reset.reload()
    await expect(reset.getByRole('heading', { name: 'Meus ingressos' })).toBeVisible()
  } finally {
    await secondContext.close()
    try { await db.query('delete from auth.users where id = $1', [id]) } finally { await db.end() }
  }
})

test('aprovação em outra sessão libera edição e preserva o ingresso emitido', async ({ page, browser, baseURL }) => {
  test.setTimeout(60_000)
  const suffix = randomUUID().slice(0, 9)
  const ownerEmail = `organizador-${suffix}@example.test`
  const adminEmail = `admin-${suffix}@example.test`
  const guestEmail = `convidado-${suffix}@example.test`
  const password = 'EventScan-' + randomUUID()
  const organization = 'Faculdade ' + suffix
  const eventTitle = 'Congresso ' + suffix
  const scopedEmails = [ownerEmail, adminEmail, guestEmail]
  const adminContext = await browser.newContext({ baseURL })
  const guestContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })
  const db = new pg.Client({ connectionString: database })
  await db.connect()

  try {
    const adminId = await createAccount(adminEmail, password, 'Administrador local')
    await db.query("update public.profiles set role = 'admin' where id = $1", [adminId])
    await createAccount(guestEmail, password, 'Convidado local')
    await page.goto('/cadastro')
    await page.getByLabel('Nome completo').fill('Organizador local')
    await page.getByLabel('E-mail', { exact: true }).fill(ownerEmail)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Criar minha conta' }).click()
    await expect(page.getByRole('heading', { name: 'Meus ingressos' })).toBeVisible()
    await page.goto('/administracao/organizadores')
    await expect(page.getByText('Acesso não autorizado')).toBeVisible()
    await page.getByRole('button', { name: 'Minha conta' }).click()
    await page.getByRole('link', { name: 'Perfil de organizador' }).click()
    await page.getByLabel('Nome da organização').fill(organization)
    await page.getByLabel('Cidade', { exact: true }).fill('São Paulo')
    await page.getByRole('button', { name: 'Solicitar perfil de organizador' }).click()
    await expect(page.getByText('Em análise', { exact: true })).toBeVisible()

    const admin = await adminContext.newPage()
    await login(admin, adminEmail, password)
    await admin.getByRole('link', { name: 'Solicitações de organizador' }).click()
    const row = admin.getByRole('row').filter({ hasText: organization })
    await row.getByRole('button', { name: 'Aprovar', exact: true }).click()
    await admin.getByRole('button', { name: 'Confirmar aprovação' }).click()
    await expect(admin.getByText('Solicitação aprovada.')).toBeVisible()
    await expect(page.getByText('Seu perfil de organizador está ativo.')).toBeVisible({ timeout: 16_000 })

    await page.getByRole('link', { name: 'Abrir meus eventos' }).click()
    await page.getByRole('link', { name: 'Novo evento' }).click()
    await page.getByLabel('Nome do evento').fill(eventTitle)
    await page.getByLabel('Categoria').selectOption('Educação')
    await page.getByLabel('Descrição').fill('Evento fictício usado para testar edição e persistência.')
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    await page.getByLabel('Data e horário de Brasília').fill(tomorrow + 'T19:00')
    await page.getByLabel('Capacidade máxima').fill('5')
    await page.getByLabel('Endereço', { exact: true }).fill('Auditório Principal')
    await page.getByLabel('Cidade', { exact: true }).fill('São Paulo')
    await page.getByRole('button', { name: 'Salvar rascunho' }).click()
    await page.getByRole('button', { name: 'Publicar evento' }).click()
    await expect(page.getByText('Evento publicado no catálogo.')).toBeVisible()
    const event = await page.getByRole('link', { name: 'Ver página' }).getAttribute('href')

    const guest = await guestContext.newPage()
    await login(guest, guestEmail, password)
    await expect(guest.getByRole('heading', { name: 'Meus ingressos' })).toBeVisible()
    await guest.goto(event!)
    await guest.getByRole('button', { name: 'Reservar ingresso' }).click()
    const code = await guest.getByLabel('Código do ingresso').inputValue()
    const ticketPage = guest.url()

    await page.getByRole('link', { name: 'Editar evento' }).click()
    await expect(page.getByLabel('Nome do evento')).toHaveValue(eventTitle)
    await page.getByLabel('Nome do evento').fill(eventTitle + ' atualizado')
    await page.getByLabel('Endereço', { exact: true }).fill('Auditório Sul')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByRole('heading', { name: eventTitle + ' atualizado', exact: true })).toBeVisible()
    await guest.reload()
    await expect(guest).toHaveURL(ticketPage)
    await expect(guest.getByLabel('Código do ingresso')).toHaveValue(code)
    await expect(guest.getByRole('heading', { name: eventTitle + ' atualizado', exact: true })).toBeVisible()
    await expect(guest.getByText(/Auditório Sul/)).toBeVisible()
  } finally {
    await guestContext.close()
    await adminContext.close()
    try {
      const result = await db.query(
        'select e.id from public.events e join public.profiles p on p.id = e.owner_id where p.email = $1', [ownerEmail],
      )
      const ids = result.rows.map(row => row.id)
      if (ids.length) {
        await db.query('delete from public.check_ins where event_id = any($1)', [ids])
        await db.query('delete from public.tickets where event_id = any($1)', [ids])
        await db.query('delete from public.events where id = any($1)', [ids])
      }
      await db.query('delete from auth.users where email = any($1)', [scopedEmails])
    } finally { await db.end() }
  }
})
