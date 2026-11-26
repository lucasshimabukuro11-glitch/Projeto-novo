import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { data, errorMessage } from './index'
import { demoProfile, signInDemo, signInDemoEmail, signOutDemo, signUpDemo } from './demo'
import type { DemoPersona } from './demo-seed'
import { isDemo, loadProfile, supabase, value } from './supabase'
import type { Profile } from './types'

type CredentialState = 'active' | 'password_required' | 'finish_required' | 'sign_in_required'

interface AuthContext {
  profile: Profile | null
  credentialState: CredentialState
  pending: boolean
  error: string
  hasCheckIn: boolean
  recoveryPending: boolean
  recoveringPassword: boolean
  refreshProfile: () => void
  requestRecovery: (email: string) => Promise<void>
  changeRecoveredPassword: (password: string) => Promise<void>
  changeInitialPassword: (password: string) => Promise<void>
  finishFirstAccess: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<boolean>
  signInAs: (persona: DemoPersona) => Promise<void>
  signOut: () => Promise<void>
}

const Context = createContext<AuthContext | null>(null)

const recoveryPath = '/redefinir-senha'
const recoveryKey = 'eventscan.auth.recovery'

function readRecoveryUser() {
  try { return sessionStorage.getItem(recoveryKey) } catch { return null }
}

function writeRecoveryUser(id: string | null) {
  try {
    if (id) sessionStorage.setItem(recoveryKey, id)
    else sessionStorage.removeItem(recoveryKey)
  } catch {
    // The current page can still complete recovery when browser storage is unavailable.
  }
}

export function useAuth() {
  const auth = useContext(Context)
  if (!auth) throw new Error('Sessão indisponível.')
  return auth
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [credentialState, setCredentialState] = useState<CredentialState>('active')
  const [resolved, setResolved] = useState(false)
  const [error, setError] = useState('')
  const [recoveryUser, setRecoveryUser] = useState<string | null>(null)
  const [profileRevision, setProfileRevision] = useState(0)
  const refreshProfile = useCallback(() => setProfileRevision(revision => revision + 1), [])
  const [teamMember, setTeamMember] = useState<string | null>(null)

  useEffect(() => {
    if (isDemo) {
      let active = true
      demoProfile().then(user => { if (active) setProfile(user) })
        .catch(issue => { if (active) setError(errorMessage(issue)) })
        .finally(() => { if (active) setResolved(true) })
      return () => { active = false }
    }
    if (!supabase) return
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY' && next) {
        writeRecoveryUser(next.user.id)
        setRecoveryUser(next.user.id)
      } else if (!next) {
        writeRecoveryUser(null)
        setRecoveryUser(null)
      } else if (event === 'INITIAL_SESSION' && readRecoveryUser() === next.user.id) {
        setRecoveryUser(next.user.id)
      }
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  const sessionReady = session !== undefined
  useEffect(() => {
    if (!supabase || !sessionReady) return
    let active = true
    setError('')
    if (!userId) {
      setProfile(null)
      setCredentialState('active')
      setResolved(true)
      return
    }
    setResolved(false)
    Promise.all([loadProfile(userId), supabase.rpc('account_credential_state')])
      .then(([user, access]) => {
        if (!active) return
        const state = value<CredentialState>(access)
        setProfile(user)
        setCredentialState(state)
      })
      .catch(issue => { if (active) { setProfile(null); setError(errorMessage(issue)) } })
      .finally(() => { if (active) setResolved(true) })
    return () => { active = false }
  }, [sessionReady, userId, profileRevision])

  const access = profile?.id === userId ? credentialState : 'active'
  const current = isDemo || (profile?.id === userId && access === 'active') ? profile : null
  useEffect(() => {
    if (!current || current.role === 'organizer') return
    let active = true
    const load = () => data.checkInEvents(current)
      .then(events => { if (active) setTeamMember(events.length ? current.id : null) })
      .catch(() => { if (active) setTeamMember(null) })
    void load()
    const unwatch = data.watch(load)
    const interval = window.setInterval(load, 8000)
    return () => {
      active = false
      unwatch()
      window.clearInterval(interval)
    }
  }, [current])

  async function signIn(email: string, password: string) {
    if (isDemo) {
      setError('')
      setProfile(await signInDemoEmail(email))
      return
    }
    if (!supabase) throw new Error('Configure o acesso ao Supabase.')
    writeRecoveryUser(null)
    setRecoveryUser(null)
    const { error: failure } = await supabase.auth.signInWithPassword({ email, password })
    if (failure) throw failure
  }

  async function signUp(name: string, email: string, password: string) {
    if (isDemo) {
      setProfile(await signUpDemo(name, email))
      return true
    }
    if (!supabase) throw new Error('Configure o acesso ao Supabase.')
    const { data: result, error: failure } = await supabase.auth.signUp({
      email, password, options: { data: { display_name: name }, emailRedirectTo: window.location.origin },
    })
    if (failure) throw failure
    return Boolean(result.session)
  }

  async function signInAs(persona: DemoPersona) {
    if (!isDemo) throw new Error('Perfil disponível apenas na demonstração.')
    const user = await signInDemo(persona)
    setError('')
    setProfile(user)
  }

  async function signOut() {
    if (isDemo) {
      signOutDemo()
      setProfile(null)
      setTeamMember(null)
    } else if (supabase) {
      const { error: failure } = await supabase.auth.signOut({ scope: 'local' })
      if (failure) throw failure
    }
  }

  const recoveringPassword = Boolean(userId && userId === recoveryUser)

  async function requestRecovery(email: string) {
    if (!supabase) throw new Error('A recuperação de senha está disponível com o Supabase conectado.')
    const { error: failure } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL(recoveryPath, window.location.origin).href,
    })
    if (failure) throw failure
  }

  async function changeRecoveredPassword(password: string) {
    if (!supabase || !recoveringPassword) throw new Error('Solicite um novo link de recuperação.')
    const { error: failure } = await supabase.auth.updateUser({ password })
    if (failure) throw failure
    writeRecoveryUser(null)
    setRecoveryUser(null)
    if (access === 'password_required' || access === 'finish_required') await finishFirstAccess()
  }

  async function finishFirstAccess() {
    if (!supabase || !userId) throw new Error('Entre na sua conta para concluir o primeiro acesso.')
    try {
      value(await supabase.rpc('complete_first_access'))
      setCredentialState('sign_in_required')
      const { error: failure } = await supabase.auth.signOut({ scope: 'global' })
      if (failure) throw failure
    } finally {
      refreshProfile()
    }
  }

  async function changeInitialPassword(password: string) {
    if (!supabase || access !== 'password_required') throw new Error('A troca inicial de senha está indisponível.')
    const { error: failure } = await supabase.auth.updateUser({ password })
    if (failure) throw failure
    await finishFirstAccess()
  }

  const pending = !resolved || Boolean(userId && profile?.id !== userId && !error)
  const hasCheckIn = Boolean(current && (current.role === 'organizer' || current.id === teamMember))
  return (
    <Context.Provider value={{
      profile: current, credentialState: access, pending, error, hasCheckIn, recoveryPending: !isDemo && !sessionReady,
      recoveringPassword, refreshProfile, requestRecovery, changeRecoveredPassword, changeInitialPassword, finishFirstAccess,
      signIn, signUp, signInAs, signOut,
    }}>
      {children}
    </Context.Provider>
  )
}
