import { useState } from 'react'
import { Activity as ActivityIcon, CalendarDays, ChartNoAxesCombined, CircleCheck, Clock3, Plus, Ticket, UserRoundCheck, UsersRound } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { data } from '../data'
import { eventDate, eventTime, percentage } from '../data/domain'
import { useResource } from '../data/useResource'
import type { DashboardSnapshot } from '../data/types'
import { Busy, Notice, PageHeading } from '../components/ui'

function Performance({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [selected, setSelected] = useState('all')
  const { chart, totals } = snapshot
  const chosen = chart.find(event => event.id === selected)
  const attendance = (chosen ? [chosen] : chart).map(row => ({
    title: row.title,
    Presentes: row.present_count,
    Ausentes: row.reserved_count - row.present_count,
  }))
  const reserved = chosen?.reserved_count ?? totals.reserved
  const capacity = chosen?.capacity ?? totals.capacity
  const distribution = [
    { name: 'Reservadas', value: reserved, fill: '#9972ff' },
    { name: 'Disponíveis', value: capacity - reserved, fill: '#50406a' },
  ]

  return (
    <div className="dashboard-charts">
      <section className="panel chart-card">
        <div className="chart-header">
          <h2>Comparecimento por evento</h2>
          <select aria-label="Evento nos gráficos" value={chosen?.id ?? 'all'} onChange={e => setSelected(e.target.value)}>
            <option value="all">Eventos recentes</option>
            {chart.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
          </select>
        </div>
        {attendance.some(row => row.Presentes || row.Ausentes) ? (
          <div className="bar-frame">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attendance} margin={{ top: 15, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke="#272039" vertical={false} />
                <XAxis dataKey="title" tick={{ fill: '#b6aec8', fontSize: 11 }} tickLine={false}
                  tickFormatter={(name: string) => name.length > 15 ? name.slice(0, 13) + '…' : name} />
                <YAxis allowDecimals={false} tick={{ fill: '#b6aec8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#241c38' }} contentStyle={{ background: '#171222', border: '1px solid #322747', borderRadius: 10 }} itemStyle={{ color: '#eee6ff' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={label => <span className="muted">{label}</span>} />
                <Bar dataKey="Presentes" fill="#9c75ff" radius={[6, 6, 0, 0]} maxBarSize={32} isAnimationActive={false} />
                <Bar dataKey="Ausentes" fill="#4f3c78" radius={[6, 6, 0, 0]} maxBarSize={32} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="chart-empty">Os dados aparecem quando houver inscrições.</div>}
      </section>
      <section className="panel chart-card occupancy-chart">
        <h2>{chosen ? 'Vagas do evento' : 'Vagas dos eventos'}</h2>
        {capacity > 0 ? (
          <>
            <div className="donut-frame">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distribution} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="94%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false} />
                  <Tooltip contentStyle={{ background: '#171222', border: '1px solid #322747', borderRadius: 10 }} itemStyle={{ color: '#eee6ff' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-label"><strong>{percentage(reserved, capacity)}%</strong><span>reservadas</span></div>
            </div>
            <div className="occupancy-legend"><span><i /> {reserved} reservadas</span><span><i /> {capacity - reserved} disponíveis</span></div>
          </>
        ) : <div className="chart-empty">Publique um evento para acompanhar sua ocupação.</div>}
      </section>
    </div>
  )
}

export default function Dashboard({ admin = false }: { admin?: boolean }) {
  const { profile } = useAuth()
  const dashboard = useResource(`dashboard:${profile!.id}:${profile!.role}`, () => data.dashboard(profile!), true)
  const snapshot = dashboard.data

  return (
    <>
      <PageHeading title={admin ? 'Visão geral da plataforma' : 'Visão geral'}
        action={!admin && <Link className="button primary" to="/organizacao/eventos/novo"><Plus size={19} /> Novo evento</Link>}>
        {admin ? 'Acompanhe os eventos, as contas e a participação.' : 'Acompanhe as inscrições e o check-in dos seus eventos.'}
      </PageHeading>
      {dashboard.pending && <Busy text="Carregando indicadores…" />}
      {dashboard.error && <Notice>{dashboard.error} <button className="text-button" onClick={dashboard.refresh}>Tentar novamente</button></Notice>}
      {snapshot && (
        <>
          <Metrics snapshot={snapshot} />
          <Performance snapshot={snapshot} />
          <section className="panel activity-panel">
            <div className="panel-heading"><ActivityIcon size={21} /><div><h2>Movimentações recentes</h2></div></div>
            {snapshot.activity.length ? (
              <ul className="activity-list">
                {snapshot.activity.map(item => (
                  <li key={`${item.id}:${item.kind}`}>
                    <div className={`activity-icon ${item.kind === 'checked_in' ? 'success-text' : ''}`}>{item.kind === 'checked_in' ? <CircleCheck size={19} /> : <Ticket size={19} />}</div>
                    <div><strong>{item.display_name}</strong><span>{item.kind === 'checked_in' ? 'Check-in realizado' : 'Ingresso emitido'} · {item.event_title}</span></div>
                    <time dateTime={item.happened_at}>{eventDate(item.happened_at)} · {eventTime(item.happened_at)}</time>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">As novas reservas e os check-ins aparecerão aqui.</p>}
          </section>
        </>
      )}
    </>
  )
}

function Metrics({ snapshot }: { snapshot: DashboardSnapshot }) {
  const { totals, accounts } = snapshot
  const metrics = [
    { key: 'events', label: 'Total de eventos', value: totals.events, Icon: CalendarDays },
    { key: 'issued', label: 'Ingressos emitidos', value: totals.issued, Icon: Ticket },
    { key: 'present', label: 'Participantes presentes', value: totals.present, Icon: UserRoundCheck },
    { key: 'absent', label: 'Participantes ausentes', value: totals.reserved - totals.present, Icon: Clock3 },
    { key: 'attendance', label: 'Taxa de comparecimento', value: `${percentage(totals.present, totals.reserved)}%`, Icon: ChartNoAxesCombined },
    { key: 'occupancy', label: 'Capacidade utilizada', value: `${percentage(totals.reserved, totals.capacity)}%`, Icon: UsersRound },
  ]
  if (accounts) metrics.push(
    { key: 'accounts', label: 'Total de usuários', value: accounts.total, Icon: UsersRound },
    { key: 'organizers', label: 'Organizadores', value: accounts.organizers, Icon: CalendarDays },
  )

  return (
    <div className="metrics-grid">
      {metrics.map(({ key, label, value, Icon }) => (
        <article className="panel metric" key={key} data-testid={`metric-${key}`}>
          <Icon size={19} /><div><h2>{label}</h2><strong>{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</strong></div>
        </article>
      ))}
    </div>
  )
}
