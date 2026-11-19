import { useState } from 'react'
import type { FormEvent } from 'react'
import { Armchair, Check, Accessibility, X } from 'lucide-react'
import { seatKey, seatKindLabels, seatLabel } from '../../data/expansion/domain'
import { seatKinds } from '../../data/expansion/types'
import type { MapInput, Seat, SeatKind, SeatMap } from '../../data/expansion/types'
import type { Sector } from '../../data/expansion/types'
import type { Profile } from '../../data/types'
import { expansion } from '../../data/expansion'
import { errorMessage } from '../../data'
import { useResource } from '../../data/useResource'
import { Busy, Notice } from '../ui'

export function SeatGrid({ map, selected, edit, onSelect }: {
  map: SeatMap
  selected?: string
  edit?: boolean
  onSelect: (seat: Seat) => void
}) {
  return (
    <div className="seat-map">
      <div className="map-stage">{map.stage}</div>
      <div className="seat-grid-scroll" role="region" aria-label="Mapa de assentos" tabIndex={0}>
        <div className="seat-grid" style={{ gridTemplateColumns: `repeat(${map.columns}, 37px)` }}>
          {map.seats.map(seat => {
            const label = seatLabel(seat.row_no,seat.column_no)
            const status = seat.id === selected ? 'Selecionado' : seat.taken ? 'Reservado' : seatKindLabels[seat.kind]
            const type = seat.id === selected ? 'selected' : seat.taken ? 'taken' : seat.kind
            if (!edit && seat.kind === 'aisle') return <span className="seat-cell seat-aisle" key={seat.id} aria-hidden="true" />
            return <button type="button" key={seat.id} className={`seat-cell seat-${type}`}
              aria-label={`${label} · ${status}`} aria-pressed={edit ? undefined : seat.id === selected}
              disabled={seat.taken || (!edit && seat.kind === 'blocked')} onClick={() => onSelect(seat)} title={`${label} · ${status}`}>
              {seat.kind === 'accessible' ? <Accessibility size={16} /> : type === 'selected' ? <Check size={16} />
                : type === 'taken' || type === 'blocked' ? <X size={14} /> : type === 'aisle' ? '—' : label}
            </button>
          })}
        </div>
      </div>
      <ul className="seat-legend">
        {([['standard','Disponível'],['selected','Selecionado'],['taken','Reservado'],['blocked','Indisponível'],['accessible','Acessível']] as const)
          .map(([kind,label]) => <li key={kind}><i className={`seat-${kind}`} />{label}</li>)}
      </ul>
    </div>
  )
}

function EditMap({ defaultMap, sector, viewer }: { defaultMap: SeatMap | null; sector: Sector; viewer: Profile }) {
  const [rows, setRows] = useState(defaultMap?.rows ?? 4)
  const [columns, setColumns] = useState(defaultMap?.columns ?? 6)
  const [stage, setStage] = useState(defaultMap?.stage ?? 'Palco')
  const [cells, setCells] = useState<MapInput['cells']>(() => Object.fromEntries(
    (defaultMap?.seats ?? []).map(s => [seatKey(s.row_no,s.column_no),s.kind]),
  ))
  const [brush, setBrush] = useState<SeatKind>('accessible')
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>()
  const [busy, setBusy] = useState(false)

  const assigned = new Set(defaultMap?.seats.filter(seat => seat.taken).map(s => seatKey(s.row_no,s.column_no)))
  const map: SeatMap = {
    sector_id: sector.id, rows, columns, stage,
    seats: Array.from({ length: rows * columns }, (_, i) => {
      const row_no = Math.floor(i / columns) + 1
      const column_no = i % columns + 1
      const key = seatKey(row_no,column_no)
      return { id: key, row_no, column_no, kind: cells[key] ?? 'standard', taken: assigned.has(key) }
    }),
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(undefined)
    setBusy(true)
    try {
      await expansion.saveMap(viewer,sector.event_id,sector.id,{ rows,columns,stage,cells })
      setFeedback({ text: 'Mapa de assentos salvo.' })
    } catch (error) {
      setFeedback({ text: errorMessage(error), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel expansion-panel stack-form" onSubmit={save}>
      <div className="panel-heading"><Armchair size={20} /><div><h2>Mapa de assentos</h2><p>Escolha um tipo e clique nas células para editar. A grade usa letras para as fileiras e números para as colunas.</p></div></div>
      <div className="form-grid map-fields">
        <label>Fileiras<input type="number" value={rows} min={1} max={26} required onChange={e => setRows(Math.max(1,Math.min(26,Number(e.target.value))))} /></label>
        <label>Colunas<input type="number" value={columns} min={1} max={30} required onChange={e => setColumns(Math.max(1,Math.min(30,Number(e.target.value))))} /></label>
        <label>Identificação do palco<input value={stage} maxLength={80} required onChange={e => setStage(e.target.value)} /></label>
        <label>Tipo para aplicar<select value={brush} onChange={e => setBrush(e.target.value as SeatKind)}>
          {seatKinds.map(kind => <option key={kind} value={kind}>{seatKindLabels[kind]}</option>)}
        </select></label>
      </div>
      <SeatGrid map={map} edit onSelect={seat => setCells(current => ({ ...current,[seat.id]: brush }))} />
      {feedback && <Notice tone={feedback.error ? 'danger' : 'success'}>{feedback.text}</Notice>}
      <button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar mapa'}</button>
    </form>
  )
}

export function SeatEditor({ sector, viewer }: { sector: Sector; viewer: Profile }) {
  const map = useResource(`editor-map:${sector.id}`, () => expansion.map(sector.id,viewer), true)
  if (map.pending) return <Busy />
  if (map.error && !map.data) return <Notice>{map.error}</Notice>
  return <EditMap key={sector.id} defaultMap={map.data ?? null} sector={sector} viewer={viewer} />
}
