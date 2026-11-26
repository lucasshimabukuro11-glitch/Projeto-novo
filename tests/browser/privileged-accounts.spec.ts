import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import pg from 'pg'

const api = 'http://127.0.0.1:54321'
const serviceKey = process.env.EVENTSCAN_TEST_ADMIN_KEY

test.use({ trace: 'off' })

async function logIn(page: Page, email: string, password: string) {
  await page.goto('/entrar')
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}

test('primeiro acesso e catálogo conectam quatro perfis ao Supabase local', async ({ browser, baseURL }) => {
  test.skip(!serviceKey, 'Defina a chave administrativa do Supabase local para testar provisionamento.')
  test.setTimeout(100_000)
  const client = createClient(api, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
  const db = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
  const run = randomUUID().slice(0, 8)
  const slots = ['admin', 'organizer-1', 'organizer-2', 'organizer-3', 'participant']
  const users = slots.map(slot => ({
    slot, email: slot + '-navegador-' + run + '@example.test',
    temporaryPassword: 'Inicial-' + randomUUID(), password: 'Definitiva-' + randomUUID(),
  }))
  const pages: Page[] = []
  const contexts: BrowserContext[] = []
  const newCategory = 'Expositores ' + run

  await db.connect()
  try {
    for (const user of users) {
      const { error } = await client.auth.admin.createUser({
        email: user.email, password: user.temporaryPassword, email_confirm: true,
        user_metadata: { display_name: user.slot + ' ' + run },
        app_metadata: user.slot === 'participant' ? {} : { eventscan_account_slot: user.slot },
      })
      expect(error?.code ?? '').toBe('')
    }
    const seed = await client.rpc('seed_provisioned_products')
    expect(seed.error?.code ?? '').toBe('')

    for (const [index, user] of users.slice(0, 4).entries()) {
      const context = await browser.newContext({ baseURL, viewport: index === 1 ? { width: 390, height: 844 } : undefined })
      contexts.push(context)
      const page = await context.newPage()
      pages.push(page)
      await logIn(page, user.email, user.temporaryPassword)
      await expect(page.getByRole('heading', { name: 'Primeiro acesso' })).toBeVisible()
      await page.goto(index ? '/produtos/meus' : '/administracao/usuarios')
      await expect(page).toHaveURL(/\/primeiro-acesso$/)
      await expect(page.getByRole('heading', { name: 'Primeiro acesso' })).toBeVisible()
      await page.getByLabel('Nova senha', { exact: true }).fill(user.password)
      await page.getByLabel('Confirmar nova senha', { exact: true }).fill(user.password)
      await page.getByRole('button', { name: 'Concluir primeiro acesso' }).click()
      await page.getByRole('link', { name: 'Entrar com a nova senha' }).click()
      if (index === 0) {
        await logIn(page, user.email, user.temporaryPassword)
        await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible()
      }
      await logIn(page, user.email, user.password)
      await expect(page.getByRole('heading', { name: index ? 'Visão geral' : 'Visão geral da plataforma', exact: true })).toBeVisible()
      if (index) {
        await page.getByRole('link', { name: 'Meus produtos', exact: true }).click()
        await expect(page.getByRole('article')).toHaveCount(6)
      }
    }

    const [admin, owner, other] = pages
    const editor = owner.getByRole('link', { name: 'Editar Camiseta Credencial Tech' })
    const editPath = await editor.getAttribute('href')
    await editor.click()
    await owner.getByLabel('Quantidade em estoque').fill('27')
    await owner.getByRole('button', { name: 'Salvar produto' }).click()
    await expect(owner).toHaveURL(/\/produtos\/meus$/)
    await owner.reload()
    const shirt = owner.getByRole('article').filter({ hasText: 'Camiseta Credencial Tech' })
    await expect(shirt.getByText('Estoque 27', { exact: false })).toBeVisible()
    await expect.poll(() => shirt.locator('img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await other.goto(editPath!)
    await expect(other.getByRole('heading', { name: 'Produto indisponível' })).toBeVisible()

    await admin.goto('/administracao/produtos')
    await admin.getByRole('link', { name: 'Categorias' }).click()
    await admin.getByLabel('Nome da categoria').fill(newCategory)
    await admin.getByRole('button', { name: 'Criar categoria' }).click()
    await expect(admin.getByText('Categoria salva.')).toBeVisible()
    await expect(admin.getByRole('row').filter({ hasText: newCategory })).toBeVisible()

    await admin.goto('/administracao/usuarios')
    const participant = admin.getByRole('row').filter({ hasText: users[4].email })
    await participant.getByRole('button', { name: 'Alterar perfil' }).click()
    await admin.getByLabel('Novo perfil').selectOption('organizer')
    await admin.getByRole('button', { name: 'Revisar alteração' }).click()
    await admin.getByRole('button', { name: 'Confirmar alteração' }).click()
    await expect(admin.getByText('Permissão atualizada.')).toBeVisible()
    await expect(participant.getByText('Organizador', { exact: true })).toBeVisible()
  } finally {
    await Promise.all(contexts.map(context => context.close()))
    try {
      await db.query('delete from eventpass_private.account_role_changes where account_id in (select id from auth.users where email = any($1))',
        [users.map(user => user.email)])
      await db.query('delete from auth.users where email = any($1)', [users.map(user => user.email)])
      await db.query('delete from public.product_categories where name = $1', [newCategory])
    } finally { await db.end() }
  }
})
