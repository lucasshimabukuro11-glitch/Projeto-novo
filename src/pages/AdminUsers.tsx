import { useState } from 'react'
import { useAuth } from '../data/auth'
import { data } from '../data'
import { eventDate, roleLabels } from '../data/domain'
import { useResource } from '../data/useResource'
import { Busy, Notice, PageHeading, Pager } from '../components/ui'

export default function AdminUsers() {
  const { profile } = useAuth()
  const [onlyOrganizers, setOnlyOrganizers] = useState(false)
  const [page, setPage] = useState(0)
  const users = useResource(`users:${profile!.id}:${page}:${onlyOrganizers}`, () => data.accounts(profile!, page, onlyOrganizers), true)
  return (
    <>
      <PageHeading title="Usuários">Consulte as contas participantes e os organizadores.</PageHeading>
      <div className="filters" role="group" aria-label="Perfis de usuário">
        <button className="filter-chip" aria-pressed={!onlyOrganizers} onClick={() => { setOnlyOrganizers(false); setPage(0) }}>Todos os usuários</button>
        <button className="filter-chip" aria-pressed={onlyOrganizers} onClick={() => { setOnlyOrganizers(true); setPage(0) }}>Organizadores</button>
      </div>
      {users.pending && <Busy />}
      {users.error && <Notice>{users.error}</Notice>}
      {users.data && (
        <section className="panel management-panel">
          {users.data.rows.length ? (
            <div className="table-wrap">
              <table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Cadastro</th></tr></thead>
                <tbody>{users.data.rows.map(user => <tr key={user.id}>
                  <td><strong>{user.display_name}</strong></td><td>{user.email}</td><td><span className="status-chip accent">{roleLabels[user.role]}</span></td>
                  <td>{eventDate(user.created_at)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          ) : <p className="muted">Nenhuma conta neste filtro.</p>}
          <Pager page={page} next={users.data.hasMore} onChange={setPage} />
        </section>
      )}
    </>
  )
}
