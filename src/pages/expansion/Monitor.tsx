import { useEffect, useState } from 'react'
import { Activity, Gauge, DoorOpen, Ticket, UserRoundCheck, UsersRound, ShieldAlert } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../data/auth'
import { data } from '../../data'
import { checkInMessages, eventDate, eventTime, percentage } from '../../data/domain'
import { expansion } from '../../data/expansion'
import { alertLabels } from '../../data/expansion/domain'
import type { MonitorSnapshot } from '../../data/expansion/types'
import { useResource } from '../../data/useResource'
import { Busy, Empty, Notice, PageHeading } from '../../components/ui'

const tooltip = { background: '#191429',borderColor: '#43335f', borderRadius: 9 }
const palette = { main: '#a78bfa',secondary: '#67548d',neutral: '#473954',warning: '#fda4af' }

function Charts({ snapshot }: { snapshot: MonitorSnapshot }) {
  const [series,setSeries] = useState<'hour' | 'sector' | 'type'>('hour')
  const data: ({ name: string } & Record<string,string | number>)[] = series === 'hour' ? snapshot.hours.map(row => ({
    name: eventTime(row.hour), Autorizadas: row.allowed ?? 0, Negadas: row.denied ?? 0,
  })) : series === 'sector' ? snapshot.sectors.map(row => ({
    name: row.name, Presentes: row.present, Reservadas: row.reserved, Capacidade: row.capacity,
  })) : snapshot.types.map(row => ({ name: row.name, Emitidos: row.issued }))
  const distribution = [{ name: 'Presentes',value: snapshot.present,fill: palette.main },{ name: 'Ausentes',value: snapshot.absent,fill: palette.neutral }]

  return <div className="dashboard-charts">
    <section className="panel chart-card monitor-chart">
      <div className="chart-header"><h2>{series === 'hour' ? 'Entradas por horário' : series === 'sector' ? 'Ocupação por setor' : 'Ingressos por modalidade'}</h2>
        <select aria-label="Dados do gráfico" value={series} onChange={e => setSeries(e.target.value as typeof series)}>
          <option value="hour">Entradas nas últimas 24 h</option><option value="sector">Setores</option><option value="type">Modalidades</option>
        </select>
      </div>
      {!data.length ? <p className="chart-empty">Nenhum dado para o filtro escolhido.</p> :
        <div className="bar-frame"><ResponsiveContainer height="100%" width="100%">
          {series === 'hour' ? <AreaChart data={data} margin={{ top: 14,left: -23,right: 9,bottom: 0 }}>
            <CartesianGrid stroke="#312442" vertical={false} /><XAxis dataKey="name" tick={{ fill: '#b7afc6',fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: '#b7afc6',fontSize: 11 }} /><Tooltip contentStyle={tooltip} />
            <Legend formatter={label => <span className="muted">{label}</span>} />
            <Area type="monotone" dot={{ r: 3 }} dataKey="Autorizadas" stroke={palette.main} fill={palette.main} fillOpacity={0.24} isAnimationActive={false} />
            <Area type="monotone" dot={{ r: 3 }} dataKey="Negadas" stroke={palette.warning} fill={palette.warning} fillOpacity={0.14} isAnimationActive={false} />
          </AreaChart> : <BarChart data={data} margin={{ top: 14,left: -23,right: 9,bottom: 0 }}>
            <CartesianGrid stroke="#312442" vertical={false} /><XAxis dataKey="name" tick={{ fill: '#b7afc6',fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: '#b7afc6',fontSize: 11 }} /><Tooltip contentStyle={tooltip} />
            <Legend formatter={label => <span className="muted">{label}</span>} />
            {series === 'sector' ? <>
              <Bar dataKey="Presentes" fill={palette.main} radius={[4,4,0,0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="Reservadas" fill={palette.secondary} radius={[4,4,0,0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="Capacidade" fill={palette.neutral} radius={[4,4,0,0]} maxBarSize={28} isAnimationActive={false} />
            </> : <Bar dataKey="Emitidos" fill={palette.main} radius={[4,4,0,0]} maxBarSize={36} isAnimationActive={false} />}
          </BarChart>}
        </ResponsiveContainer></div>}
    </section>
    <section className="panel chart-card">
      <h2>Comparecimento</h2>
      {snapshot.present + snapshot.absent > 0 ? <>
        <div className="donut-frame"><ResponsiveContainer width="100%" height="100%">
          <PieChart><Pie data={distribution} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="93%"
            stroke="none" isAnimationActive={false} /><Tooltip contentStyle={tooltip} /></PieChart>
        </ResponsiveContainer><div className="donut-label"><strong>{percentage(snapshot.present,snapshot.present+snapshot.absent)}%</strong><span>presentes</span></div></div>
        <div className="occupancy-legend"><span><i /> {snapshot.present} presentes</span><span><i /> {snapshot.absent} ausentes</span></div>
      </> : <p className="chart-empty">Nenhuma inscrição ativa.</p>}
    </section>
  </div>
}

export default function Monitor() {
  const viewer = useAuth().profile!
  const [params,setParams] = useSearchParams()
  const events = useResource(`monitor-events:${viewer.id}`, () => data.managedEvents(viewer),true)
  const options = events.data ?? []
  const id = options.find(event => event.id === params.get('evento'))?.id ?? options[0]?.id
  const monitor = useResource(`monitor:${id}:${viewer.id}`, () => id ? expansion.monitor(viewer,id) : Promise.resolve(null),Boolean(id))
  const [online,setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('offline',update); window.addEventListener('online',update)
    return () => { window.removeEventListener('offline',update); window.removeEventListener('online',update) }
  },[])
  const snapshot = monitor.data
  const root = viewer.role === 'admin' ? '/administracao' : '/organizacao'

  return <>
    <PageHeading title="Monitoramento ao vivo" action={id && <Link className="button secondary small" to={`${root}/auditoria?evento=${id}`}>Abrir auditoria</Link>}>
      Veja o comparecimento, a ocupação por setor e a atividade das portarias.
    </PageHeading>
    {(events.pending || monitor.pending) && <Busy />}
    {(events.error || monitor.error) && <Notice>{events.error || monitor.error} <button className="text-button" onClick={monitor.refresh}>Atualizar dados</button></Notice>}
    {!events.pending && events.data?.length === 0 && <Empty title="Nenhum evento disponível">Cadastre um evento para acompanhar a operação.</Empty>}
    {!!options.length && <div className="live-controls"><label className="event-select">Evento monitorado<select value={id ?? ''} onChange={e => setParams({ evento: e.target.value })}>
      {options.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
    </select></label><span className={`status-chip ${online && !monitor.error ? 'success-text' : 'danger-text'}`}>
      {online && !monitor.error ? 'Atualização automática' : 'Atualização pendente'}
    </span></div>}
    {snapshot && <>
      <div className="metrics-grid live-metrics">
        {([
          ['Ingressos emitidos',snapshot.issued,Ticket],['Presentes',snapshot.present,UserRoundCheck],['Ausentes',snapshot.absent,UsersRound],
          ['Vagas disponíveis',snapshot.available,Ticket],['Check-ins no último minuto',snapshot.per_minute,Activity],
          ['Tentativas negadas',snapshot.denied,ShieldAlert],['Reutilizações',snapshot.reused,DoorOpen],
          ['Comparecimento',percentage(snapshot.present,snapshot.present+snapshot.absent)+'%',Gauge],
        ] as const).map(([label,value,Icon]) => <article className="panel metric" key={label} aria-label={label}>
          <Icon size={19} /><div><h2>{label}</h2><strong>{value}</strong></div>
        </article>)}
      </div>
      <Charts snapshot={snapshot} />
      {!!snapshot.sectors.length && <section className="panel expansion-panel">
        <h2>Ocupação atual por setor</h2>
        <div className="sector-progress-list">{snapshot.sectors.map(sector => <div key={sector.name}>
          <div><strong>{sector.name}</strong><span>{sector.present} presentes · {sector.reserved}/{sector.capacity} reservas</span></div>
          <progress aria-label={`Ocupação de ${sector.name}`} value={sector.present} max={sector.capacity} />
        </div>)}</div>
      </section>}
      <section className="panel expansion-panel live-section">
        <div className="panel-heading"><DoorOpen size={21} /><div><h2>Movimentação das portarias</h2><p>Autorizações, negativas e últimas leituras registradas.</p></div></div>
        <div className="gate-cards">{snapshot.gates.map(gate => <article key={gate.id ?? 'general'} className="gate-card">
          <h3>{gate.name}</h3><p className="muted">{gate.activity.allowed} autorizadas · {gate.activity.denied} negadas</p>
          <ul className="gate-history">{gate.activity.recent.map((a,index) => <li key={a.happened_at+index}>
            <span>{checkInMessages[a.result].title}{a.occurrences > 1 && ` ×${a.occurrences}`}</span><time>{eventDate(a.happened_at)} · {eventTime(a.happened_at)}</time>
          </li>)}</ul>
        </article>)}</div>
      </section>
      <section className="panel expansion-panel live-section">
        <div className="panel-heading"><ShieldAlert size={21} /><div><h2>Alertas de comportamento</h2><p>Indícios para revisão da equipe, calculados pelos limites da auditoria.</p></div></div>
        {snapshot.alerts.length ? <ul className="team-list">{snapshot.alerts.map((alert,index) => <li key={alert.staff_name+alert.kind+index}>
          <div><strong>{alertLabels[alert.kind]}</strong><span>{alert.staff_name}</span></div><span>{alert.amount} ocorrências</span>
        </li>)}</ul> : <p className="muted">Nenhum limite de alerta atingido nas janelas recentes.</p>}
      </section>
    </>}
  </>
}
