import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSupabaseConfig } from '../src/data/supabase-config.ts'

const publicKey = 'sb_publishable_example_for_tests'
const host = 'https://project.example.test'
const legacyKey = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`

test('apenas desenvolvimento sem as duas variáveis abre o modo demo', () => {
  assert.deepEqual(resolveSupabaseConfig('', '', true), { mode: 'demo' })
  assert.equal(resolveSupabaseConfig('', '', false).mode, 'invalid')
  assert.equal(resolveSupabaseConfig('', publicKey, true).mode, 'invalid')
  assert.equal(resolveSupabaseConfig(host, '', true).mode, 'invalid')
})

test('aceita a chave pública publishable e a chave anon legada', () => {
  assert.deepEqual(resolveSupabaseConfig(` ${host} `, ` ${publicKey} `, false), { mode: 'supabase', url: host, key: publicKey })
  assert.equal(resolveSupabaseConfig(host, legacyKey('anon'), false).mode, 'supabase')
  assert.equal(resolveSupabaseConfig('http://127.0.0.1:54321', publicKey, false).mode, 'supabase')
})

test('recusa chaves privilegiadas e URLs inseguras', () => {
  for (const key of ['sb_secret_example', legacyKey('service_role'), 'sb_publishable_', 'invalid']) {
    assert.equal(resolveSupabaseConfig(host, key, false).mode, 'invalid')
  }
  for (const url of ['http://project.example.test', 'https://user@project.example.test', host + '?key=example', 'file:///tmp/test', 'invalid']) {
    assert.equal(resolveSupabaseConfig(url, publicKey, false).mode, 'invalid')
  }
})
