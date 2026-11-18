import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { data, errorMessage } from './index'
import { demoProfile, signInDemo, signInDemoEmail, signOutDemo, signUpDemo } from './demo'
import type { DemoPersona } from './demo-seed'
import { isDemo, loadProfile, supabase } from './supabase'
import type { Profile } from './types'

interface AuthContext {
  profile: Profile | null
  pending: boolean
  error: string
  hasCheckIn: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<boolean>
  signInAs: (persona: DemoPersona) => Promise<void>
  signOut: () => Promise<void>
}

const Context = createContext<AuthContext | null>(null)

export function useAuth() {
  const auth = useContext(Context)
  if (!auth) throw new Error('Sessão indisponível.')
  return auth
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [resolved, setResolved] = useState(false)
  const [error, setError] = useState('')
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
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  const sessionReady = session !== undefined
  useEffect(() => {
    if (isDemo || !sessionReady) return
    let active = true
    setError('')
    if (!userId) {
      setProfile(null)
      setResolved(true)
      return
    }
    setResolved(false)
    loadProfile(userId)
      .then(user => { if (active) setProfile(user) })
      .catch(issue => { if (active) { setProfile(null); setError(errorMessage(issue)) } })
      .finally(() => { if (active) setResolved(true) })
    return () => { active = false }
  }, [sessionReady, userId])

  const current = isDemo || profile?.id === userId ? profile : null
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

  const pending = !resolved || Boolean(userId && profile?.id !== userId && !error)
  const hasCheckIn = Boolean(current && (current.role === 'organizer' || current.id === teamMember))
  return (
    <Context.Provider value={{ profile: current, pending, error, hasCheckIn, signIn, signUp, signInAs, signOut }}>
      {children}
    </Context.Provider>
  )
}
