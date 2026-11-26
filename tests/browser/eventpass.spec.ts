import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createEvent, useQrAsCamera } from './helpers'

async function logInAs(page: Page, role: string) {
  await page.goto('/entrar')
  await page.getByRole('button', { name: role, exact: true }).click()
}

async function signup(page: Page, name: string, email: string) {
  await page.getByLabel('Nome completo').fill(name)
  await page.getByLabel('E-mail fictício').fill(email)
  await page.getByRole('button', { name: 'Criar minha conta' }).click()
}

test('catálogo responsivo oferece navegação, busca e filtros', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Grandes eventos/ })).toBeVisible()
  await expect(page.getByText('Modo demo', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Aurora Music Festival', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tecnologia', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tech Summit Brasil', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Aurora Music Festival', exact: true })).toHaveCount(0)
  await page.getByLabel('Buscar eventos').fill('nada aqui')
  await expect(page.getByText('Nenhum evento encontrado')).toBeVisible()
  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await expect(page.getByRole('heading', { name: 'Aurora Music Festival', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Criar conta' })).toBeVisible()
})

test('a página Sobre apresenta o autor, a finalidade e as tecnologias sem login', async ({ page }) => {
  await page.goto('/')
  const menu = page.getByRole('navigation', { name: 'Menu principal' })
  await menu.getByRole('link', { name: 'Sobre', exact: true }).click()
  await expect(page).toHaveURL(/\/sobre$/)
  await page.reload()

  const content = page.getByRole('main')
  await expect(content.getByRole('heading', { name: 'Sobre o EventScan', level: 1 })).toBeVisible()
  await expect(content.getByText('Lucas Shimabukuro', { exact: true })).toBeVisible()
  await expect(content).toContainText(/organizar eventos.*gerenciar inscrições.*QR Code.*check-ins.*certificados de participação/)
  await expect(content.getByRole('listitem')).toHaveText(['React', 'TypeScript', 'Vite', 'Supabase', 'PostgreSQL', 'GitHub', 'Vercel'])
  await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Sobre', exact: true })).toHaveAttribute('aria-current', 'page')
})

test('o menu recolhido abre a página Sobre no tablet e no celular', async ({ page }) => {
  const menu = page.getByRole('navigation', { name: 'Menu principal' })
  for (const width of [1024, 320]) {
    await page.setViewportSize({ width, height: 740 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir menu' }).click()
    await menu.getByRole('link', { name: 'Sobre', exact: true }).click()
    await expect(page).toHaveURL(/\/sobre$/)
    await expect(page.getByRole('heading', { name: 'Sobre o EventScan', level: 1 })).toBeVisible()
    await expect(menu).toBeHidden()
    await expect(page.getByText('Lucas Shimabukuro', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
})

test('criação, cadastro, QR pela câmera, segunda leitura e atualização do painel', async ({ page: organizer, context }) => {
  const title = 'Oficina de Validação'
  await logInAs(organizer, 'Organizador')
  const eventUrl = await createEvent(organizer, title, 2)
  await organizer.getByLabel('E-mail do funcionário').fill('equipe@example.test')
  await organizer.getByRole('button', { name: 'Autorizar funcionário' }).click()
  await expect(organizer.getByText('Funcionário autorizado para este evento.')).toBeVisible()
  await organizer.getByRole('link', { name: 'Visão geral' }).click()
  await expect(organizer.getByTestId('metric-present')).toContainText('4')

  const participant = await context.newPage()
  await participant.goto(eventUrl)
  await participant.getByRole('link', { name: 'Reserve seu ingresso' }).click()
  await signup(participant, 'Aluna Teste', 'aluna@example.test')
  await expect(participant.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await participant.getByRole('button', { name: 'Reservar ingresso' }).click()
  await expect(participant.getByText('Apresente este QR Code na entrada.')).toBeVisible()
  const code = await participant.getByLabel('Código do ingresso').inputValue()
  expect(code).toMatch(/^[a-f0-9-]{36}$/)
  const qr = await participant.locator('.qr-tile svg').evaluate(node => new XMLSerializer().serializeToString(node))
  await participant.goto('/check-in')
  await expect(participant.getByText('Acesso não autorizado')).toBeVisible()
  await participant.goto('/administracao')
  await expect(participant.getByText('Acesso não autorizado')).toBeVisible()

  const staff = await context.newPage()
  await staff.setViewportSize({ width: 390, height: 844 })
  await logInAs(staff, 'Equipe de check-in')
  await staff.getByLabel('Evento em atendimento').selectOption({ label: title + ' · Demonstração' })
  await useQrAsCamera(staff, qr)
  await staff.getByRole('button', { name: 'Abrir câmera' }).click()
  await expect(staff.getByRole('heading', { name: 'Entrada autorizada' })).toBeVisible({ timeout: 12000 })
  await expect(organizer.getByTestId('metric-present')).toContainText('5')
  await expect(organizer.locator('.activity-list')).toContainText('Check-in realizado · ' + title)

  await staff.getByLabel('Código do ingresso').fill(code)
  await staff.getByRole('button', { name: 'Validar ingresso' }).click()
  await expect(staff.getByRole('heading', { name: 'Ingresso já utilizado' })).toBeVisible()
  await expect(organizer.getByTestId('metric-present')).toContainText('5')

  await staff.getByLabel('Evento em atendimento').selectOption('aurora-music-festival')
  await staff.getByLabel('Código do ingresso').fill(code)
  await staff.getByRole('button', { name: 'Validar ingresso' }).click()
  await expect(staff.getByRole('heading', { name: 'Ingresso de outro evento' })).toBeVisible()
})

test('duas inscrições no mesmo navegador respeitam o limite de uma vaga', async ({ page: organizer, context }) => {
  await logInAs(organizer, 'Organizador')
  const eventUrl = await createEvent(organizer, 'Vaga única', 1)
  const [first, second] = await Promise.all([context.newPage(), context.newPage()])
  await Promise.all([first.goto(eventUrl), second.goto(eventUrl)])
  await Promise.all([first.getByRole('link', { name: 'Reserve seu ingresso' }).click(), second.getByRole('link', { name: 'Reserve seu ingresso' }).click()])
  await Promise.all([signup(first, 'Pessoa Um', 'pessoa1@example.test'), signup(second, 'Pessoa Dois', 'pessoa2@example.test')])
  const firstButton = first.getByRole('button', { name: 'Reservar ingresso' })
  const secondButton = second.getByRole('button', { name: 'Reservar ingresso' })
  await Promise.all([expect(firstButton).toBeEnabled(), expect(secondButton).toBeEnabled()])
  // Dispatch both without waiting for navigation or the other button's refresh.
  await Promise.all([firstButton.dispatchEvent('click'), secondButton.dispatchEvent('click')])
  await Promise.all([first.waitForFunction(() => location.pathname.startsWith('/ingressos/') || document.body.innerText.includes('lotado') || document.body.innerText.includes('Ingressos esgotados')),
    second.waitForFunction(() => location.pathname.startsWith('/ingressos/') || document.body.innerText.includes('lotado') || document.body.innerText.includes('Ingressos esgotados'))])
  expect([first.url(), second.url()].filter(url => url.includes('/ingressos/'))).toHaveLength(1)
  await expect(organizer.getByText('1 de 1 vagas reservadas')).toBeVisible()
})

test('administrador consulta as contas e filtra organizadores', async ({ page }) => {
  await logInAs(page, 'Administrador')
  await expect(page.getByRole('heading', { name: 'Visão geral da plataforma' })).toBeVisible()
  await page.getByRole('link', { name: 'Usuários' }).click()
  await expect(page.getByRole('cell', { name: 'marina@example.test' })).toBeVisible()
  await page.getByRole('button', { name: 'Organizadores', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'organizador@example.test' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'marina@example.test' })).toHaveCount(0)
})
