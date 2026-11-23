import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpRight, ChevronDown, LogOut, Menu, X } from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../data/auth'
import { roleLabels } from '../data/domain'
import { errorMessage } from '../data'
import { isDemo } from '../data/supabase'
import { Brand, Notice } from './ui'

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, hasCheckIn, signOut, error } = useAuth()
  const [openMenu, setOpenMenu] = useState(false)
  const [openAccount, setOpenAccount] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const navigate = useNavigate()
  const { pathname, hash, key } = useLocation()
  const anchorNavigation = hash ? key : ''

  useEffect(() => {
    setOpenMenu(false)
    setOpenAccount(false)
    if (hash) {
      const anchor = hash.slice(1)
      const frame = requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView())
      return () => cancelAnimationFrame(frame)
    }
    window.scrollTo(0, 0)
  }, [pathname, hash, anchorNavigation])

  async function logout() {
    setLogoutError('')
    try {
      await signOut()
      setOpenAccount(false)
      navigate('/')
    } catch (issue) {
      setLogoutError(errorMessage(issue))
    }
  }

  return (
    <>
      <a href="#conteudo" className="skip-link">Ir para o conteúdo</a>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav className={`main-nav ${openMenu ? 'nav-open' : ''}`} aria-label="Menu principal" id="menu-principal">
            <Link to="/#eventos" onClick={() => setOpenMenu(false)}>Explorar eventos</Link>
            {!profile && <Link to="/#como-funciona" onClick={() => setOpenMenu(false)}>Como funciona</Link>}
            {!profile && <Link to="/#organizadores" onClick={() => setOpenMenu(false)}>Para organizadores</Link>}
            {!profile && <Link className="mobile-signup" to="/cadastro">Criar conta</Link>}
            {profile?.role === 'participant' && <NavLink to="/ingressos">Meus ingressos</NavLink>}
            {profile?.role === 'participant' && <NavLink to="/certificados">Meus certificados</NavLink>}
            {profile?.role === 'organizer' && <NavLink to="/organizacao">Organização</NavLink>}
            {hasCheckIn && <NavLink to="/check-in">Check-in</NavLink>}
            {profile?.role === 'admin' && <NavLink to="/administracao">Administração</NavLink>}
          </nav>
          <div className="header-actions">
            {isDemo && <span className="demo-badge"><span /> Modo demo</span>}
            {profile ? (
              <div className="account-wrap">
                <button className="account-button" onClick={() => setOpenAccount(!openAccount)} aria-label="Minha conta" aria-expanded={openAccount}>
                  <span className="avatar">{profile.display_name.charAt(0).toLocaleUpperCase('pt-BR')}</span>
                  <span className="account-name">{profile.display_name.split(' ')[0]}</span>
                  <ChevronDown size={14} />
                </button>
                {openAccount && (
                  <div className="account-menu">
                    <strong>{profile.display_name}</strong>
                    <span>{roleLabels[profile.role]}</span>
                    {profile.role !== 'participant' && (
                      <>
                        <Link to="/ingressos" onClick={() => setOpenAccount(false)}>Meus ingressos</Link>
                        <Link to="/certificados" onClick={() => setOpenAccount(false)}>Meus certificados</Link>
                      </>
                    )}
                    {!isDemo && profile.role === 'participant' && (
                      <Link to="/solicitar-organizador" onClick={() => setOpenAccount(false)}>Perfil de organizador</Link>
                    )}
                    {isDemo && <Link to="/entrar" onClick={() => setOpenAccount(false)}>Trocar perfil de demonstração</Link>}
                    <button onClick={logout}><LogOut size={16} /> Sair</button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link className="login-link" to="/entrar">Entrar</Link>
                <Link className="button primary small header-signup" to="/cadastro">Criar conta <ArrowUpRight size={16} /></Link>
              </>
            )}
            <button className="icon-button mobile-toggle" aria-label={openMenu ? 'Fechar menu' : 'Abrir menu'} aria-expanded={openMenu}
              aria-controls="menu-principal" onClick={() => setOpenMenu(!openMenu)}>
              {openMenu ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>
      </header>
      {(error || logoutError) && <div className="container session-error"><Notice>{error || logoutError}</Notice></div>}
      <main id="conteudo" tabIndex={-1}>{children}</main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <Brand />
          <p>{isDemo ? 'Demonstração acadêmica · Eventos e contas fictícios' : 'Eventos e ingressos digitais'}</p>
          <Link to="/verificar-certificado">Verificar certificado <ArrowUpRight size={15} /></Link>
        </div>
      </footer>
    </>
  )
}
