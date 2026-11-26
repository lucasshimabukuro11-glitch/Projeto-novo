import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

class ProvisioningError extends Error {}

function fail(message) {
  throw new ProvisioningError(message)
}

function projectOrigin(value, label) {
  try {
    const url = new URL(value)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) throw new Error()
    return { origin: url.origin, local }
  } catch {
    fail('Informe uma URL de projeto válida em ' + label + '.')
  }
}

function keyRole(key) {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role }
  catch { return null }
}

function readConfiguration() {
  if (process.argv.length !== 3) fail('Informe o caminho do arquivo de configuração privado.')
  let config
  try { config = JSON.parse(readFileSync(process.argv[2], 'utf8')) }
  catch { fail('Não foi possível ler a configuração JSON.') }
  if (!config || !Array.isArray(config.organizerEmails) || config.organizerEmails.length !== 3) {
    fail('Informe os quatro e-mails nas propriedades adminEmail e organizerEmails.')
  }

  const api = projectOrigin(process.env.EVENTSCAN_SUPABASE_URL, 'EVENTSCAN_SUPABASE_URL')
  const { origin: site } = projectOrigin(config.siteUrl, 'siteUrl')
  const emails = [config.adminEmail, ...config.organizerEmails].map(value =>
    typeof value === 'string' ? value.trim().toLowerCase() : '')
  if (new Set(emails).size !== 4 || emails.some(email =>
    email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
    (!api.local && emails.some(email => /\.(test|example|invalid|localhost)$/.test(email)))) {
    fail('Informe quatro endereços de e-mail distintos e válidos.')
  }

  const adminKey = process.env.EVENTSCAN_SUPABASE_ADMIN_KEY?.trim() ?? ''
  const publicKey = process.env.EVENTSCAN_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!adminKey.startsWith('sb_secret_') && (!adminKey || keyRole(adminKey) !== 'service_role')) {
    fail('Defina a chave administrativa no ambiente protegido EVENTSCAN_SUPABASE_ADMIN_KEY.')
  }
  if (!publicKey.startsWith('sb_publishable_') && (!publicKey || keyRole(publicKey) !== 'anon')) {
    fail('Defina a chave pública em EVENTSCAN_SUPABASE_PUBLISHABLE_KEY.')
  }
  if (typeof config.recipient !== 'string' || !/^age1[a-z0-9]{58}$/.test(config.recipient)) {
    fail('Informe a chave pública do destinatário age na propriedade recipient.')
  }
  if (typeof config.bundlePath !== 'string' || !config.bundlePath.endsWith('.age')) {
    fail('Escolha o caminho do arquivo criptografado com extensão .age em bundlePath.')
  }

  const output = resolve(config.bundlePath)
  const directory = realpathSync(dirname(output))
  const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
  const fromRepository = relative(repository, directory)
  if (!fromRepository || (!isAbsolute(fromRepository) && fromRepository.split(sep)[0] !== '..')) {
    fail('Escolha uma pasta fora do repositório para o arquivo criptografado.')
  }

  return {
    api: api.origin, site, adminKey, publicKey, recipient: config.recipient,
    output: join(directory, basename(output)),
    accounts: emails.map((email, index) => ({
      email, slot: index ? 'organizer-' + index : 'admin',
      role: index ? 'organizer' : 'admin',
      name: index ? 'Organizador ' + index : 'Administrador principal',
    })),
  }
}

function makeClient(url, key) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function checked(response, operation) {
  if (response.error) {
    const code = response.error.code
    const suffix = typeof code === 'string' && /^[a-zA-Z0-9_]{1,40}$/.test(code) ? ' (' + code + ')' : ''
    fail(operation + suffix + '.')
  }
  return response.data
}

function saveBundle(config, accounts) {
  const content = Buffer.from(JSON.stringify({
    site: config.site + '/entrar',
    createdAt: new Date().toISOString(),
    accounts: accounts.map(({ name, email, password }) => ({ name, email, temporaryPassword: password })),
  }, null, 2))
  try {
    const sealed = spawnSync('age', ['--encrypt', '--recipient', config.recipient], {
      input: content, stdio: ['pipe', 'pipe', 'ignore'],
    })
    if (sealed.error || sealed.status !== 0 || !sealed.stdout?.length) {
      fail('A criptografia falhou. Confira se age está instalado e se a chave pública é válida.')
    }
    writeFileSync(config.output, sealed.stdout, { flag: 'wx', mode: 0o600 })
  } finally {
    content.fill(0)
  }
}

async function provision() {
  const config = readConfiguration()
  const admin = makeClient(config.api, config.adminKey)
  const plan = async () => checked(await admin.rpc('provisioned_account_plan', {
    p_emails: config.accounts.map(account => account.email),
  }), 'Não foi possível consultar as contas. Confira a conexão, a chave administrativa e as migrações')

  const records = await plan()
  for (const record of records) {
    if (!config.accounts.some(account => account.email === record.email && account.slot === record.slot && account.role === record.role)) {
      fail('O e-mail ou a posição de uma das contas já está em uso. Confira o cadastro existente antes de continuar.')
    }
  }

  const newAccounts = config.accounts.filter(account => !records.some(record => record.slot === account.slot))
    .map(account => ({ ...account, password: randomBytes(32).toString('base64url') + 'Z4!' }))

  if (newAccounts.length) {
    saveBundle(config, newAccounts)
    console.log('Credenciais criptografadas em ' + config.output)
    for (const account of newAccounts) {
      checked(await admin.auth.admin.createUser({
        email: account.email, password: account.password, email_confirm: true,
        user_metadata: { display_name: account.name },
        app_metadata: { eventscan_account_slot: account.slot },
      }), 'Não foi possível criar a conta ' + account.name)
    }
  }

  const verified = await plan()
  if (verified.length !== config.accounts.length || config.accounts.some(account => !verified.some(record =>
    record.slot === account.slot && record.email === account.email && record.role === account.role))) {
    fail('A verificação dos papéis no banco falhou.')
  }
  const counts = checked(await admin.rpc('seed_provisioned_products'), 'Não foi possível cadastrar os produtos de exemplo')

  for (const account of newAccounts) {
    const login = makeClient(config.api, config.publicKey)
    const session = checked(await login.auth.signInWithPassword({ email: account.email, password: account.password }),
      'O login inicial falhou para ' + account.name)
    if (session.user?.id !== verified.find(row => row.slot === account.slot)?.id) {
      fail('A sessão do Auth não corresponde à conta provisionada.')
    }
    try {
      const state = checked(await login.rpc('account_credential_state'), 'Não foi possível confirmar a troca obrigatória de senha')
      if (state !== 'password_required') fail('A conta inicial deve exigir a troca de senha.')
    } finally {
      checked(await login.auth.signOut({ scope: 'local' }), 'Não foi possível encerrar a sessão de teste')
    }
  }

  console.table(config.accounts.map(account => ({
    perfil: account.name, email: account.email,
    acesso: newAccounts.some(row => row.slot === account.slot) ? 'Login inicial validado no Auth'
      : verified.find(row => row.slot === account.slot)?.activated ? 'Ativado' : 'Aguardando troca de senha',
    exemplos: Number(counts.find(row => row.slot === account.slot)?.example_count ?? 0),
  })))
}

provision().catch(issue => {
  console.error(issue instanceof ProvisioningError ? issue.message
    : 'O provisionamento foi interrompido. Confira a configuração, a rede e as permissões de escrita do arquivo criptografado.')
  process.exitCode = 1
})
