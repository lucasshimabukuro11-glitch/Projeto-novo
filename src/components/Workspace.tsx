import { CalendarDays, LayoutDashboard, ScanLine, UsersRound } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

export default function Workspace({ admin = false }: { admin?: boolean }) {
  const root = admin ? '/administracao' : '/organizacao'

  return (
    <div className="container workspace">
      <aside className="workspace-side">
        <strong>{admin ? 'Administração' : 'Organização'}</strong>
        <nav aria-label={admin ? 'Painel administrativo' : 'Painel do organizador'}>
          <NavLink end to={root}><LayoutDashboard size={18} /> Visão geral</NavLink>
          <NavLink to={`${root}/eventos`}><CalendarDays size={18} /> {admin ? 'Eventos' : 'Meus eventos'}</NavLink>
          {admin
            ? <NavLink to={`${root}/usuarios`}><UsersRound size={18} /> Usuários</NavLink>
            : <NavLink to="/check-in"><ScanLine size={18} /> Controle de acesso</NavLink>}
        </nav>
      </aside>
      <div className="workspace-main"><Outlet /></div>
    </div>
  )
}
