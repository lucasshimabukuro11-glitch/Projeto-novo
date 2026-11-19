import { useState } from 'react'
import type { FormEvent } from 'react'
import { Download, ListFilter, ShieldAlert } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../data/auth'
import { data } from '../../data'
import { brasiliaInstant, checkInMessages, eventDate, eventTime } from '../../data/domain'
import { expansion } from '../../data/expansion'
import { csvCell, emptyAuditFilters } from '../../data/expansion/domain'
import type { AuditFilters, SecurityLimits, ValidationRow } from '../../data/expansion/types'
import type { CheckInStatus, Profile } from '../../data/types'
import { useResource } from '../../data/useResource'
import { Busy, Notice, PageHeading, Pager } from '../../components/ui'
import { useAction } from '../../components/expansion/useAction'

const PAGE = 25
const limitsFields: { key: keyof SecurityLimits; label: string; min: number; max: number }[] = [
  { key:'reuse',label:'Reutilizações em 5 min',min:2,max:1000 },
  { key:'invalid_streak',label:'Inválidos consecutivos em 5 min',min:2,max:1000 },
  { key:'wrong_sector',label:'Setor incorreto em 5 min',min:2,max:1000 },
  { key:'staff_rate',label:'Alerta de leituras por minuto',min:5,max:2000 },
  { key:'max_per_minute',label:'Bloqueio de leituras por minuto',min:60,max:2000 },
]

function LimitsForm({ viewer, event }: { viewer: Profile; event: string | null }) {
  const limits = useResource(`security-limits:${viewer.id}:${event}`, () => expansion.limits(viewer,event))
  const action = useAction(limits.refresh)
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const values = new FormData(e.currentTarget)
    const fields = Object.fromEntries(limitsFields.map(({ key }) => [key,Number(values.get(key))])) as SecurityLimits
    void action.run(() => expansion.saveLimits(viewer,event,fields),'Limites de segurança salvos.')
  }

  return <details className="panel expansion-panel audit-limits">
    <summary><ShieldAlert size={19} /> {event ? 'Limites do evento' : 'Limites globais de segurança'}</summary>
    {limits.pending && <Busy />}
    {limits.error && <Notice>{limits.error}</Notice>}
    {limits.data && <form className="stack-form" onSubmit={save}>
      <p className="muted">{event ? 'Os limites deste evento têm prioridade sobre os padrões globais.' : 'Eventos sem limites próprios usam estes valores.'} Os cálculos consideram cada conta em cada evento.</p>
      <div className="form-grid">{limitsFields.map(({ key,label,min,max }) =>
        <label key={key}>{label}<input name={key} type="number" min={min} max={max} step={1} required defaultValue={limits.data![key]} /></label>,
      )}</div>
      {action.notice}
      <div><button className="button secondary small" disabled={action.busy}>Salvar limites</button></div>
    </form>}
  </details>
}

function downloadRows(rows: ValidationRow[]) {
  const values = [
    ['Data e hora (UTC)','Evento','Portaria','Funcionário','Resultado','Ingresso','Ocorrências'],
    ...rows.map(row => [row.happened_at,row.event_title,row.gate_name,row.staff_name,checkInMessages[row.result].title,row.ticket_id,row.occurrences]),
  ]
  const csv = '\uFEFF' + values.map(row => row.map(csvCell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv],{ type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'eventscan-auditoria.csv'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url),1000)
}

export default function Audit() {
  const viewer = useAuth().profile!
  const [params] = useSearchParams()
  const initial = params.get('evento') || ''
  const [selected,setSelected] = useState(initial)
  const [gate,setGate] = useState('')
  const [filters,setFilters] = useState<AuditFilters>({ ...emptyAuditFilters,event: initial || null })
  const [filterError,setFilterError] = useState('')
  const [page,setPage] = useState(0)
  const events = useResource(`audit-events:${viewer.id}`,() => data.managedEvents(viewer),true)
  const gates = useResource(`audit-gates:${viewer.id}`,() => expansion.auditGates(viewer),true)
  const records = useResource(`audit:${viewer.id}:${JSON.stringify(filters)}:${page}`,() => expansion.audit(viewer,filters,page * PAGE,PAGE),true)
  const exportAction = useAction()

  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFilterError('')
    const form = new FormData(e.currentTarget)
    const from = form.get('from') ? brasiliaInstant(String(form.get('from'))) : null
    const until = form.get('until') ? brasiliaInstant(String(form.get('until'))) : null
    if (from && until && from > until) { setFilterError('O início do período precisa vir antes do fim.'); return }
    setPage(0)
    setFilters({ event: selected || null,gate: gate || null,result: (form.get('result') || null) as CheckInStatus | null,from,until })
  }

  async function exportCsv() {
    const download = { ...filters,until: filters.until ?? new Date().toISOString() }
    const rows: ValidationRow[] = []
    for (let offset = 0; ; offset += 200) {
      const response = await expansion.audit(viewer,download,offset,200)
      rows.push(...response.rows)
      if (response.rows.length < 200) break
    }
    downloadRows(rows)
  }

  return <>
    <PageHeading title="Auditoria de acessos" action={<button className="button secondary" disabled={exportAction.busy || !records.data?.total}
      onClick={() => void exportAction.run(exportCsv,'Relatório CSV gerado.')}>
      <Download size={18} /> {exportAction.busy ? 'Exportando…' : 'Exportar CSV'}
    </button>}>Consulte os resultados de leitura e identifique ocorrências por evento, portaria e período.</PageHeading>
    {exportAction.notice}
    <section className="panel expansion-panel">
      <div className="panel-heading"><ListFilter size={19} /><div><h2>Filtros</h2></div></div>
      <form className="stack-form" onSubmit={apply}>
        <div className="form-grid audit-filters">
          <label>Evento<select value={selected} onChange={e => { setSelected(e.target.value); setGate('') }}>
            <option value="">Todos os eventos</option>{events.data?.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}
          </select></label>
          <label>Portaria<select value={gate} onChange={e => setGate(e.target.value)}><option value="">Todas as portarias</option>
            {gates.data?.filter(row => !selected || row.event_id === selected).map(g => <option key={g.id} value={g.id}>
              {g.name}{!selected ? ' · ' + (events.data?.find(e => e.id === g.event_id)?.title ?? '') : ''}
            </option>)}
          </select></label>
          <label>Resultado<select name="result"><option value="">Todos os resultados</option>
            {Object.entries(checkInMessages).map(([result,message]) => <option key={result} value={result}>{message.title}</option>)}
          </select></label>
          <label>De (horário de Brasília)<input name="from" type="datetime-local" /></label>
          <label>Até (horário de Brasília)<input name="until" type="datetime-local" /></label>
        </div>
        {(filterError || events.error || gates.error) && <Notice>{filterError || events.error || gates.error}</Notice>}
        <div><button className="button primary small">Aplicar filtros</button></div>
      </form>
    </section>
    {records.pending && <Busy />}
    {records.error && <Notice>{records.error}</Notice>}
    {records.data && <section className="panel expansion-panel audit-records">
      <h2>{records.data.occurrences} ocorrências encontradas</h2>
      {records.data.rows.length ? <div className="table-wrap"><table>
        <thead><tr><th>Resultado</th><th>Evento</th><th>Portaria</th><th>Funcionário</th><th>Horário de Brasília</th></tr></thead>
        <tbody>{records.data.rows.map(row => <tr key={row.id}>
          <td><span className={`status-chip ${row.result === 'valid' ? 'success-text' : 'danger-text'}`}>{checkInMessages[row.result].title}{row.occurrences > 1 && ` ×${row.occurrences}`}</span></td>
          <td>{row.event_title}</td><td>{row.gate_name ?? 'Geral'}</td><td>{row.staff_name ?? '—'}</td><td>{eventDate(row.happened_at)} · {eventTime(row.happened_at)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">Nenhum registro com os filtros selecionados.</p>}
      <Pager page={page} next={(page + 1) * PAGE < records.data.total} onChange={setPage} />
    </section>}
    {(filters.event || viewer.role === 'admin') && <LimitsForm key={filters.event ?? 'global'} viewer={viewer} event={filters.event} />}
  </>
}
