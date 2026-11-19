import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Camera, CircleCheck, Keyboard, ScanLine, ShieldCheck, XCircle } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { data, errorMessage } from '../data'
import { expansion } from '../data/expansion'
import type { Gate } from '../data/expansion/types'
import { checkInMessages, eventDate, eventTime } from '../data/domain'
import type { CheckInResult, EventRecord } from '../data/types'
import { useResource } from '../data/useResource'
import { CameraReader } from '../components/CameraReader'
import { Busy, Empty, Notice, PageHeading } from '../components/ui'

function CheckInStation({ event, gate }: { event: EventRecord; gate: Gate | null }) {
  const { profile } = useAuth()
  const activity = useResource(`gate-monitor:${event.id}:${gate?.id}:${profile?.id}`, () =>
    gate ? expansion.gateActivity(profile!,event.id,gate.id) : Promise.resolve(null),Boolean(gate))
  const [scanning, setScanning] = useState(false)
  const [code, setCode] = useState('')
  const [result, setResult] = useState<CheckInResult | null>(null)
  const [cameraIssue, setCameraIssue] = useState('')
  const [failure, setFailure] = useState('')
  const [verifying, setVerifying] = useState(false)
  const lock = useRef(false)

  async function validate(value: string) {
    if (lock.current || !value.trim()) return
    lock.current = true
    setScanning(false)
    setVerifying(true)
    setResult(null)
    setFailure('')
    try {
      setResult(await data.validate(profile!, event.id, value, gate?.id ?? null))
      setCode('')
      activity.refresh()
    } catch (issue) {
      setFailure(errorMessage(issue))
    } finally {
      lock.current = false
      setVerifying(false)
    }
  }

  function submit(form: FormEvent<HTMLFormElement>) {
    form.preventDefault()
    void validate(code)
  }

  const message = result && checkInMessages[result.status]
  return (
    <div className="station-grid">
      <section className="panel station-panel">
        <div className="panel-heading"><Camera size={20} /><div><h2>Leitor de QR Code</h2><p>Aponte a câmera para o ingresso do participante.</p></div></div>
        <div className={`scanner-frame ${scanning ? 'scanning' : ''}`}>
          {scanning && <CameraReader onRead={validate} onError={error => { setScanning(false); setCameraIssue(error) }} />}
          <div className="scanner-guide" aria-hidden="true"><i /><i /><i /><i />{!scanning && <ScanLine size={55} strokeWidth={1.2} />}</div>
        </div>
        {cameraIssue && <Notice>{cameraIssue}</Notice>}
        <button className={`button ${scanning ? 'secondary' : 'primary'}`} disabled={verifying} onClick={() => {
          setCameraIssue('')
          if (!scanning) setResult(null)
          setScanning(!scanning)
        }}><Camera size={18} /> {scanning ? 'Fechar câmera' : 'Abrir câmera'}</button>
      </section>
      <div className="station-side">
        <section className="panel station-panel">
          <div className="panel-heading"><Keyboard size={21} /><div><h2>Entrada manual</h2><p>Digite ou cole o código que aparece no ingresso.</p></div></div>
          <form className="stack-form" onSubmit={submit}>
            <label>Código do ingresso<input value={code} onChange={e => setCode(e.target.value)} placeholder="Ex. 550e8400-e29b-41d4-a716-446655440000"
              required maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
            <button className="button secondary" disabled={verifying || !code.trim()}><ShieldCheck size={19} /> Validar ingresso</button>
          </form>
        </section>
        {verifying && <Busy text="Validando ingresso…" />}
        {failure && <Notice>{failure}</Notice>}
        {result && message && (
          <div className={`scan-result panel ${result.status === 'valid' ? 'scan-valid' : 'scan-denied'}`} role="status">
            {result.status === 'valid' ? <CircleCheck size={30} /> : <XCircle size={30} />}
            <div><h3>{message.title}</h3><p>{message.detail}</p>
              {result.participant_name && <div className="admission-details">
                <strong>{result.participant_name}</strong><span>{result.event_title}</span>
                <span>{result.type_name} · Setor {result.sector_name}{result.seat ? ` · Assento ${result.seat}` : ''}</span>
              </div>}
              {'checked_in_at' in result && <time dateTime={result.checked_in_at}>{eventDate(result.checked_in_at)} · {eventTime(result.checked_in_at)}</time>}</div>
          </div>
        )}
      </div>
      {gate && activity.data && <section className="panel expansion-panel gate-log">
        <h2>Movimentação desta portaria</h2>
        <p className="muted">{activity.data.allowed} entradas autorizadas · {activity.data.denied} tentativas negadas</p>
        <ul className="gate-history">{activity.data.recent.map((row,index) => <li key={row.happened_at + index}>
          <span>{checkInMessages[row.result].title}</span><time>{eventTime(row.happened_at)}</time>
        </li>)}</ul>
      </section>}
    </div>
  )
}

function EventStation({ event }: { event: EventRecord }) {
  const viewer = useAuth().profile!
  const request = useResource(`checkin-gates:${event.id}:${viewer.id}`, () => expansion.gates(viewer,event.id),true)
  const [selected,setSelected] = useState('')
  if (request.pending) return <Busy text="Carregando portarias…" />
  if (!request.data) return <Notice>{request.error}</Notice>
  const gate = request.data.gates.find(g => g.id === selected)
  if (!request.data.required) return <CheckInStation event={event} gate={null} />
  return <>
    {request.error && <Notice>{request.error}</Notice>}
    {!request.data.gates.length ? <Notice>Sua conta precisa de autorização para uma portaria deste evento.</Notice> :
      <label className="event-select">Portaria em atendimento<select value={gate?.id ?? ''} onChange={e => setSelected(e.target.value)}>
        <option value="">Selecione uma portaria</option>
        {request.data.gates.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>}
    {gate && <CheckInStation key={gate.id} event={event} gate={gate} />}
  </>
}

export default function CheckIn() {
  const { profile } = useAuth()
  const request = useResource(`checkin-events:${profile!.id}`, () => data.checkInEvents(profile!), true)
  const [params, setParams] = useSearchParams()
  const selected = params.get('evento')
  const events = request.data ?? []
  const event = selected ? events.find(item => item.id === selected) : events[0]

  return (
    <div className="container page checkin-page">
      <PageHeading title="Controle de acesso">Selecione o evento e valide os ingressos na entrada.</PageHeading>
      {request.pending && <Busy text="Carregando seus eventos…" />}
      {request.error && <Notice>{request.error}</Notice>}
      {!request.pending && !request.error && events.length === 0 && (
        <Empty title={profile!.role === 'organizer' ? 'Nenhum evento publicado' : 'Acesso não autorizado'}>
          {profile!.role === 'organizer' ? 'Publique um evento para abrir o check-in.' : 'Peça ao organizador para adicionar sua conta à equipe de um evento publicado.'}
        </Empty>
      )}
      {events.length > 0 && (
        <>
          <label className="event-select">Evento em atendimento<select value={event?.id ?? ''} onChange={e => setParams({ evento: e.target.value }, { replace: true })}>
            {!event && <option value="" disabled>Selecione um evento autorizado</option>}
            {events.map(item => <option value={item.id} key={item.id}>{item.title}{item.is_demo ? ' · Demonstração' : ''}</option>)}
          </select></label>
          {event && <EventStation key={event.id} event={event} />}
        </>
      )}
    </div>
  )
}
