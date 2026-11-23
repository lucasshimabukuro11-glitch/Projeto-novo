import { pageSize, toPage } from './domain'
import { supabase, value } from './supabase'

export type ApplicationStatus = 'pending' | 'approved' | 'rejected'
export type ApplicationDecision = Exclude<ApplicationStatus, 'pending'>
export interface ApplicationInput {
  organization_name: string
  contact_email: string
  city: string
}
export interface OrganizerApplication extends ApplicationInput {
  id: string
  applicant_id: string
  status: ApplicationStatus
  requested_at: string
  reviewed_at: string | null
}
type ApplicationReview = OrganizerApplication & {
  applicant: { display_name: string; email: string }
}

export const applicationStatuses: Record<ApplicationStatus, string> = {
  pending: 'Em análise',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
}

function connectedClient() {
  if (!supabase) throw new Error('Conecte o Supabase para acessar as solicitações.')
  return supabase
}

export async function latestApplication(userId: string) {
  return value<OrganizerApplication | null>(await connectedClient().from('organizer_applications')
    .select('id, applicant_id, organization_name, contact_email, city, status, requested_at, reviewed_at')
    .eq('applicant_id', userId).order('requested_at', { ascending: false }).order('id').limit(1).maybeSingle())
}

export async function requestOrganizer(input: ApplicationInput) {
  return value<OrganizerApplication>(await connectedClient().rpc('request_organizer', {
    p_organization_name: input.organization_name, p_contact_email: input.contact_email, p_city: input.city,
  }))
}

export async function reviewQueue(status: ApplicationStatus | 'all', page: number) {
  const query = connectedClient().from('organizer_applications')
    .select('id, applicant_id, organization_name, contact_email, city, status, requested_at, reviewed_at, applicant:profiles!organizer_applications_applicant_id_fkey(display_name, email)')
  if (status !== 'all') query.eq('status', status)
  const start = page * pageSize
  return toPage(value<ApplicationReview[]>(await query.order('requested_at', { ascending: false }).order('id').range(start, start + pageSize)))
}

export async function reviewApplication(id: string, decision: ApplicationDecision) {
  return value<OrganizerApplication>(await connectedClient().rpc('review_organizer_application', {
    p_application: id, p_decision: decision,
  }))
}
