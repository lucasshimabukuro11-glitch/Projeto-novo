import assert from 'node:assert/strict'
import test from 'node:test'
import { brasiliaInstant, checkInMessages, eventDate, eventTime, percentage, searchText, ticketCodePattern, ticketState, toPage } from '../src/data/domain.ts'

test('converte a data de Brasília para o instante armazenado e exibe no mesmo fuso', () => {
  const instant = brasiliaInstant('2030-05-12T23:45')
  assert.equal(instant, '2030-05-13T02:45:00.000Z')
  assert.equal(eventTime(instant), '23:45')
  assert.match(eventDate(instant), /^12/)
})

test('a busca ignora acentos, caixa e espaços nas extremidades', () => {
  assert.equal(searchText('  São PAULO '), 'sao paulo')
})

test('o cálculo dos indicadores trata denominador zero', () => {
  assert.equal(percentage(0, 0), 0)
  assert.equal(percentage(2, 3), 67)
  assert.equal(percentage(10, 10), 100)
})

test('os estados de ingresso refletem check-in e cancelamento do evento', () => {
  const active = { checked_in_at: null, cancelled_at: null }
  const used = { ...active, checked_in_at: '2030-05-13T02:45:00.000Z' }
  assert.equal(ticketState(active, { status: 'published' }).label, 'Confirmado')
  assert.equal(ticketState(used, { status: 'published' }).label, 'Check-in realizado')
  assert.equal(ticketState(active, { status: 'cancelled' }).label, 'Cancelado')
  assert.equal(ticketState({ ...active, cancelled_at: used.checked_in_at }, { status: 'published' }).label, 'Cancelado')
})

test('cada desfecho de check-in tem uma mensagem própria', () => {
  const expected = ['valid', 'used', 'not_found', 'cancelled', 'wrong_event', 'forbidden', 'event_unavailable', 'wrong_sector', 'gate_required', 'rate_limited']
  assert.deepEqual(Object.keys(checkInMessages).sort(), expected.sort())
  assert.equal(new Set(Object.values(checkInMessages).map(message => message.title)).size, expected.length)
  assert.match(checkInMessages.valid.title, /autorizada/)
  assert.match(checkInMessages.used.detail, /negada/)
})

test('a paginação identifica se existe mais uma página', () => {
  assert.deepEqual(toPage([1, 2]).rows, [1, 2])
  assert.equal(toPage([1, 2]).hasMore, false)
  const page = toPage(Array.from({ length: 16 }, (_, i) => i))
  assert.equal(page.rows.length, 15)
  assert.equal(page.hasMore, true)
})

test('o código manual aceita UUID e recusa formatos inválidos', () => {
  assert.match('550E8400-e29b-41d4-a716-446655440000', ticketCodePattern)
  assert.doesNotMatch('550e8400-e29b-41d4-a716-44665544000x', ticketCodePattern)
  assert.doesNotMatch('https://example.test/ticket', ticketCodePattern)
})
