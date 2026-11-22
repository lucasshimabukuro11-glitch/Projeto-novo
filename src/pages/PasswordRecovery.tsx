import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, KeyRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { errorMessage } from '../data'
import { useAuth } from '../data/auth'
import { isDemo } from '../data/supabase'
import { Busy, Empty, Notice } from '../components/ui'

export default function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setFailure('')
    setBusy(true)
    try {
      if (reset) {
        const password = String(fields.get('password') ?? '')
        if (password.length < 8 || password !== fields.get('confirmation')) {
          throw new Error('Confirme a nova senha com pelo menos 8 caracteres.')
        }
        await auth.changeRecoveredPassword(password)
      } else {
        await auth.requestRecovery(String(fields.get('email') ?? '').trim())
      }
      setDone(true)
    } catch (issue) {
      setFailure(errorMessage(issue))
    } finally {
      setBusy(false)
    }
  }

  if (isDemo) return <div className="container page"><Empty title="Recuperação de senha indisponível"
    action={<Link className="button secondary" to="/entrar">Voltar para entrar</Link>}>Este recurso usa contas reais do Supabase.</Empty></div>

  return <div className="container auth-layout">
    <section className="auth-panel panel">
      <Link to="/entrar" className="back-link"><ArrowLeft size={16} /> Voltar para entrar</Link>
      <h1>{reset ? 'Redefinir senha' : 'Recuperar senha'}</h1>
      <p className="auth-intro">{reset ? 'Escolha a nova senha da sua conta.' : 'Informe o e-mail da sua conta para solicitar um link de recuperação.'}</p>
      {failure && <Notice>{failure}</Notice>}
      {done ? <Notice tone="success">{reset ? <>Sua senha foi atualizada. <Link className="text-button" to="/">Continuar no EventScan</Link></>
        : 'Se houver uma conta com esse e-mail, você receberá um link de recuperação.'}</Notice>
        : reset && auth.recoveryPending ? <Busy text="Validando o link de recuperação…" />
          : reset && !auth.recoveringPassword ? <Notice>Link de recuperação inválido ou expirado. <Link to="/recuperar-senha" className="text-button">Solicitar outro link</Link></Notice>
          : <form className="stack-form" onSubmit={submit}>
            {reset ? <>
              <label>Nova senha<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
              <label>Confirmar nova senha<input name="confirmation" type="password" autoComplete="new-password" minLength={8} required /></label>
            </> : <label>E-mail<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>}
            <button className="button primary" disabled={busy}>{busy ? 'Aguarde…' : reset ? 'Salvar nova senha' : 'Enviar link de recuperação'} <ArrowRight size={18} /></button>
          </form>}
    </section>
    <aside className="auth-art" aria-hidden="true"><div className="auth-art-copy"><KeyRound size={33} /><strong>Recupere o acesso<br />à sua conta.</strong></div></aside>
  </div>
}
