import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, QrCode, ShieldCheck, Ticket } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { errorMessage } from '../data'
import { isDemo } from '../data/supabase'
import type { DemoPersona } from '../data/demo-seed'
import type { Profile } from '../data/types'
import { Notice } from '../components/ui'

const personas = [
  { persona: 'participant', label: 'Participante', Icon: Ticket, route: '/ingressos' },
  { persona: 'organizer', label: 'Organizador', Icon: CalendarDays, route: '/organizacao' },
  { persona: 'staff', label: 'Equipe de check-in', Icon: QrCode, route: '/check-in' },
  { persona: 'admin', label: 'Administrador', Icon: ShieldCheck, route: '/administracao' },
] as const

function homeFor(profile: Profile) {
  if (profile.role === 'organizer') return '/organizacao'
  return profile.role === 'admin' ? '/administracao' : '/ingressos'
}

export default function AuthPage({ signup = false }: { signup?: boolean }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()
  const next = typeof state?.next === 'string' && state.next.startsWith('/') && !state.next.startsWith('//') ? state.next as string : null
  const [loading, setLoading] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [failure, setFailure] = useState('')
  const [confirmation, setConfirmation] = useState(false)

  useEffect(() => {
    if (loggedIn && auth.profile && !auth.pending) {
      navigate(next ?? homeFor(auth.profile), { replace: true })
    }
    if (loggedIn && auth.error) {
      setFailure(auth.error)
      setLoggedIn(false)
      setLoading(null)
    }
  }, [loggedIn, auth.profile, auth.pending, auth.error, navigate, next])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading('form')
    setFailure('')
    setConfirmation(false)
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email')).trim()
    const password = String(fields.get('password') ?? '')
    try {
      if (signup) {
        const name = String(fields.get('name')).trim()
        if (!name) throw new Error('Informe seu nome.')
        if (!await auth.signUp(name, email, password)) {
          setConfirmation(true)
          setLoading(null)
          return
        }
      } else {
        await auth.signIn(email, password)
      }
      setLoggedIn(true)
    } catch (issue) {
      setFailure(errorMessage(issue))
      setLoading(null)
    }
  }

  async function switchPersona(persona: DemoPersona, route: string) {
    setLoading(persona)
    setFailure('')
    try {
      await auth.signInAs(persona)
      navigate(persona === 'participant' && next ? next : route, { replace: true })
    } catch (issue) {
      setFailure(errorMessage(issue))
      setLoading(null)
    }
  }

  return (
    <div className="container auth-layout">
      <section className="auth-panel panel">
        <Link to="/" className="back-link"><ArrowLeft size={16} /> Voltar ao início</Link>
        <h1>{signup ? 'Crie sua conta' : 'Entre no EventScan'}</h1>
        <p className="auth-intro">{signup ? 'Reserve seus ingressos e acompanhe seus eventos.' : 'Acesse seus ingressos ou o painel do seu evento.'}</p>
        {isDemo && <Notice tone="info">Demonstração acadêmica. Use apenas dados fictícios.</Notice>}
        {failure && <Notice>{failure}</Notice>}
        {confirmation ? (
          <Notice tone="success">Cadastro recebido. Confira sua caixa de entrada e confirme o e-mail para entrar.</Notice>
        ) : (
          <>
            {isDemo && !signup && (
              <div className="demo-profiles" aria-label="Perfis da demonstração">
                {personas.map(({ persona, label, Icon, route }) => (
                  <button className="persona-button" key={persona} disabled={Boolean(loading)} onClick={() => switchPersona(persona, route)}>
                    <Icon size={21} /><span>{loading === persona ? 'Entrando…' : label}</span><ArrowRight size={16} />
                  </button>
                ))}
              </div>
            )}
            <form className="stack-form" onSubmit={submit}>
              {signup && <label>Nome completo<input name="name" autoComplete="name" placeholder="Seu nome" required maxLength={100} /></label>}
              <label>{isDemo ? 'E-mail fictício' : 'E-mail'}<input name="email" type="email" autoComplete="email" required maxLength={254}
                placeholder={isDemo ? 'voce@example.test' : 'voce@email.com'} /></label>
              {!isDemo && <label>Senha<input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? 8 : undefined} required placeholder={signup ? 'Pelo menos 8 caracteres' : 'Sua senha'} /></label>}
              <button className={`button ${isDemo && !signup ? 'secondary' : 'primary'}`} disabled={Boolean(loading)}>
                {loading === 'form' ? 'Aguarde…' : signup ? 'Criar minha conta' : isDemo ? 'Entrar com e-mail fictício' : 'Entrar'} <ArrowRight size={18} />
              </button>
            </form>
          </>
        )}
        <p className="auth-switch">{signup ? 'Já tem uma conta?' : 'Ainda não tem conta?'} <Link to={signup ? '/entrar' : '/cadastro'} state={{ next }}>{signup ? 'Entrar' : 'Cadastre-se'}</Link></p>
      </section>
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-art-copy"><Ticket size={33} /><strong>Seu próximo evento<br />está por aqui.</strong></div>
      </aside>
    </div>
  )
}
