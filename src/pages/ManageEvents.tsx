import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, ImagePlus, Plus, ScanLine, Ticket, UserRoundPlus, UsersRound } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { data, errorMessage } from '../data'
import { brasiliaInstant, coverTypes, eventDate, eventStatusLabels, eventTime, isUpcoming, maxCoverSize, ticketState } from '../data/domain'
import { useResource } from '../data/useResource'
import { categories } from '../data/types'
import type { Category, EventRecord, Profile } from '../data/types'
import { Busy, Confirmation, Cover, Empty, Notice, PageHeading, Pager } from '../components/ui'

export function EventStatus({ event }: { event: EventRecord }) {
  const tone = event.status === 'published' ? 'success-text' : event.status === 'cancelled' ? 'danger-text' : ''
  return <span className={`status-chip ${tone}`}>{eventStatusLabels[event.status]}</span>
}

export function ManageEvents({ admin = false }: { admin?: boolean }) {
  const { profile } = useAuth()
  const events = useResource(`managed-events:${profile!.id}:${profile!.role}`, () => data.managedEvents(profile!), true)
  return (
    <>
      <PageHeading title={admin ? 'Eventos' : 'Meus eventos'}
        action={!admin && <Link className="button primary" to="/organizacao/eventos/novo"><Plus size={18} /> Novo evento</Link>}>
        {admin ? 'Consulte os eventos cadastrados na plataforma.' : 'Publique seus eventos, consulte inscritos e gerencie a equipe.'}
      </PageHeading>
      {events.pending && <Busy />}
      {events.error && <Notice>{events.error}</Notice>}
      {!events.pending && !events.error && events.data?.length === 0 && <Empty title="Nenhum evento cadastrado">Os eventos cadastrados aparecerão aqui.</Empty>}
      {!!events.data?.length && (
        <div className="panel managed-list">
          {events.data.map(event => (
            <article className="managed-row" key={event.id}>
              <Cover event={event} />
              <div className="managed-name"><h2>{event.title}</h2><span><CalendarDays size={14} /> {eventDate(event.starts_at)} · {event.city}</span></div>
              <div className="badge-row"><EventStatus event={event} />{event.is_demo && <span className="status-chip">Demo</span>}</div>
              <span className="managed-capacity">{event.reserved_count}/{event.capacity} vagas</span>
              {admin
                ? <Link className="button secondary small" to={`/eventos/${event.id}`}>Ver detalhes <ArrowUpRight size={16} /></Link>
                : <Link className="button secondary small" to={`/organizacao/eventos/${event.id}`} aria-label={`Gerenciar ${event.title}`}>Gerenciar <ArrowRight size={16} /></Link>}
            </article>
          ))}
        </div>
      )}
    </>
  )
}

export function CreateEvent() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState('')
  const [file, setFile] = useState<File>()

  async function submit(form: FormEvent<HTMLFormElement>) {
    form.preventDefault()
    setFailure('')
    setSubmitting(true)
    const fields = new FormData(form.currentTarget)
    const text = (name: string) => String(fields.get(name) ?? '').trim()
    try {
      const cover_url = file ? null : text('cover_url') || null
      if (cover_url && !['https:', 'http:'].includes(new URL(cover_url).protocol)) {
        throw new Error('Informe um endereço HTTP ou HTTPS para a capa.')
      }
      const title = text('title')
      const description = text('description')
      const venue = text('venue')
      const city = text('city')
      if (title.length < 3 || description.length < 10 || venue.length < 3 || city.length < 2) {
        throw new Error('Preencha o nome, a descrição, o endereço e a cidade.')
      }
      const starts_at = brasiliaInstant(text('starts_at'))
      if (!isUpcoming({ starts_at })) throw new Error('Escolha uma data futura no horário de Brasília.')
      const event = await data.create(profile!, {
        title, description, category: text('category') as Category, starts_at, venue, city, cover_url,
        capacity: Number(fields.get('capacity')),
      }, file)
      navigate(`/organizacao/eventos/${event.id}`, { replace: true })
    } catch (issue) {
      setFailure(errorMessage(issue))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Link className="back-link" to="/organizacao/eventos"><ArrowLeft size={17} /> Meus eventos</Link>
      <PageHeading title="Novo evento">Salve um rascunho e publique quando estiver pronto.</PageHeading>
      <form className="panel editor stack-form" onSubmit={submit}>
        <div className="form-grid">
          <label>Nome do evento<input name="title" placeholder="Ex. Semana de Tecnologia" required minLength={3} maxLength={100} /></label>
          <label>Categoria<select name="category" required defaultValue=""><option value="" disabled>Selecione uma categoria</option>
            {categories.map(category => <option key={category}>{category}</option>)}
          </select></label>
          <label className="full">Descrição<textarea name="description" placeholder="Conte o que os participantes vão encontrar." rows={4} required minLength={10} maxLength={2000} /></label>
          <label>Data e horário de Brasília<input name="starts_at" type="datetime-local" required /></label>
          <label>Capacidade máxima<input name="capacity" type="number" min={1} max={100000} step={1} placeholder="Ex. 100" required /></label>
          <label>Endereço<input name="venue" placeholder="Local, rua e número" required minLength={3} maxLength={160} /></label>
          <label>Cidade<input name="city" placeholder="Ex. São Paulo, SP" required minLength={2} maxLength={100} /></label>
          <div className="full cover-upload">
            <label><span><ImagePlus size={17} /> Imagem de capa</span><input type="file" accept={coverTypes.join(',')}
              onChange={e => {
                const selected = e.target.files?.[0]
                setFailure('')
                if (selected && (!coverTypes.includes(selected.type) || selected.size > maxCoverSize)) {
                  setFailure('Use uma imagem JPEG, PNG, WebP ou AVIF de até 5 MB.')
                  e.target.value = ''
                  setFile(undefined)
                  return
                }
                setFile(selected)
              }} /><small>JPEG, PNG, WebP ou AVIF de até 5 MB.</small></label>
            <label>Ou use o endereço de uma imagem<input type="url" name="cover_url" placeholder="https://..." maxLength={1200} disabled={Boolean(file)} /></label>
          </div>
        </div>
        {failure && <Notice>{failure}</Notice>}
        <div className="form-actions"><Link className="button secondary" to="/organizacao/eventos">Voltar</Link>
          <button className="button primary" disabled={submitting}>{submitting ? 'Salvando…' : 'Salvar rascunho'} <ArrowRight size={18} /></button></div>
      </form>
    </>
  )
}

export function ManageEvent() {
  const { id = '' } = useParams()
  const { profile } = useAuth()
  const request = useResource(`manage:${id}:${profile!.id}`, () => data.event(id, profile), true)

  if (request.pending) return <Busy />
  if (request.error && !request.data) return <Notice>{request.error}</Notice>
  if (!request.data || request.data.owner_id !== profile!.id) {
    return <Empty title="Evento indisponível" action={<Link to="/organizacao/eventos">Meus eventos</Link>}>Gerencie os eventos da sua conta.</Empty>
  }
  return <EventManagement key={id} event={request.data} viewer={profile!} refreshEvent={request.refresh} />
}

function EventManagement({ event, viewer, refreshEvent }: { event: EventRecord; viewer: Profile; refreshEvent: () => void }) {
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmation, setConfirmation] = useState<'event' | 'ticket' | null>(null)
  const [cancelId, setCancelId] = useState('')
  const [email, setEmail] = useState('')
  const { id } = event
  const roster = useResource(`roster:${id}:${viewer.id}:${page}`, () => data.roster(viewer, id, page), true)
  const team = useResource(`team:${id}:${viewer.id}`, () => data.team(viewer, id))

  async function run(action: () => Promise<unknown>, message: string) {
    setFailure('')
    setSuccess('')
    setPending(true)
    try {
      await action()
      setSuccess(message)
      setConfirmation(null)
      refreshEvent()
      roster.refresh()
      team.refresh()
    } catch (issue) {
      setFailure(errorMessage(issue))
    } finally {
      setPending(false)
    }
  }

  function addStaff(form: FormEvent<HTMLFormElement>) {
    form.preventDefault()
    void run(async () => {
      await data.assignStaff(viewer, id, email.trim())
      setEmail('')
    }, 'Funcionário autorizado para este evento.')
  }

  return (
    <>
      <Link className="back-link" to="/organizacao/eventos"><ArrowLeft size={17} /> Meus eventos</Link>
      <PageHeading title={event.title} action={<EventStatus event={event} />}>{eventDate(event.starts_at)} às {eventTime(event.starts_at)} · {event.city}</PageHeading>
      {failure && <Notice>{failure}</Notice>}
      {success && <Notice tone="success">{success}</Notice>}
      <section className="panel management-summary">
        <Cover event={event} />
        <div>
          <h2>Visão do evento</h2>
          <p>{event.venue}</p>
          <div className="management-counts"><span><Ticket size={16} /> {event.reserved_count} de {event.capacity} vagas reservadas</span>
            <span><UsersRound size={16} /> {event.present_count} presentes</span></div>
          <div className="button-row">
            {event.status === 'draft' && (
              <button className="button primary small" disabled={pending} onClick={() => run(() => data.changeStatus(viewer, id, 'published'), 'Evento publicado no catálogo.')}>Publicar evento</button>
            )}
            <Link className="button secondary small" to={`/eventos/${id}`}>Ver página <ArrowUpRight size={16} /></Link>
            <Link className="button secondary small" to={`/organizacao/eventos/${id}/configuracao`}>Configurar evento</Link>
            <Link className="button secondary small" to={`/organizacao/monitoramento?evento=${id}`}>Monitoramento</Link>
            {event.status === 'published' && <Link className="button secondary small" to={`/check-in?evento=${id}`}><ScanLine size={16} /> Abrir check-in</Link>}
            {event.status !== 'cancelled' && <button disabled={pending} className="text-button danger-text" onClick={() => setConfirmation('event')}>Cancelar evento</button>}
          </div>
        </div>
      </section>
      {confirmation === 'event' && (
        <Confirmation title="Cancelar este evento?" confirmLabel="Confirmar cancelamento" busy={pending} onCancel={() => setConfirmation(null)}
          onConfirm={() => run(() => data.changeStatus(viewer, id, 'cancelled'), 'Evento cancelado.')}>
          O catálogo deixará de exibir o evento, e os ingressos emitidos perderão a validade.
        </Confirmation>
      )}
      <section className="panel management-panel">
        <div className="panel-heading"><UsersRound size={21} /><div><h2>Inscritos</h2><p>Consulte as reservas e os horários de entrada.</p></div></div>
        {confirmation === 'ticket' && (
          <Confirmation title="Cancelar este ingresso?" confirmLabel="Cancelar ingresso" busy={pending} onCancel={() => setConfirmation(null)}
            onConfirm={() => run(() => data.cancelTicket(viewer, id, cancelId), 'Ingresso cancelado. A vaga voltou a ficar disponível.')}>
            O código perderá a validade e a vaga será liberada.
          </Confirmation>
        )}
        {roster.pending && <Busy />}
        {roster.error && <Notice>{roster.error}</Notice>}
        {roster.data && (roster.data.rows.length ? (
          <div className="table-wrap">
            <table><thead><tr><th>Participante</th><th>Status</th><th>Horário de entrada</th><th>Ações</th></tr></thead>
              <tbody>{roster.data.rows.map(row => {
                const state = ticketState(row, event)
                return (
                  <tr key={row.id}><td><strong>{row.display_name}</strong><small>{row.email}</small></td>
                    <td><span className={`status-chip ${state.tone}-text`}>{state.label}</span></td>
                    <td>{row.checked_in_at ? `${eventDate(row.checked_in_at)} · ${eventTime(row.checked_in_at)}` : '—'}</td>
                    <td>{!row.checked_in_at && !row.cancelled_at && event.status !== 'cancelled' && <button className="text-button danger-text"
                      disabled={pending} aria-label={`Cancelar ingresso de ${row.display_name}`} onClick={() => { setCancelId(row.id); setConfirmation('ticket') }}>Cancelar</button>}</td></tr>
                )
              })}</tbody>
            </table>
          </div>
        ) : <p className="muted">Ainda não há inscrições.</p>)}
        <Pager page={page} next={Boolean(roster.data?.hasMore)} onChange={setPage} />
      </section>
      <section className="panel management-panel">
        <div className="panel-heading"><UserRoundPlus size={21} /><div><h2>Equipe de acesso</h2><p>Autorize uma conta cadastrada a fazer check-in neste evento.</p></div></div>
        <form className="staff-form" onSubmit={addStaff}>
          <label>E-mail do funcionário<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="equipe@exemplo.com" /></label>
          <button className="button primary small" disabled={pending || event.status === 'cancelled'}><Plus size={17} /> Autorizar funcionário</button>
        </form>
        {team.pending && <Busy />}
        {team.error && <Notice>{team.error}</Notice>}
        {team.data?.length ? (
          <ul className="team-list">
            {team.data.map(member => <li key={member.id}><div><strong>{member.display_name}</strong><span>{member.email}</span></div>
              <button disabled={pending} className="text-button danger-text" onClick={() => run(() => data.removeStaff(viewer, id, member.id), 'Acesso removido para este evento.')}>Remover acesso</button></li>)}
          </ul>
        ) : !team.pending && <p className="muted">Nenhum funcionário autorizado.</p>}
      </section>
    </>
  )
}
