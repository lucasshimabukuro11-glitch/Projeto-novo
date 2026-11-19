import { useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, MapPin, Ticket, Users } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { data, errorMessage } from '../data'
import { eventDate, eventStatusLabels, eventTime, isUpcoming } from '../data/domain'
import { useResource } from '../data/useResource'
import { expansion } from '../data/expansion'
import TypedReservation from '../components/expansion/TypedReservation'
import { Busy, Cover, Empty, Notice } from '../components/ui'

export default function EventDetails() {
  const { id = '' } = useParams()
  const { profile } = useAuth()
  const request = useResource(`public-event:${id}:${profile?.id}`, () => data.event(id, profile), true)
  const tickets = useResource(`event-tickets:${profile?.id}`, () =>
    profile?.role === 'participant' ? data.myTickets(profile) : Promise.resolve([]), profile?.role === 'participant')
  const sale = useResource(`ticket-options:${id}:${profile?.id}:${Boolean(request.data)}`, () =>
    request.data?.id === id ? expansion.options(id,profile) : Promise.resolve(null),true)
  const [failure, setFailure] = useState('')
  const [booking, setBooking] = useState(false)
  const navigate = useNavigate()

  if (request.pending) return <div className="container page"><Busy text="Carregando evento…" /></div>
  if (request.error && !request.data) return <div className="container page"><Notice>{request.error}</Notice></div>
  if (!request.data) return (
    <div className="container page">
      <Empty title="Evento indisponível" action={<Link className="button secondary" to="/#eventos">Ver próximos eventos</Link>}>
        Confira os eventos publicados no catálogo.
      </Empty>
    </div>
  )

  const event = request.data
  const existing = tickets.data?.find(ticket => ticket.event_id === event.id)
  const remaining = event.capacity - event.reserved_count
  const canBook = event.status === 'published' && isUpcoming(event) && remaining > 0

  async function reserve() {
    if (!profile) return
    setBooking(true)
    setFailure('')
    try {
      const ticket = await data.reserve(profile, id)
      navigate(`/ingressos/${ticket.id}`)
    } catch (issue) {
      setFailure(errorMessage(issue))
      request.refresh()
    } finally {
      setBooking(false)
    }
  }

  return (
    <div className="container page event-details">
      <Link className="back-link" to="/#eventos"><ArrowLeft size={16} /> Ver eventos</Link>
      <Cover event={event} className="details-cover" />
      <div className={`details-grid ${sale.data?.configured ? 'details-with-reservation' : ''}`}>
        <div>
          <div className="badge-row">
            <span className="status-chip accent">{event.category}</span>
            {event.is_demo && <span className="status-chip">Demonstração</span>}
            {event.status !== 'published' && <span className={`status-chip ${event.status === 'cancelled' ? 'danger-text' : ''}`}>{eventStatusLabels[event.status]}</span>}
          </div>
          <h1>{event.title}</h1>
          <div className="event-details-meta">
            <div><CalendarDays size={22} /><div><strong>{eventDate(event.starts_at)}</strong><span>{eventTime(event.starts_at)} · Horário de Brasília</span></div></div>
            <div><MapPin size={22} /><div><strong>{event.venue}</strong><span>{event.city}</span></div></div>
          </div>
          <h2>Sobre o evento</h2>
          <p className="event-description">{event.description}</p>
        </div>
        <aside className="panel reservation">
          <div className="feature-icon"><Ticket size={22} /></div>
          <h2>Ingresso digital</h2>
          <p>Apresente seu QR Code na entrada do evento.</p>
          <div className="reservation-price"><strong>Gratuito</strong><span><Users size={15} /> {remaining} {remaining === 1 ? 'vaga' : 'vagas'}</span></div>
          {failure && <Notice>{failure}</Notice>}
          {sale.pending ? <Busy text="Carregando modalidades…" /> : sale.error ? (
            <Notice>{sale.error} <button className="text-button" onClick={sale.refresh}>Tentar novamente</button></Notice>
          ) : sale.data?.configured ? (
            <TypedReservation key={event.id} event={event} options={sale.data.options} viewer={profile}
              tickets={tickets.data?.filter(ticket => ticket.event_id === id) ?? []} open={canBook}
              onRefresh={() => { request.refresh(); sale.refresh(); tickets.refresh() }} />
          ) : existing ? (
            <Link className="button primary" to={`/ingressos/${existing.id}`}>Ver meu ingresso <ArrowRight size={18} /></Link>
          ) : !canBook ? (
            <span className="reservation-closed">{remaining === 0 && event.status === 'published' && isUpcoming(event) ? 'Ingressos esgotados' : 'Inscrições encerradas'}</span>
          ) : !profile ? (
            <Link className="button primary" to="/cadastro" state={{ next: `/eventos/${id}` }}>Reserve seu ingresso <ArrowRight size={18} /></Link>
          ) : profile.role === 'participant' ? (
            <button className="button primary" disabled={booking || tickets.pending} onClick={reserve}>{booking ? 'Reservando…' : 'Reservar ingresso'} <ArrowRight size={18} /></button>
          ) : (
            <p className="reservation-closed">Faça login com uma conta de participante para reservar.</p>
          )}
        </aside>
      </div>
    </div>
  )
}
