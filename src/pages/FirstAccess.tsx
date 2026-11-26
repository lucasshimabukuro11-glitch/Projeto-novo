import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Busy, Notice } from '../components/ui'
import { errorMessage } from '../data'
import { useAuth } from '../data/auth'

export default function FirstAccess() {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [complete, setComplete] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setFailure('')
    setBusy(true)
    try {
      if (auth.credentialState === 'finish_required') {
        await auth.finishFirstAccess()
      } else {
        const password = String(fields.get('password') ?? '')
        if (password.length < 8 || password !== fields.get('confirmation')) {
          throw new Error('Confirme a nova senha com pelo menos 8 caracteres.')
        }
        await auth.changeInitialPassword(password)
      }
      setComplete(true)
    } catch (issue) { setFailure(errorMessage(issue)) }
    finally { setBusy(false) }
  }

  async function leave() {
    try { await auth.signOut() }
    catch (issue) { setFailure(errorMessage(issue)) }
  }

  return <div className="container auth-layout">
    <section className="auth-panel panel">
      <h1>Primeiro acesso</h1>
      {failure && <Notice>{failure}</Notice>}
      {auth.pending ? <Busy text="Verificando sessão…" />
        : complete || auth.credentialState === 'sign_in_required' ? <>
          <Notice tone="success">Senha atualizada. Entre novamente com a nova senha para liberar o painel.</Notice>
          {auth.credentialState === 'sign_in_required'
            ? <button className="button primary" onClick={() => void leave()}>Encerrar esta sessão <ArrowRight size={18} /></button>
            : <Link to="/entrar" className="button primary">Entrar com a nova senha <ArrowRight size={18} /></Link>}
        </> : auth.credentialState === 'active'
          ? <Link to="/entrar" className="button primary">Entrar no EventScan <ArrowRight size={18} /></Link>
          : <>
            <p className="auth-intro">{auth.credentialState === 'finish_required' ? 'Sua nova senha já está salva. Conclua a ativação para acessar o painel.'
              : 'Substitua a senha temporária para liberar as funções da sua conta.'}</p>
            <form className="stack-form" onSubmit={save}>
              {auth.credentialState === 'password_required' && <>
                <label>Nova senha<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
                <label>Confirmar nova senha<input name="confirmation" type="password" autoComplete="new-password" minLength={8} required /></label>
              </>}
              <button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Concluir primeiro acesso'} <ArrowRight size={18} /></button>
            </form>
            <div className="button-row">
              <Link to="/recuperar-senha" className="text-button">Recuperar senha</Link>
              <button className="text-button" onClick={() => void leave()}>Sair</button>
            </div>
          </>}
    </section>
    <aside className="auth-art" aria-hidden="true">
      <div className="auth-art-copy"><ShieldCheck size={33} /><strong>Ative seu acesso<br />ao EventScan.</strong></div>
    </aside>
  </div>
}
