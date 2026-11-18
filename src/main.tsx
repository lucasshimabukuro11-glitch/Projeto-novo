import { lazy, StrictMode, Suspense } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import './styles.css'
import { AuthProvider, useAuth } from './data/auth'
import { configIssue } from './data/supabase'
import type { Role } from './data/types'
import Layout from './components/Layout'
import Workspace from './components/Workspace'
import { Brand, Busy, Empty, Notice } from './components/ui'
import Landing from './pages/Landing'

const AuthPage = lazy(() => import('./pages/AuthPage'))
const EventDetails = lazy(() => import('./pages/EventDetails'))
const Tickets = lazy(() => import('./pages/Tickets'))
const CheckIn = lazy(() => import('./pages/CheckIn'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const ManageEvents = lazy(() => import('./pages/ManageEvents').then(module => ({ default: module.ManageEvents })))
const CreateEvent = lazy(() => import('./pages/ManageEvents').then(module => ({ default: module.CreateEvent })))
const ManageEvent = lazy(() => import('./pages/ManageEvents').then(module => ({ default: module.ManageEvent })))
const AdminUsers = lazy(() => import('./pages/AdminUsers'))

function Secure({ children, role }: { children: ReactNode; role?: Role }) {
  const { profile, pending, error } = useAuth()
  const { pathname, search } = useLocation()
  if (pending) return <div className="container page"><Busy text="Verificando sessão…" /></div>
  if (error) return <div className="container page"><Notice>{error}</Notice></div>
  if (!profile) return <Navigate to="/entrar" replace state={{ next: pathname + search }} />
  if (role && profile.role !== role) return (
    <div className="container page"><Empty title="Acesso não autorizado" action={<Link className="button secondary" to="/">Voltar ao início</Link>}>
      Esta área é restrita ao perfil autorizado.
    </Empty></div>
  )
  return children
}

function App() {
  if (configIssue) return <div className="container page"><Brand /><Notice>{configIssue}</Notice></div>
  return (
    <AuthProvider>
      <Layout>
        <Suspense fallback={<div className="container page"><Busy /></div>}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/entrar" element={<AuthPage key="login" />} />
            <Route path="/cadastro" element={<AuthPage key="signup" signup />} />
            <Route path="/eventos/:id" element={<EventDetails />} />
            <Route path="/ingressos/:id?" element={<Secure role="participant"><Tickets /></Secure>} />
            <Route path="/check-in" element={<Secure><CheckIn /></Secure>} />
            <Route path="/organizacao" element={<Secure role="organizer"><Workspace /></Secure>}>
              <Route index element={<Dashboard />} />
              <Route path="eventos" element={<ManageEvents />} />
              <Route path="eventos/novo" element={<CreateEvent />} />
              <Route path="eventos/:id" element={<ManageEvent />} />
            </Route>
            <Route path="/administracao" element={<Secure role="admin"><Workspace admin /></Secure>}>
              <Route index element={<Dashboard admin />} />
              <Route path="eventos" element={<ManageEvents admin />} />
              <Route path="usuarios" element={<AdminUsers />} />
            </Route>
            <Route path="*" element={<div className="container page"><Empty title="Página não encontrada"
              action={<Link className="button secondary" to="/">Voltar ao início</Link>}>Confira o endereço ou navegue pelo menu.</Empty></div>} />
          </Routes>
        </Suspense>
      </Layout>
    </AuthProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
)
