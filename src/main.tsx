import { lazy, StrictMode, Suspense } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import './styles.css'
import './expansion.css'
import { AuthProvider, useAuth } from './data/auth'
import { configIssue } from './data/supabase'
import type { Role } from './data/types'
import Layout from './components/Layout'
import Workspace from './components/Workspace'
import { Brand, Busy, Empty, Notice } from './components/ui'
import Landing from './pages/Landing'

const ProductCatalog = lazy(() => import('./pages/Products').then(m => ({ default: m.ProductCatalog })))
const MyProducts = lazy(() => import('./pages/Products').then(m => ({ default: m.MyProducts })))
const ProductEditor = lazy(() => import('./pages/Products').then(m => ({ default: m.ProductEditor })))
const ProductCategories = lazy(() => import('./pages/Products').then(m => ({ default: m.ProductCategories })))
const PasswordRecovery = lazy(() => import('./pages/PasswordRecovery'))
const FirstAccess = lazy(() => import('./pages/FirstAccess'))
const RequestOrganizer = lazy(() => import('./pages/OrganizerApplications').then(module => ({ default: module.RequestOrganizer })))
const ReviewOrganizers = lazy(() => import('./pages/OrganizerApplications').then(module => ({ default: module.ReviewOrganizers })))
const EditEvent = lazy(() => import('./pages/ManageEvents').then(module => ({ default: module.EditEvent })))
const AuthPage = lazy(() => import('./pages/AuthPage'))
const EventDetails = lazy(() => import('./pages/EventDetails'))
const Tickets = lazy(() => import('./pages/Tickets'))
const CheckIn = lazy(() => import('./pages/CheckIn'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const ManageEvents = lazy(() => import('./pages/ManageEvents').then(module => ({ default: module.ManageEvents })))
const CreateEvent = lazy(() => import('./pages/ManageEvents').then(module => ({ default: module.CreateEvent })))
const ManageEvent = lazy(() => import('./pages/ManageEvents').then(module => ({ default: module.ManageEvent })))
const AdminEventTickets = lazy(() => import('./pages/ManageEvents').then(module => ({ default: module.AdminEventTickets })))
const AdminUsers = lazy(() => import('./pages/AdminUsers'))
const EventSetup = lazy(() => import('./pages/expansion/EventSetup'))
const Monitor = lazy(() => import('./pages/expansion/Monitor'))
const Audit = lazy(() => import('./pages/expansion/Audit'))
const MyCertificates = lazy(() => import('./pages/expansion/Certificates').then(module => ({ default: module.MyCertificates })))
const VerifyCertificate = lazy(() => import('./pages/expansion/Certificates').then(module => ({ default: module.VerifyCertificate })))

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

function RequireFirstAccess({ children }: { children: ReactNode }) {
  const { credentialState } = useAuth()
  const { pathname } = useLocation()
  const allowsPassword = ['/primeiro-acesso', '/recuperar-senha', '/redefinir-senha'].includes(pathname)
  return credentialState !== 'active' && !allowsPassword ? <Navigate replace to="/primeiro-acesso" /> : children
}

function App() {
  if (configIssue) return <main className="container page">
    <Brand />
    <section className="panel expansion-panel">
      <h1>Configuração do Supabase necessária</h1>
      <Notice>{configIssue}</Notice>
    </section>
  </main>
  return (
    <AuthProvider>
      <RequireFirstAccess>
        <Layout>
          <Suspense fallback={<div className="container page"><Busy /></div>}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/produtos" element={<ProductCatalog />} />
              <Route path="/produtos/meus" element={<Secure role="organizer"><MyProducts /></Secure>} />
              <Route path="/produtos/novo" element={<Secure role="organizer"><ProductEditor /></Secure>} />
              <Route path="/produtos/meus/:id/editar" element={<Secure role="organizer"><ProductEditor /></Secure>} />
              <Route path="/entrar" element={<AuthPage key="login" />} />
              <Route path="/cadastro" element={<AuthPage key="signup" signup />} />
              <Route path="/recuperar-senha" element={<PasswordRecovery key="recovery-request" />} />
              <Route path="/redefinir-senha" element={<PasswordRecovery key="recovery-reset" reset />} />
              <Route path="/primeiro-acesso" element={<FirstAccess />} />
              <Route path="/solicitar-organizador" element={<Secure><RequestOrganizer /></Secure>} />
              <Route path="/eventos/:id" element={<EventDetails />} />
              <Route path="/ingressos/:id?" element={<Secure><Tickets /></Secure>} />
              <Route path="/certificados" element={<Secure><MyCertificates /></Secure>} />
              <Route path="/verificar-certificado" element={<VerifyCertificate />} />
              <Route path="/check-in" element={<Secure><CheckIn /></Secure>} />
              <Route path="/organizacao" element={<Secure role="organizer"><Workspace /></Secure>}>
                <Route index element={<Dashboard />} />
                <Route path="eventos" element={<ManageEvents />} />
                <Route path="eventos/novo" element={<CreateEvent />} />
                <Route path="eventos/:id" element={<ManageEvent />} />
                <Route path="eventos/:id/editar" element={<EditEvent />} />
                <Route path="eventos/:id/configuracao" element={<EventSetup />} />
                <Route path="monitoramento" element={<Monitor />} />
                <Route path="auditoria" element={<Audit />} />
              </Route>
              <Route path="/administracao" element={<Secure role="admin"><Workspace admin /></Secure>}>
                <Route index element={<Dashboard admin />} />
                <Route path="eventos" element={<ManageEvents admin />} />
                <Route path="eventos/:id/ingressos" element={<AdminEventTickets />} />
                <Route path="produtos" element={<MyProducts admin />} />
                <Route path="produtos/:id/editar" element={<ProductEditor admin />} />
                <Route path="categorias" element={<ProductCategories />} />
                <Route path="usuarios" element={<AdminUsers />} />
                <Route path="organizadores" element={<ReviewOrganizers />} />
                <Route path="monitoramento" element={<Monitor />} />
                <Route path="auditoria" element={<Audit />} />
              </Route>
              <Route path="*" element={<div className="container page"><Empty title="Página não encontrada"
                action={<Link className="button secondary" to="/">Voltar ao início</Link>}>Confira o endereço ou navegue pelo menu.</Empty></div>} />
            </Routes>
          </Suspense>
        </Layout>
      </RequireFirstAccess>
    </AuthProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
)
