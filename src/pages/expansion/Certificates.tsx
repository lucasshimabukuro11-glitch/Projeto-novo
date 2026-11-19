import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Award, Camera, Download, ShieldCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { useAuth } from '../../data/auth'
import { eventDate } from '../../data/domain'
import { expansion } from '../../data/expansion'
import { certificateCode, eligibilityLabels } from '../../data/expansion/domain'
import type { CertificateEvent, CertificateRecord } from '../../data/expansion/types'
import { useResource } from '../../data/useResource'
import { CameraReader } from '../../components/CameraReader'
import { Busy, Empty, Notice, PageHeading } from '../../components/ui'
import { useAction } from '../../components/expansion/useAction'
import { certificateDate, downloadCertificate } from '../../components/expansion/certificatePdf'

function verifyLink(certificate: CertificateRecord) {
  return new URL('/verificar-certificado?codigo=' + certificate.code,window.location.origin).href
}

function IssuedCertificate({ item, refresh }: { item: CertificateEvent; refresh: () => void }) {
  const viewer = useAuth().profile!
  const [missingAssets,setMissingAssets] = useState(false)
  const qr = useRef<HTMLCanvasElement>(null)
  const action = useAction(refresh)
  const certificate = item.certificate

  if (!certificate) return <>
    <p className="muted">{eligibilityLabels[item.eligibility]}</p>
    {item.eligibility === 'eligible' && <button className="button primary small" disabled={action.busy}
      onClick={() => void action.run(() => expansion.issue(viewer,item.event_id),'Certificado emitido.')}>Emitir certificado</button>}
    {action.notice}
  </>
  if (certificate.revoked_at) return <Notice>Certificado revogado.</Notice>
  const url = verifyLink(certificate)

  return <>
    <p className="muted">{certificateDate(certificate.details.event_date)} · {certificate.details.hours} h · {certificate.details.organizer_name}</p>
    <div className="certificate-qr">
      <QRCodeCanvas ref={qr} title="QR de verificação do certificado" value={url} size={149} marginSize={4} level="M" />
      <div><span className="status-chip success-text">Emitido</span><p className="muted">{certificate.code}</p>
        <Link className="text-button" to={new URL(url).pathname + new URL(url).search}>Verificar certificado</Link></div>
    </div>
    <button className="button primary small" disabled={action.busy} onClick={() => void action.run(async () => {
      const image = qr.current!.toDataURL('image/png')
      const current = await expansion.issue(viewer,item.event_id)
      setMissingAssets(await downloadCertificate(current,image))
    },'PDF gerado.')}>
      <Download size={16} /> {action.busy ? 'Gerando PDF…' : 'Baixar certificado em PDF'}
    </button>
    {action.notice}
    {missingAssets && <Notice tone="info">A logomarca ou assinatura configurada não pôde ser carregada para o PDF.</Notice>}
  </>
}

export function MyCertificates() {
  const viewer = useAuth().profile!
  const request = useResource(`my-certificates:${viewer.id}`, () => expansion.myCertificates(viewer),true)
  return <div className="container page">
    <PageHeading title="Meus certificados">Emita e baixe os certificados das suas participações.</PageHeading>
    {request.pending && <Busy />}
    {request.error && <Notice>{request.error}</Notice>}
    {request.data?.length === 0 && <Empty title="Você ainda não tem certificados">Os eventos com emissão ativa aparecem aqui quando você tem uma inscrição.</Empty>}
    {request.data && request.data.length > 0 && <div className="certificate-grid">
      {request.data.map(item => <article className="panel expansion-panel certificate-card" key={item.event_id}>
        <div className="feature-icon"><Award size={22} /></div><h2>{item.certificate?.details.event_name ?? item.title}</h2>
        <IssuedCertificate item={item} refresh={request.refresh} />
      </article>)}
    </div>}
  </div>
}

export function VerifyCertificate() {
  const [params,setParams] = useSearchParams()
  const code = params.get('codigo') ?? ''
  const [input,setInput] = useState(code)
  const [scanning,setScanning] = useState(false)
  const [cameraIssue,setCameraIssue] = useState('')
  const check = useResource(`verify:${code}`, () => code ? expansion.verify(code) : Promise.resolve(null))

  function verify(value: string) {
    const next = certificateCode(value)
    if (!next || next.length > 160) return
    setInput(next)
    if (next === code) check.refresh()
    else setParams({ codigo: next },{ replace: true })
    setScanning(false)
  }

  return <div className="container page certificate-verify">
    <PageHeading title="Verificar certificado">Consulte o código de autenticidade exibido no PDF.</PageHeading>
    <section className="panel expansion-panel">
      <form className="stack-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); verify(input) }}>
        <label>Código de autenticidade<input value={input} onChange={e => setInput(e.target.value)} required maxLength={160}
          autoComplete="off" spellCheck={false} placeholder="Código do documento" /></label>
        <div className="button-row">
          <button className="button primary"><ShieldCheck size={19} /> Verificar</button>
          <button className="button secondary" type="button" onClick={() => { setCameraIssue(''); setScanning(!scanning) }}>
            <Camera size={19} /> {scanning ? 'Fechar câmera' : 'Ler QR Code'}
          </button>
        </div>
      </form>
      {scanning && <div className="scanner-frame"><CameraReader onRead={verify} onError={error => { setCameraIssue(error); setScanning(false) }} /></div>}
      {cameraIssue && <Notice>{cameraIssue}</Notice>}
    </section>
    {code && check.pending && <Busy text="Consultando registro de emissão…" />}
    {check.error && <Notice>{check.error}</Notice>}
    {check.data?.status === 'not_found' && <Notice>Certificado inexistente.</Notice>}
    {check.data?.status === 'revoked' && <Notice>Certificado revogado.</Notice>}
    {check.data?.status === 'valid' && <section className="panel expansion-panel certificate-proof">
      <Notice tone="success">Certificado válido no registro de emissão.</Notice>
      <h2>{check.data.details.event_name}</h2>
      <p className="muted">Compare estes dados oficiais com o documento apresentado.</p>
      <dl>
        <div><dt>Participante</dt><dd>{check.data.details.participant_name}</dd></div>
        <div><dt>Organizador</dt><dd>{check.data.details.organizer_name}</dd></div>
        <div><dt>Realização</dt><dd>{certificateDate(check.data.details.event_date)}</dd></div>
        <div><dt>Carga horária</dt><dd>{check.data.details.hours} h</dd></div>
        <div><dt>Emissão</dt><dd>{eventDate(check.data.issued_at)}</dd></div>
      </dl>
      <p>{check.data.details.participation_text}</p>
    </section>}
  </div>
}
