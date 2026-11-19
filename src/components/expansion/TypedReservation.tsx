import { useState } from 'react'
import { ArrowRight, Armchair } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessage } from '../../data'
import { eventDate, eventTime, randomUuid } from '../../data/domain'
import { expansion } from '../../data/expansion'
import { seatLabel } from '../../data/expansion/domain'
import type { SaleOption } from '../../data/expansion/types'
import type { EventRecord, Profile, Ticket } from '../../data/types'
import { useResource } from '../../data/useResource'
import { Busy, Notice } from '../ui'
import { SeatGrid } from './Seats'

function Booking({ event, option, viewer, onRefresh, limitReached }: {
  event: EventRecord; option: SaleOption; viewer: Profile; onRefresh: () => void; limitReached: boolean
}) {
  const map = useResource(`sale-map:${option.sector_id}`, () =>
    option.seated ? expansion.map(option.sector_id,viewer) : Promise.resolve(null),option.seated)
  const [selection, setSelection] = useState<{ seat: string; request: string }>()
  const [request] = useState(randomUuid)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const navigate = useNavigate()
  const choice = map.data?.seats.find(seat => seat.id === selection?.seat && !seat.taken && ['standard','accessible'].includes(seat.kind))

  async function reserve() {
    setBusy(true)
    setFailure('')
    try {
      const ticket = await expansion.reserve(viewer,event.id,option.id,choice?.id ?? null,selection?.request ?? request)
      navigate(`/ingressos/${ticket.id}`)
    } catch (error) {
      setFailure(errorMessage(error))
      map.refresh()
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {option.seated && <div className="stack-form">
        <h3 className="seat-heading"><Armchair size={17} /> Escolha seu assento</h3>
        {map.pending && <Busy text="Carregando assentos…" />}
        {map.error && <Notice>{map.error}</Notice>}
        {map.data && <SeatGrid map={map.data} selected={choice?.id} onSelect={seat => {
          setFailure('')
          setSelection({ seat: seat.id,request: randomUuid() })
        }} />}
        {!map.pending && !map.error && !map.data && <p className="muted">O mapa será disponibilizado pelo organizador.</p>}
        {selection && !choice && map.data && <Notice tone="info">O assento selecionado não está mais disponível. Escolha outro.</Notice>}
        {choice && <p className="muted" role="status">Assento {seatLabel(choice.row_no,choice.column_no)} selecionado.</p>}
      </div>}
      {failure && <Notice>{failure}</Notice>}
      <button className="button primary" disabled={busy || limitReached || !option.available || (option.seated && !choice)} onClick={reserve}>
        {busy ? 'Reservando…' : 'Reservar ingresso'} <ArrowRight size={17} />
      </button>
    </>
  )
}

export default function TypedReservation({ event, options, viewer, tickets, open, onRefresh }: {
  event: EventRecord; options: SaleOption[]; viewer: Profile | null; tickets: Ticket[]; open: boolean; onRefresh: () => void
}) {
  const available = options.filter(option => option.available > 0 &&
    tickets.filter(ticket => ticket.type_id === option.id && !ticket.cancelled_at).length < option.per_person)
  const [selected, setSelected] = useState('')
  const current = options.find(option => option.id === selected) ?? available[0] ?? options[0]
  const limitReached = !!current && tickets.filter(ticket => ticket.type_id === current.id && !ticket.cancelled_at).length >= current.per_person
  const existing = tickets.find(ticket => !ticket.cancelled_at)

  return (
    <>
      <label className="event-select">Modalidade do ingresso
        <select value={current?.id ?? ''} onChange={e => setSelected(e.target.value)} disabled={!current || !open}>
          {!current && <option value="">Nenhuma modalidade disponível</option>}
          {options.map(option => <option key={option.id} value={option.id} disabled={!available.includes(option)}>
            {option.name} · {option.sector_name} · {option.available} vagas
          </option>)}
        </select>
      </label>
      {current && <div className="sale-option">
        <strong><i style={{ background: current.color }} />{current.name} · {current.sector_name}</strong>
        {current.description && <p>{current.description}</p>}
        {current.sector_rules && <p>{current.sector_rules}</p>}
        <p>Limite de {current.per_person} por pessoa{current.deadline ? ` · Até ${eventDate(current.deadline)} às ${eventTime(current.deadline)}` : ''}</p>
      </div>}
      {limitReached && <p className="muted">Sua conta atingiu o limite desta modalidade.</p>}
      {open && current ? viewer?.role === 'participant'
        ? <Booking key={current.id} event={event} option={current} viewer={viewer} onRefresh={onRefresh} limitReached={limitReached} />
        : !viewer ? <Link className="button primary" to="/cadastro" state={{ next: `/eventos/${event.id}` }}>Reserve seu ingresso <ArrowRight size={18} /></Link>
          : <p className="reservation-closed">Entre com uma conta de participante para reservar.</p>
        : <span className="reservation-closed">Inscrições indisponíveis para esta seleção.</span>}
      {existing && <Link className="button secondary small" to={`/ingressos/${existing.id}`}>Ver meu ingresso</Link>}
    </>
  )
}
