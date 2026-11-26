import { useState } from 'react'
import { useAuth } from '../data/auth'
import { data } from '../data'
import { eventDate, eventTime, roleLabels } from '../data/domain'
import { isDemo, supabase, value } from '../data/supabase'
import type { Profile, Role } from '../data/types'
import { useResource } from '../data/useResource'
import { Busy, Confirmation, Notice, PageHeading, Pager } from '../components/ui'
import { useAction } from '../components/expansion/useAction'

interface RoleChange {
  id: number
  changed_at: string
  actor_name: string | null
  account_name: string | null
  previous_role: Role
  new_role: Role
}

export default function AdminUsers() {
  const { profile } = useAuth()
  const [onlyOrganizers, setOnlyOrganizers] = useState(false)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [newRole, setNewRole] = useState<Role>('participant')
  const [confirming, setConfirming] = useState(false)
  const users = useResource(`users:${profile!.id}:${page}:${onlyOrganizers}`, () => data.accounts(profile!, page, onlyOrganizers), true)
  const history = useResource(`role-history:${profile!.id}`, async () => supabase
    ? value<RoleChange[]>(await supabase.rpc('recent_account_role_changes')) : [])
  const action = useAction(() => { users.refresh(); history.refresh() })

  function selectUser(user: Profile) {
    setEditing(user)
    setNewRole(user.role)
    setConfirming(false)
  }

  async function applyChange() {
    if (!editing || !supabase) return
    const client = supabase
    if (await action.run(async () => value(await client.rpc('change_account_role', {
      p_account: editing.id, p_expected_role: editing.role, p_new_role: newRole,
    })), 'Permissão atualizada.')) {
      setEditing(null)
      setConfirming(false)
    }
  }

  return (
    <>
      <PageHeading title="Usuários">Consulte as contas e gerencie permissões.</PageHeading>
      <div className="filters" role="group" aria-label="Perfis de usuário">
        <button className="filter-chip" aria-pressed={!onlyOrganizers} onClick={() => { setOnlyOrganizers(false); setPage(0) }}>Todos os usuários</button>
        <button className="filter-chip" aria-pressed={onlyOrganizers} onClick={() => { setOnlyOrganizers(true); setPage(0) }}>Organizadores</button>
      </div>
      {action.notice}
      {editing && !confirming && <section className="panel expansion-panel stack-form">
        <h2>Alterar perfil de {editing.display_name}</h2>
        <label>Novo perfil<select value={newRole} onChange={e => setNewRole(e.target.value as Role)}>
          {Object.entries(roleLabels).map(([role, label]) => <option value={role} key={role}>{label}</option>)}
        </select></label>
        <div className="button-row">
          <button className="button secondary small" onClick={() => setEditing(null)}>Cancelar</button>
          <button className="button primary small" disabled={newRole === editing.role}
            onClick={() => setConfirming(true)}>Revisar alteração</button>
        </div>
      </section>}
      {editing && confirming && <Confirmation title="Confirmar alteração de perfil?" confirmLabel="Confirmar alteração"
        busy={action.busy} onCancel={() => setConfirming(false)} onConfirm={() => void applyChange()}>
        {editing.email} passará de {roleLabels[editing.role]} para {roleLabels[newRole]}.
      </Confirmation>}
      {users.pending && <Busy />}
      {users.error && <Notice>{users.error}</Notice>}
      {users.data && (
        <section className="panel management-panel">
          {users.data.rows.length ? (
            <div className="table-wrap">
              <table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Cadastro</th>{!isDemo && <th>Ações</th>}</tr></thead>
                <tbody>{users.data.rows.map(user => <tr key={user.id}>
                  <td><strong>{user.display_name}</strong></td><td>{user.email}</td>
                  <td><span className="status-chip accent">{roleLabels[user.role]}</span></td><td>{eventDate(user.created_at)}</td>
                  {!isDemo && <td>{user.id !== profile!.id && <button className="text-button"
                    onClick={() => selectUser(user)} disabled={action.busy}>Alterar perfil</button>}</td>}
                </tr>)}</tbody>
              </table>
            </div>
          ) : <p className="muted">Nenhuma conta neste filtro.</p>}
          <Pager page={page} next={users.data.hasMore} onChange={setPage} />
        </section>
      )}
      {!isDemo && <section className="panel expansion-panel">
        <h2>Alterações recentes de perfil</h2>
        {history.pending && <Busy />}
        {history.error && <Notice>{history.error}</Notice>}
        {history.data?.length ? <div className="table-wrap">
          <table><thead><tr><th>Conta</th><th>Alteração</th><th>Responsável</th><th>Horário</th></tr></thead>
            <tbody>{history.data.map(row => <tr key={row.id}>
              <td>{row.account_name ?? '—'}</td><td>{roleLabels[row.previous_role]} → {roleLabels[row.new_role]}</td>
              <td>{row.actor_name ?? '—'}</td><td>{eventDate(row.changed_at)} · {eventTime(row.changed_at)}</td>
            </tr>)}</tbody>
          </table>
        </div> : !history.pending && !history.error && <p className="muted">Nenhuma alteração registrada.</p>}
      </section>}
    </>
  )
}
