import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Image, LoaderCircle, Ticket } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { EventRecord } from '../data/types'

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="EventPass, início">
      <span className="brand-icon"><Ticket size={21} strokeWidth={2.3} /></span>
      <span>Event<span className="brand-accent">Pass</span></span>
    </Link>
  )
}

export function Busy({ text = 'Carregando…' }: { text?: string }) {
  return <div className="busy" role="status"><LoaderCircle size={20} className="animate-spin" /> {text}</div>
}

export function Notice({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'success' | 'info' }) {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle
  return <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}><Icon size={19} /><div>{children}</div></div>
}

export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Ticket size={24} /></span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
}

export function PageHeading({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-heading">
      <div><h1>{title}</h1>{children && <p>{children}</p>}</div>
      {action}
    </header>
  )
}

export function Cover({ event, className = '' }: { event: Pick<EventRecord, 'cover_url' | 'category'>; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const fallback = { Música: '/images/music.webp', Tecnologia: '/images/technology.webp', Gastronomia: '/images/food.webp' }
  const src = event.cover_url || fallback[event.category as keyof typeof fallback]
  return (
    <div className={`cover ${className}`}>
      {src && src !== failed
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
        : <Image size={32} strokeWidth={1.4} aria-hidden="true" />}
    </div>
  )
}

export function Pager({ page, next, onChange }: { page: number; next: boolean; onChange: (page: number) => void }) {
  if (!page && !next) return null
  return (
    <nav className="pager" aria-label="Paginação">
      <button className="icon-button" aria-label="Página anterior" disabled={!page} onClick={() => onChange(page - 1)}><ChevronLeft size={18} /></button>
      <span>Página {page + 1}</span>
      <button className="icon-button" aria-label="Próxima página" disabled={!next} onClick={() => onChange(page + 1)}><ChevronRight size={18} /></button>
    </nav>
  )
}

export function Confirmation({ title, children, onCancel, onConfirm, busy, confirmLabel = 'Confirmar' }: {
  title: string
  children: ReactNode
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
  confirmLabel?: string
}) {
  return (
    <div className="confirm-box" role="group" aria-label={title}>
      <div><strong>{title}</strong><p>{children}</p></div>
      <div className="button-row">
        <button className="button secondary small" disabled={busy} onClick={onCancel}>Voltar</button>
        <button className="button danger small" disabled={busy} onClick={onConfirm}>{busy ? 'Aguarde…' : confirmLabel}</button>
      </div>
    </div>
  )
}
