import { useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Copy, MapPin, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { data } from '../data'
import { eventDate, eventTime, ticketState } from '../data/domain'
import { useResource } from '../data/useResource'
import { Busy, Cover, Empty, Notice, PageHeading } from '../components/ui'

export default function Tickets() {
  const { profile } = useAuth()
  const { id } = useParams()
  const tickets = useResource(`tickets:${profile!.id}`, () => data.myTickets(profile!), true)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  if (tickets.pending) return <div className="container page"><Busy text="Carregando ingressos…" /></div>
  if (tickets.error && !tickets.data) return <div className="container page"><Notice>{tickets.error}</Notice></div>

  if (id) {
    const ticket = tickets.data?.find(row => row.id === id)
    if (!ticket) return (
      <div className="container page"><Empty title="Ingresso indisponível" action={<Link className="button secondary" to="/ingressos">Meus ingressos</Link>}>
        Acesse os ingressos vinculados à sua conta.
      </Empty></div>
    )
    const state = ticketState(ticket, ticket.event)
    const cancelled = state.tone === 'danger'

    async function copy(code: string) {
      setCopyError(false)
      try {
        await navigator.clipboard.writeText(code)
        setCopied(true)
      } catch {
        setCopyError(true)
      }
    }

    return (
      <div className="container page ticket-page">
        <Link className="back-link" to="/ingressos"><ArrowLeft size={16} /> Meus ingressos</Link>
        <div className="digital-ticket">
          <Cover event={ticket.event} className="ticket-cover" />
          <div className="ticket-top">
            <div className="badge-row">
              <span className={`status-chip ${state.tone}-text`}>{state.label}</span>
              {ticket.event.is_demo && <span className="status-chip">Demonstração</span>}
            </div>
            <h1>{ticket.event.title}</h1>
            <div className="ticket-meta">
              <span><CalendarDays size={17} /> {eventDate(ticket.event.starts_at)} · {eventTime(ticket.event.starts_at)}</span>
              <span><MapPin size={17} /> {ticket.event.venue} · {ticket.event.city}</span>
            </div>
            <p className="muted">{profile!.display_name}</p>
          </div>
          <div className="ticket-tear" aria-hidden="true" />
          <div className="ticket-qr">
            {cancelled ? <Notice>Este ingresso não dá acesso ao evento.</Notice> : (
              <>
                <div className="qr-tile"><QRCodeSVG value={ticket.code} title="QR Code do ingresso" size={192} level="M" marginSize={4} /></div>
                <p>{ticket.checked_in_at ? `Entrada registrada às ${eventTime(ticket.checked_in_at)}.` : 'Apresente este QR Code na entrada.'}</p>
                <label className="ticket-code">Código do ingresso<input readOnly value={ticket.code} onFocus={e => e.currentTarget.select()} /></label>
                <button className="button secondary small" onClick={() => copy(ticket.code)}><Copy size={16} /> {copied ? 'Código copiado' : 'Copiar código'}</button>
                {copyError && <Notice tone="info">Selecione e copie o código no campo acima.</Notice>}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container page">
      <PageHeading title="Meus ingressos">Seus QR Codes ficam disponíveis aqui.</PageHeading>
      {tickets.error && <Notice>{tickets.error}</Notice>}
      {tickets.data?.length ? (
        <div className="ticket-grid">
          {tickets.data.map(ticket => {
            const state = ticketState(ticket, ticket.event)
            return (
              <article className="panel ticket-card" key={ticket.id}>
                <Cover event={ticket.event} className="ticket-cover" />
                <div className="ticket-card-body">
                  <span className={`status-chip ${state.tone}-text`}>{state.label}</span>
                  <h2>{ticket.event.title}</h2>
                  <div className="ticket-meta">
                    <span><CalendarDays size={16} /> {eventDate(ticket.event.starts_at)} · {eventTime(ticket.event.starts_at)}</span>
                    <span><MapPin size={16} /> {ticket.event.city}</span>
                  </div>
                  <Link className="button secondary small" to={`/ingressos/${ticket.id}`}><QrCode size={17} /> Ver ingresso <ArrowRight size={16} /></Link>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <Empty title="Você ainda não tem ingressos" action={<Link to="/#eventos" className="button primary">Explorar eventos <ArrowRight size={18} /></Link>}>
          Escolha um evento e reserve sua vaga.
        </Empty>
      )}
    </div>
  )
}
