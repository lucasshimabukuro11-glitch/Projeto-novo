import { useState } from 'react'
import type { FormEvent } from 'react'
import { Award, ClipboardCheck } from 'lucide-react'
import { expansion } from '../../data/expansion'
import type { CertificateActivity, CertificateSettings, CertificateInput } from '../../data/expansion/types'
import { brasiliaInstant, eventDate } from '../../data/domain'
import type { EventRecord, Profile } from '../../data/types'
import { useResource } from '../../data/useResource'
import { Busy, Notice } from '../ui'
import { useAction } from './useAction'

const localTime = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',month: '2-digit',day: '2-digit',hour: '2-digit',minute: '2-digit',timeZone: 'America/Sao_Paulo',
})
const fieldDate = (date: string) => localTime.format(new Date(date)).replace(' ','T')

function TemplateForm({ event, viewer, template, refresh }: {
  event: EventRecord; viewer: Profile; template: CertificateSettings | null; refresh: () => void
}) {
  const action = useAction(refresh)
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    const input: CertificateInput = {
      enabled: form.has('enabled'), event_name: text('event_name'), organizer_name: text('organizer_name'),
      hours: Number(form.get('hours')), event_date: text('event_date'), participation_text: text('participation_text'),
      logo_url: text('logo_url') || null, signature_url: text('signature_url') || null,
      completed: form.has('completed'), completes_at: text('completes_at') ? brasiliaInstant(text('completes_at')) : null,
    }
    void action.run(() => expansion.saveCertificate(viewer,event.id,input),'Configuração de certificado salva.')
  }

  return <form className="stack-form" onSubmit={save}>
    <label className="checkbox-label"><input name="enabled" type="checkbox" defaultChecked={template?.enabled ?? true} /> Ativar certificados para este evento</label>
    <div className="form-grid">
      <label>Nome no certificado<input name="event_name" required minLength={3} maxLength={120} defaultValue={template?.event_name ?? event.title} /></label>
      <label>Organizador ou instituição<input name="organizer_name" required minLength={2} maxLength={120} defaultValue={template?.organizer_name ?? viewer.display_name} /></label>
      <label>Carga horária<input name="hours" type="number" required min={0.01} max={1000} step={0.01} defaultValue={template?.hours ?? 4} /></label>
      <label>Data de realização<input name="event_date" type="date" required defaultValue={template?.event_date ?? fieldDate(event.starts_at).slice(0,10)} /></label>
      <label className="full">Texto de participação<textarea name="participation_text" required minLength={3} maxLength={500} rows={3}
        defaultValue={template?.participation_text ?? 'Participou das atividades e concluiu os requisitos de presença do evento.'} /></label>
      <label>URL da logomarca<input name="logo_url" type="url" maxLength={1200} defaultValue={template?.logo_url ?? ''} placeholder="https://..." /></label>
      <label>URL da assinatura institucional<input name="signature_url" type="url" maxLength={1200} defaultValue={template?.signature_url ?? ''} placeholder="https://..." /></label>
      <label>Liberação programada em horário de Brasília<input name="completes_at" type="datetime-local"
        defaultValue={template?.completes_at ? fieldDate(template.completes_at) : ''} /></label>
      <label className="checkbox-label"><input name="completed" type="checkbox" defaultChecked={Boolean(template?.completed_at)} /> Marcar como concluído</label>
    </div>
    <p className="muted">A emissão exige check-in confirmado, conclusão programada ou manual e presença nas atividades obrigatórias.</p>
    {action.notice}
    <div><button className="button primary small" disabled={action.busy}>Salvar certificado</button></div>
  </form>
}

function AttendanceForm({ viewer, event, activity, refresh }: {
  viewer: Profile; event: EventRecord; activity: CertificateActivity; refresh: () => void
}) {
  const action = useAction(refresh)
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fields = new FormData(e.currentTarget)
    void action.run(() => expansion.recordActivity(viewer,event.id,activity.id,String(fields.get('email')),fields.get('presence') === 'true'),
      'Presença da atividade atualizada.')
  }
  return <details className="expansion-fold">
    <summary>{activity.name} <span className="muted">{activity.required ? 'Obrigatória' : 'Opcional'} · {activity.present_count} presentes</span></summary>
    <form className="stack-form" onSubmit={submit}>
      <label>E-mail do participante<input name="email" type="email" required /></label>
      <label>Situação<select name="presence"><option value="true">Presente</option><option value="false">Ausente</option></select></label>
      {action.notice}
      <div><button className="button secondary small" disabled={action.busy}>Atualizar presença</button></div>
    </form>
    <label className="checkbox-label"><input type="checkbox" checked={activity.required} disabled={action.busy}
      onChange={e => void action.run(() => expansion.saveActivity(viewer,event.id,activity.id,activity.name,e.target.checked),'Requisito atualizado.')} />
      Exigir presença para emitir certificado
    </label>
  </details>
}

export default function CertificateSetup({ event, viewer }: { event: EventRecord; viewer: Profile }) {
  const setup = useResource(`certificate-setup:${event.id}`, () => expansion.certificateSetup(viewer,event.id),true)
  const action = useAction(setup.refresh)
  const [revoking, setRevoking] = useState('')
  if (setup.pending) return <Busy />
  if (!setup.data) return <Notice>{setup.error}</Notice>
  const { settings, activities, issued } = setup.data
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fields = new FormData(form)
    if (await action.run(() => expansion.saveActivity(viewer,event.id,null,String(fields.get('name')),fields.has('required')),'Atividade cadastrada.')) form.reset()
  }

  return <div className="expansion-stack">
    {setup.error && <Notice>{setup.error}</Notice>}
    <section className="panel expansion-panel">
      <div className="panel-heading"><Award size={21} /><div><h2>Modelo de certificado</h2><p>Os certificados preservam os dados da configuração usada na emissão.</p></div></div>
      <TemplateForm event={event} viewer={viewer} template={settings} refresh={setup.refresh} />
    </section>
    <section className="panel expansion-panel">
      <div className="panel-heading"><ClipboardCheck size={21} /><div><h2>Atividades e presença</h2><p>Registre a presença de participantes que fizeram check-in no evento.</p></div></div>
      <form className="stack-form" onSubmit={add}>
        <div className="form-grid"><label>Nome da atividade<input name="name" required minLength={2} maxLength={120} /></label>
          <label className="checkbox-label"><input name="required" type="checkbox" defaultChecked /> Exigir presença na atividade</label></div>
        <div><button className="button secondary small" disabled={action.busy}>Adicionar atividade</button></div>
      </form>
      {action.notice}
      {activities.map(activity => <AttendanceForm key={activity.id} viewer={viewer} event={event} activity={activity} refresh={setup.refresh} />)}
    </section>
    <section className="panel expansion-panel">
      <h2>Certificados emitidos</h2>
      {issued.length ? <ul className="team-list">
        {issued.map(c => <li key={c.id}><div><strong>{c.details.participant_name}</strong><span>{eventDate(c.issued_at)} · {c.revoked_at ? 'Revogado' : 'Válido'}</span></div>
          {!c.revoked_at && (revoking === c.id ? <div className="button-row">
            <button className="button secondary small" onClick={() => setRevoking('')}>Voltar</button>
            <button className="button danger small" disabled={action.busy} onClick={async () => {
              if (await action.run(() => expansion.revoke(viewer,event.id,c.id),'Certificado revogado.')) setRevoking('')
            }}>Confirmar revogação</button>
          </div> : <button className="text-button danger-text" onClick={() => setRevoking(c.id)}>Revogar</button>)}</li>)}
      </ul> : <p className="muted">Nenhum certificado emitido.</p>}
    </section>
  </div>
}
