import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export async function createEvent(page: Page, title: string, seats: number) {
  await page.getByRole('link', { name: 'Novo evento' }).click()
  await page.getByLabel('Nome do evento').fill(title)
  await page.getByLabel('Categoria').selectOption('Educação')
  await page.getByLabel('Descrição').fill('Uma oficina fictícia para a apresentação acadêmica do EventPass.')
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await page.getByLabel('Data e horário de Brasília').fill(tomorrow + 'T19:00')
  await page.getByLabel('Capacidade máxima').fill(String(seats))
  await page.getByLabel('Endereço', { exact: true }).fill('Auditório Acadêmico, Rua Central, 20')
  await page.getByLabel('Cidade', { exact: true }).fill('São Paulo, SP')
  await page.getByLabel('Imagem de capa').setInputFiles('public/images/technology.webp')
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.getByText('Rascunho', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Publicar evento' }).click()
  await expect(page.getByText('Evento publicado no catálogo.')).toBeVisible()
  const link = await page.getByRole('link', { name: 'Ver página' }).getAttribute('href')
  return link!
}

export async function useQrAsCamera(page: Page, svg: string) {
  await page.evaluate(async qr => {
    const image = new Image()
    image.src = 'data:image/svg+xml,' + encodeURIComponent(qr)
    await image.decode()
    const frame = document.createElement('canvas')
    frame.width = 480
    frame.height = 480
    const ctx = frame.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const draw = () => {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, 480, 480)
      ctx.drawImage(image, 48, 48, 384, 384)
    }
    draw()

    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const stream = frame.captureStream(10)
        const track = stream.getVideoTracks()[0]
        const originalStop = track.stop.bind(track)
        const timer = window.setInterval(draw, 100)
        track.stop = () => {
          window.clearInterval(timer)
          originalStop()
        }
        return stream
      },
    })
  }, svg)
}
