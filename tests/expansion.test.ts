import assert from 'node:assert/strict'
import test from 'node:test'
import { admissionLabel, certificateCode, csvCell, defaultLimits, seatKey, seatLabel } from '../src/data/expansion/domain.ts'

test('assentos têm identificação legível de A1 a Z30 e chaves sem colisões', () => {
  assert.equal(seatLabel(1, 1), 'A1')
  assert.equal(seatLabel(26, 30), 'Z30')
  assert.notEqual(seatKey(1, 12), seatKey(11, 2))
})

test('verificação aceita UUID ou URL do QR sem navegar para endereços externos', () => {
  assert.equal(certificateCode('  550e8400-e29b-41d4-a716-446655440000  '), '550e8400-e29b-41d4-a716-446655440000')
  assert.equal(certificateCode('https://example.test/verificar-certificado?codigo=exemplo'), 'exemplo')
})

test('exportação CSV escapa separadores, aspas e prefixos de fórmulas', () => {
  assert.equal(csvCell('Sala "VIP"; Entrada'), '"Sala ""VIP""; Entrada"')
  assert.equal(csvCell(' =1+1'), '"\' =1+1"')
  assert.equal(csvCell('+2'), '"\'+2"')
  assert.equal(csvCell(4), '"4"')
})

test('ingresso diferencia modalidade, setor e assento e os limites mantêm faixa operacional', () => {
  assert.equal(admissionLabel({ type_name: 'VIP', sector_name: 'Auditório', seat: 'A2', color: null }), 'VIP · Auditório · Assento A2')
  assert.ok(defaultLimits.max_per_minute > defaultLimits.staff_rate)
})
