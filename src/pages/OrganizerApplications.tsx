import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Busy, Confirmation, Empty, Notice, PageHeading, Pager } from '../components/ui'
import { useAction } from '../components/expansion/useAction'
import { useAuth } from '../data/auth'
import { eventDate } from '../data/domain'
import { applicationStatuses, latestApplication, requestOrganizer, reviewApplication, reviewQueue } from '../data/organizers'
import type { ApplicationDecision, ApplicationStatus } from '../data/organizers'
import { isDemo } from '../data/supabase'
import { useResource } from '../data/useResource'

function ApplicationBadge({ status, revoked }: { status: ApplicationStatus; revoked: boolean }) {
  if (revoked) return <span className="status-chip danger-text">Acesso revogado</span>
  const tone = status === 'approved' ? 'success-text' : status === 'rejected' ? 'danger-text' : ''
  return <span className={`status-chip ${tone}`}>{applicationStatuses[status]}</span>
}

export function RequestOrganizer() {
  const { profile, refreshProfile } = useAuth()
  const actor = profile!
  const latest = useResource(`organizer-application:${actor.id}`,
    () => isDemo ? Promise.resolve(null) : latestApplication(actor.id), !isDemo)
  const action = useAction(latest.refresh)
  const revoked = Boolean(latest.data?.access_revoked_at)
  useEffect(() => {
    if (latest.data?.status === 'approved' && !revoked && actor.role === 'participant') refreshProfile()
  }, [latest.data?.status, revoked, actor.role, refreshProfile])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    void action.run(() => requestOrganizer({
      organization_name: String(fields.get('organization_name') ?? '').trim(),
      contact_email: String(fields.get('contact_email') ?? '').trim(),
      city: String(fields.get('city') ?? '').trim(),
    }), 'Solicitação enviada para análise.')
  }

  return <div className="container page">
    <PageHeading title="Perfil de organizador">Solicite acesso para criar e gerenciar seus eventos.</PageHeading>
    {isDemo ? <Empty title="Demonstração acadêmica"
      action={<Link to="/entrar" className="button secondary">Escolher perfil de demonstração</Link>}>Use o perfil fictício de organizador para explorar esse painel.</Empty>
      : actor.role === 'organizer' ? <Notice tone="success">Seu perfil de organizador está ativo. <Link to="/organizacao" className="text-button">Abrir meus eventos <ArrowRight size={14} /></Link></Notice>
        : actor.role !== 'participant' ? <Empty title="Acesso reservado a participantes">Consulte a fila de solicitações no painel de administração.</Empty>
          : <>
            {latest.pending && <Busy />}
            {latest.error && <Notice>{latest.error} <button className="text-button" onClick={latest.refresh}>Tentar novamente</button></Notice>}
            {action.notice}
            {latest.data && <section className="panel expansion-panel">
              <div className="badge-row"><h2>{latest.data.organization_name}</h2><ApplicationBadge status={latest.data.status} revoked={revoked} /></div>
              <p className="muted">Solicitação enviada em {eventDate(latest.data.requested_at)}.</p>
              {latest.data.status === 'rejected' && <p>Confira os dados da organização e envie uma nova solicitação.</p>}
            </section>}
            {!latest.pending && !latest.error && (!latest.data || latest.data.status === 'rejected' || revoked) &&
              <form className="panel expansion-panel stack-form" onSubmit={submit}>
                <div className="form-grid">
                  <label>Nome da organização<input name="organization_name" required minLength={2} maxLength={120} /></label>
                  <label>E-mail de contato<input name="contact_email" type="email" required maxLength={254} defaultValue={actor.email} /></label>
                  <label>Cidade<input name="city" required minLength={2} maxLength={100} /></label>
                </div>
                <div><button className="button primary" disabled={action.busy}>{action.busy ? 'Enviando…' : 'Solicitar perfil de organizador'}</button></div>
              </form>}
          </>}
  </div>
}

export function ReviewOrganizers() {
  const viewer = useAuth().profile!
  const [status, setStatus] = useState<ApplicationStatus | 'all'>('pending')
  const [page, setPage] = useState(0)
  const [decision, setDecision] = useState<{ id: string; organization: string; status: ApplicationDecision } | null>(null)
  const queue = useResource(`organizer-queue:${viewer.id}:${status}:${page}`,
    () => isDemo ? Promise.resolve({ rows: [], hasMore: false }) : reviewQueue(status, page), !isDemo)
  const action = useAction(queue.refresh)

  if (isDemo) return <Empty title="Fila disponível no Supabase">Conecte o EventScan para consultar e revisar solicitações reais.</Empty>

  async function confirm() {
    if (!decision) return
    const label = decision.status === 'approved' ? 'Solicitação aprovada.' : 'Solicitação rejeitada.'
    if (await action.run(() => reviewApplication(decision.id, decision.status), label)) setDecision(null)
  }

  return <>
    <PageHeading title="Solicitações de organizador">Analise as solicitações de participantes antes de liberar a criação de eventos.</PageHeading>
    <label className="event-select">Situação<select value={status} onChange={e => {
      setStatus(e.target.value as ApplicationStatus | 'all')
      setPage(0)
      setDecision(null)
    }}>
      {Object.entries(applicationStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      <option value="all">Todas</option>
    </select></label>
    {action.notice}
    {decision && <Confirmation title={decision.status === 'approved' ? 'Aprovar solicitação' : 'Rejeitar solicitação'} busy={action.busy}
      confirmLabel={decision.status === 'approved' ? 'Confirmar aprovação' : 'Confirmar rejeição'}
      onConfirm={() => void confirm()} onCancel={() => setDecision(null)}>{decision.organization}</Confirmation>}
    {queue.pending && <Busy />}
    {queue.error && <Notice>{queue.error}</Notice>}
    {queue.data?.rows.length ? <div className="panel expansion-panel table-wrap">
      <table>
        <thead><tr><th>Organização</th><th>Solicitante</th><th>Envio</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody>{queue.data.rows.map(row => <tr key={row.id}>
          <td><strong>{row.organization_name}</strong><small>{row.city} · {row.contact_email}</small></td>
          <td>{row.applicant.display_name}<small>{row.applicant.email}</small></td>
          <td>{eventDate(row.requested_at)}</td>
          <td><ApplicationBadge status={row.status} revoked={Boolean(row.access_revoked_at)} />{row.reviewed_at && <small>{eventDate(row.reviewed_at)}</small>}</td>
          <td>{row.status === 'pending' && <div className="button-row">
            <button className="button secondary small" disabled={action.busy}
              onClick={() => setDecision({ id: row.id, organization: row.organization_name, status: 'approved' })}>Aprovar</button>
            <button className="text-button danger-text" disabled={action.busy}
              onClick={() => setDecision({ id: row.id, organization: row.organization_name, status: 'rejected' })}>Rejeitar</button>
          </div>}</td>
        </tr>)}</tbody>
      </table>
    </div> : !queue.pending && !queue.error && <Empty title="Nenhuma solicitação nessa situação">Selecione outro filtro para consultar o histórico.</Empty>}
    <Pager page={page} next={Boolean(queue.data?.hasMore)} onChange={setPage} />
  </>
}
