import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { IScannerControls } from '@zxing/browser'
import { Camera, CircleCheck, Keyboard, ScanLine, ShieldCheck, XCircle } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { data, errorMessage } from '../data'
import { checkInMessages, eventDate, eventTime } from '../data/domain'
import type { CheckInResult, EventRecord } from '../data/types'
import { useResource } from '../data/useResource'
import { Busy, Empty, Notice, PageHeading } from '../components/ui'

function CameraReader({ onRead, onError }: { onRead: (result: string) => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const callbacks = useRef({ onRead, onError })
  callbacks.current = { onRead, onError }

  useEffect(() => {
    const video = videoRef.current!
    let controls: IScannerControls | undefined
    let stream: MediaStream | undefined
    let stopped = false

    const stop = () => {
      controls?.stop()
      stream?.getTracks().forEach(track => track.stop())
      video.srcObject = null
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          callbacks.current.onError('A câmera precisa de HTTPS ou localhost. Você pode digitar o código abaixo.')
          return
        }
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        if (stopped) return
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
        if (stopped) {
          stop()
          return
        }
        controls = await new BrowserQRCodeReader().decodeFromStream(
          stream,
          video,
          (result, _error, scanner) => {
            if (result && !stopped) {
              stopped = true
              scanner.stop()
              callbacks.current.onRead(result.getText())
            }
          },
        )
        if (stopped) stop()
      } catch (issue) {
        if (stopped) return
        stop()
        const denied = issue instanceof Error && issue.name === 'NotAllowedError'
        callbacks.current.onError(denied
          ? 'O acesso à câmera foi negado. Permita o acesso no navegador ou digite o código.'
          : 'Não foi possível abrir a câmera. Confira se ela está disponível ou digite o código.')
      }
    }

    void start()
    return () => {
      stopped = true
      stop()
    }
  }, [])

  return <video ref={videoRef} className="scanner-video" muted autoPlay playsInline aria-label="Prévia da câmera para leitura do QR Code" />
}

function CheckInStation({ event }: { event: EventRecord }) {
  const { profile } = useAuth()
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
      setResult(await data.validate(profile!, event.id, value))
      setCode('')
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
              {'checked_in_at' in result && <time dateTime={result.checked_in_at}>{eventDate(result.checked_in_at)} · {eventTime(result.checked_in_at)}</time>}</div>
          </div>
        )}
      </div>
    </div>
  )
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
          {event && <CheckInStation key={event.id} event={event} />}
        </>
      )}
    </div>
  )
}
