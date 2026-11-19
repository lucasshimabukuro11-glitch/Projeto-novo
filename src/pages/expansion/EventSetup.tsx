import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowLeft, Armchair, DoorOpen, Layers3, Ticket } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../data/auth'
import { data } from '../../data'
import { brasiliaInstant, eventDate, eventTime } from '../../data/domain'
import { useResource } from '../../data/useResource'
import { expansion } from '../../data/expansion'
import type { EventSetup as Setup, Gate, OptionFields, OptionKind, Sector, TicketOption } from '../../data/expansion/types'
import type { Profile, TeamMember } from '../../data/types'
import { Busy, Empty, Notice, PageHeading } from '../../components/ui'
import { SeatEditor } from '../../components/expansion/Seats'
import CertificateSetup from '../../components/expansion/CertificateSetup'
import { useAction } from '../../components/expansion/useAction'

const timeField = new Intl.DateTimeFormat('sv-SE', { year: 'numeric',month: '2-digit',day: '2-digit',hour: '2-digit',minute: '2-digit',timeZone: 'America/Sao_Paulo' })
const tabs = [['ingressos','Setores e ingressos'],['assentos','Assentos'],['portarias','Portarias'],['certificados','Certificados']] as const
type Context = { viewer: Profile; event: string; refresh: () => void }

function Form({ context, kind, name, children, fields }: {
  context: Context; kind: OptionKind; name: string; children: ReactNode; fields: (form: FormData) => OptionFields
}) {
  const action = useAction(context.refresh)
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    void action.run(() => expansion.saveOption(context.viewer,context.event,kind,fields(new FormData(form))), 'Configuração salva.')
  }
  return <form className="stack-form setup-form" onSubmit={submit}>
    {children}
    {action.notice}
    <div><button className="button primary small" disabled={action.busy}>{action.busy ? 'Salvando…' : name}</button></div>
  </form>
}

function SectorForm({ context, maximum, sector }: { context: Context; maximum: number; sector?: Sector }) {
  return <Form kind="sector" context={context} name={sector ? 'Salvar setor' : 'Criar setor'} fields={form => ({
    id: sector?.id ?? null, name: String(form.get('name')), capacity: Number(form.get('capacity')),
    description: String(form.get('description') ?? ''), seated: form.has('seated'),
  })}>
    <div className="form-grid">
      <label>Nome do setor<input name="name" required minLength={2} maxLength={80} defaultValue={sector?.name ?? ''} /></label>
      <label>Capacidade do setor<input name="capacity" type="number" min={1} max={maximum} required defaultValue={sector?.capacity ?? ''} /></label>
      <label className="full">Regras de acesso<textarea name="description" maxLength={500} rows={2} defaultValue={sector?.description ?? ''} /></label>
      <label className="checkbox-label"><input name="seated" type="checkbox" defaultChecked={Boolean(sector?.seated)} disabled={Boolean(sector)} /> Usar assentos marcados</label>
    </div>
  </Form>
}

function TypeForm({ context, option, sectors }: { context: Context; option?: TicketOption; sectors: Sector[] }) {
  return <Form kind="type" context={context} name={option ? 'Salvar modalidade' : 'Criar modalidade'} fields={form => ({
    id: option?.id ?? null, name: String(form.get('name')), sector_id: option?.sector_id ?? String(form.get('sector_id')),
    description: String(form.get('description') ?? ''), capacity: Number(form.get('capacity')), per_person: Number(form.get('per_person')),
    color: String(form.get('color')), active: form.has('active'), deadline: form.get('deadline') ? brasiliaInstant(String(form.get('deadline'))) : null,
  })}>
    <div className="form-grid">
      <label>Nome da modalidade<input name="name" required minLength={2} maxLength={70} placeholder="Ex. VIP" defaultValue={option?.name ?? ''} /></label>
      <label>Setor associado<select name="sector_id" required defaultValue={option?.sector_id ?? sectors[0]?.id} disabled={Boolean(option)}>
        {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      <label>Quantidade disponível<input name="capacity" type="number" min={1} max={100000} required defaultValue={option?.capacity ?? ''} /></label>
      <label>Limite por participante<input name="per_person" type="number" min={1} max={20} required defaultValue={option?.per_person ?? 1} /></label>
      <label className="full">Descrição da modalidade<textarea name="description" maxLength={500} rows={2} defaultValue={option?.description ?? ''} /></label>
      <label>Prazo para inscrição em horário de Brasília<input name="deadline" type="datetime-local"
        defaultValue={option?.deadline ? timeField.format(new Date(option.deadline)).replace(' ','T') : ''} /></label>
      <label>Cor da modalidade<input name="color" type="color" defaultValue={option?.color ?? '#a78bfa'} /></label>
      <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={option?.active ?? true} /> Modalidade ativa</label>
    </div>
  </Form>
}

function GateForm({ context, sectors, gate }: { context: Context; sectors: Sector[]; gate?: Gate }) {
  return <Form kind="gate" context={context} name={gate ? 'Salvar portaria' : 'Criar portaria'} fields={form => ({
    id: gate?.id ?? null, name: String(form.get('name')), sector_id: gate?.sector_id ?? (String(form.get('sector_id') ?? '') || null),
  })}>
    <div className="form-grid"><label>Nome da portaria<input name="name" required minLength={2} maxLength={80} defaultValue={gate?.name ?? ''} /></label>
      <label>Setor controlado<select name="sector_id" defaultValue={gate?.sector_id ?? ''} disabled={Boolean(gate)}>
        <option value="">Geral · ingressos sem setor</option>{sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label></div>
  </Form>
}

function Gates({ setup, team, context }: { setup: Setup; team: TeamMember[]; context: Context }) {
  const action = useAction(context.refresh)
  return <section className="panel expansion-panel">
    <div className="panel-heading"><DoorOpen size={21} /><div><h2>Portarias e acessos</h2><p>Vincule uma portaria a cada setor. A portaria geral aceita ingressos sem setor.</p></div></div>
    <details className="expansion-fold"><summary>Nova portaria</summary><GateForm context={context} sectors={setup.sectors} /></details>
    {action.notice}
    {setup.gates.map(gate => <details className="expansion-fold" key={gate.id}>
      <summary>{gate.name}<span className="muted">{setup.sectors.find(s => s.id === gate.sector_id)?.name ?? 'Geral'}</span></summary>
      <GateForm context={context} sectors={setup.sectors} gate={gate} />
      <h3>Funcionários autorizados</h3>
      {!team.length && <p className="muted">Adicione funcionários na equipe de acesso do evento.</p>}
      <div className="gate-member-grid">{team.map(member => <label key={member.id} className="checkbox-label">
        <input type="checkbox" checked={Boolean(gate.staff_ids?.includes(member.id))} disabled={action.busy} onChange={e =>
          void action.run(() => expansion.saveOption(context.viewer,context.event,'gate_member',
            { id: gate.id,user_id: member.id,enabled: e.target.checked }),'Acesso da portaria atualizado.')} />
        {member.display_name}
      </label>)}</div>
    </details>)}
  </section>
}

function SeatTab({ setup, viewer }: { setup: Setup; viewer: Profile }) {
  const [selected, setSelected] = useState('')
  const mapped = setup.sectors.filter(s => s.seated)
  const sector = mapped.find(row => row.id === selected) ?? mapped[0]
  if (!sector) return <Empty title="Nenhum setor com assentos">Ative assentos marcados ao cadastrar um setor.</Empty>
  return <>
    <label className="event-select">Setor do mapa<select value={sector.id} onChange={e => setSelected(e.target.value)}>
      {mapped.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <SeatEditor key={sector.id} sector={sector} viewer={viewer} />
  </>
}

export default function EventSetup() {
  const viewer = useAuth().profile!
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = tabs.find(t => t[0] === params.get('aba'))?.[0] ?? 'ingressos'
  const event = useResource(`setup-event:${id}:${viewer.id}`, () => data.event(id,viewer),true)
  const setup = useResource(`setup-options:${id}:${viewer.id}`, () => expansion.setup(viewer,id),true)
  const team = useResource(`setup-team:${id}:${viewer.id}`, () => tab === 'portarias' ? data.team(viewer,id) : Promise.resolve([]),tab === 'portarias')
  if (event.pending || setup.pending) return <Busy />
  if (event.error || setup.error) return <Notice>{event.error || setup.error}</Notice>
  if (!event.data || !setup.data || event.data.owner_id !== viewer.id) return <Empty title="Evento indisponível">Selecione um evento da sua organização.</Empty>
  const context = { viewer,event: id,refresh: setup.refresh }

  return <>
    <Link className="back-link" to={`/organizacao/eventos/${id}`}><ArrowLeft size={16} /> Voltar ao evento</Link>
    <PageHeading title="Configuração do evento">{event.data.title}</PageHeading>
    <div className="filters" role="group" aria-label="Configuração do evento">
      {tabs.map(([key,text]) => <button key={key} className="filter-chip" aria-pressed={key === tab} onClick={() => setParams({ aba: key })}>{text}</button>)}
    </div>
    {tab === 'ingressos' && <div className="expansion-stack">
      <section className="panel expansion-panel">
        <div className="panel-heading"><Layers3 size={21} /><div><h2>Setores</h2><p>Distribua até {event.data.capacity} vagas entre setores.</p></div></div>
        <details className="expansion-fold"><summary>Novo setor</summary><SectorForm context={context} maximum={event.data.capacity} /></details>
        {setup.data.sectors.map(sector => <details className="expansion-fold" key={sector.id}>
          <summary>{sector.name}<span className="muted">{sector.capacity} vagas · {sector.seated ? 'Assentos marcados' : 'Sem assentos marcados'}</span></summary>
          <SectorForm context={context} maximum={event.data!.capacity} sector={sector} />
          {sector.seated && <button type="button" className="text-button" onClick={() => setParams({ aba: 'assentos' })}><Armchair size={16} /> Abrir editor de assentos</button>}
        </details>)}
      </section>
      <section className="panel expansion-panel">
        <div className="panel-heading"><Ticket size={21} /><div><h2>Modalidades de ingresso</h2><p>Defina quantidade, prazo e limite por participante.</p></div></div>
        {setup.data.sectors.length ? <details className="expansion-fold"><summary>Nova modalidade</summary><TypeForm context={context} sectors={setup.data.sectors} /></details>
          : <p className="muted">Cadastre um setor para criar modalidades.</p>}
        {setup.data.types.map(option => <details className="expansion-fold" key={option.id}>
          <summary><i className="type-color" style={{ background: option.color }} />{option.name}
            <span className="muted">{option.active ? 'Ativa' : 'Inativa'} · {option.capacity} vagas{option.deadline ? ` · Até ${eventDate(option.deadline)} ${eventTime(option.deadline)}` : ''}</span>
          </summary><TypeForm context={context} sectors={setup.data!.sectors} option={option} />
        </details>)}
      </section>
    </div>}
    {tab === 'assentos' && <SeatTab setup={setup.data} viewer={viewer} />}
    {tab === 'portarias' && <>{team.error && <Notice>{team.error}</Notice>}<Gates setup={setup.data} team={team.data ?? []} context={context} /></>}
    {tab === 'certificados' && <CertificateSetup event={event.data} viewer={viewer} />}
  </>
}
