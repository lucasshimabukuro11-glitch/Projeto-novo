import { useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, MapPin, ScanLine, Search, Sparkles, Ticket } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { eventDate, searchText } from '../data/domain'
import { data } from '../data'
import { useResource } from '../data/useResource'
import { Busy, Cover, Empty, Notice } from '../components/ui'
import { categories } from '../data/types'
import type { Category, EventRecord } from '../data/types'

const benefits = [
  { Icon: Ticket, title: 'Ingresso no celular', copy: 'Reserve sua vaga e acesse o QR Code em Meus ingressos.' },
  { Icon: ScanLine, title: 'Check-in em segundos', copy: 'Apresente o QR Code na entrada do evento para validar seu acesso.' },
  { Icon: ChartNoAxesCombined, title: 'Gestão em tempo real', copy: 'Publique eventos e acompanhe as inscrições e a chegada do público.' },
]

function HeroTicket() {
  return (
    <div className="hero-ticket" aria-hidden="true">
      <div className="hero-ticket-copy">
        <span className="hero-ticket-label"><Ticket size={14} /> INGRESSO DIGITAL</span>
        <strong>Aurora Music<br />Festival</strong>
        <span className="hero-ticket-tag"><span /> Exemplo de ingresso</span>
      </div>
      <div className="hero-ticket-qr"><QRCodeSVG value="EventPass — ingresso ilustrativo" size={70} marginSize={1} /></div>
    </div>
  )
}

function EventCard({ event }: { event: EventRecord }) {
  const available = event.reserved_count < event.capacity
  const color = event.category === 'Música' ? 'purple' : event.category === 'Tecnologia' ? 'blue' : event.category === 'Gastronomia' ? 'orange' : 'neutral'
  return (
    <article className="event-card">
      <Link className="event-image-link" to={`/eventos/${event.id}`} tabIndex={-1} aria-hidden="true">
        <Cover event={event} />
        <span className={`category-tag category-${color}`}>{event.category}</span>
        {event.is_demo && <span className="demo-cover-label">Demonstração</span>}
      </Link>
      <div className="event-card-main">
        <div className="event-date"><CalendarDays size={15} /> {eventDate(event.starts_at)}</div>
        <h3>{event.title}</h3>
        <p className="event-location"><MapPin size={15} /> {event.city}</p>
        <p className="event-summary">{event.description}</p>
        <div className="event-card-bottom">
          <span className={available ? 'event-price' : 'muted'}>{available ? 'Gratuito' : 'Esgotado'}</span>
          <Link className="event-link" to={`/eventos/${event.id}`} aria-label={`Ver evento ${event.title}`}>Ver evento <ArrowUpRight size={16} /></Link>
        </div>
      </div>
    </article>
  )
}

export default function Landing() {
  const auth = useAuth()
  const events = useResource('catalogue', data.publicEvents, true)
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')
  const catalog = events.data ?? []
  const search = searchText(query)
  const visible = catalog.filter(event => (
    (category === 'all' || event.category === category)
    && searchText([event.title, event.description, event.city, event.category, event.venue].join(' ')).includes(search)
  ))
  const organizerLink = auth.profile?.role === 'organizer' ? '/organizacao' : '/entrar'

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-background" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <div className="hero-pill"><Sparkles size={15} /> A plataforma de eventos e ingressos</div>
            <h1 id="hero-title">Grandes eventos<br /><span>começam aqui.</span></h1>
            <p>Descubra experiências incríveis, garanta seu ingresso digital e faça check-in em segundos.</p>
            <div className="hero-actions">
              <Link className="button primary" to="/#eventos">Explorar eventos <ArrowRight size={19} /></Link>
              <Link className="button secondary" to="/#organizadores">Sou organizador <ArrowUpRight size={17} /></Link>
            </div>
          </div>
          <HeroTicket />
          <Link className="hero-scroll" to="/#eventos" aria-label="Ir para próximos eventos"><ArrowDown size={17} /></Link>
        </div>
      </section>
      <section id="eventos" className="container event-section">
        <div className="section-heading">
          <div>
            <h2>Próximos eventos</h2>
            <p>Encontre sua próxima experiência e reserve sua vaga.</p>
          </div>
          <label className="search-box">
            <Search size={19} />
            <input type="search" aria-label="Buscar eventos" placeholder="Buscar eventos..." value={query} onChange={event => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="filters" role="group" aria-label="Filtrar por categoria">
          <button className="filter-chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>Todos os eventos</button>
          {categories.map(name => (
            <button key={name} className="filter-chip" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>
          ))}
        </div>
        {events.pending && <Busy text="Carregando eventos…" />}
        {events.error && <Notice>{events.error} <button className="text-button" onClick={events.refresh}>Tentar novamente</button></Notice>}
        {visible.length > 0 && <div className="event-grid">{visible.map(event => <EventCard key={event.id} event={event} />)}</div>}
        {!events.pending && !events.error && visible.length === 0 && (
          <Empty title="Nenhum evento encontrado" action={(query || category !== 'all') && <button className="button secondary small" onClick={() => { setCategory('all'); setQuery('') }}>Limpar filtros</button>}>
            {query || category !== 'all' ? 'Tente outro termo ou categoria.' : 'Os próximos eventos publicados aparecerão aqui.'}
          </Empty>
        )}
      </section>
      <section id="como-funciona" className="container how-section">
        <div className="section-heading"><div><h2>Como funciona</h2></div></div>
        <div className="benefit-grid">
          {benefits.map(({ Icon, title, copy }) => (
            <article className="benefit" key={title}>
              <div className="feature-icon"><Icon size={23} /></div>
              <div><h3>{title}</h3><p>{copy}</p></div>
            </article>
          ))}
        </div>
      </section>
      <section id="organizadores" className="container organizer-section">
        <div className="organizer-banner">
          <div>
            <h2>Organizando um evento?</h2>
            <p>Cuide das inscrições, monte sua equipe e acompanhe o check-in em um só painel.</p>
          </div>
          <Link className="button primary" to={organizerLink}>Acessar área do organizador <ArrowUpRight size={17} /></Link>
        </div>
      </section>
    </>
  )
}
