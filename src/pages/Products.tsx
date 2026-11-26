import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PackagePlus, Pencil, Plus } from 'lucide-react'
import { useAuth } from '../data/auth'
import { errorMessage } from '../data'
import {
  createProduct, deleteProduct, findProduct, listProductCategories, listProducts,
  parsePriceCents, saveProductCategory, updateProduct,
} from '../data/products'
import type { Product, ProductCategory, ProductInput } from '../data/products'
import { isDemo } from '../data/supabase'
import { useResource } from '../data/useResource'
import { Busy, Confirmation, Empty, Notice, PageHeading, Pager } from '../components/ui'
import { useAction } from '../components/expansion/useAction'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const organizerProducts = '/produtos/meus'
const adminProducts = '/administracao/produtos'

function ProductCard({ product, edit }: { product: Product; edit?: string }) {
  return <article className="panel product-item">
    <div className="product-picture">
      {product.image_url ? <img src={product.image_url} alt="" loading="lazy" /> : <PackagePlus size={34} />}
    </div>
    <div className="product-information">
      <div className="badge-row">
        {product.category && <span className="status-chip">{product.category.name}</span>}
        {product.is_example && <span className="status-chip">Exemplo</span>}
      </div>
      <h2>{product.name}</h2>
      {product.description && <p>{product.description}</p>}
      {product.owner_name && <p className="muted">{product.owner_name}</p>}
      <strong>{currency.format(product.price_cents / 100)}</strong>
      <small>Estoque {product.stock}{edit ? (product.active ? ' · Publicado' : ' · Desativado') : ''}</small>
      {edit && <Link to={edit} className="button secondary small" aria-label={'Editar ' + product.name}>
        <Pencil size={15} /> Editar
      </Link>}
    </div>
  </article>
}

function ProductCategoryFilter({ category, onChange }: { category: string; onChange: (category: string) => void }) {
  const options = useResource('product-category-filter', () => isDemo ? Promise.resolve([]) : listProductCategories())
  return options.data?.length ? <label className="event-select">Categoria<select value={category} onChange={e => onChange(e.target.value)}>
    <option value="">Todas as categorias</option>
    {options.data.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
  </select></label> : null
}

export function ProductCatalog() {
  const { profile } = useAuth()
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(0)
  const result = useResource(`catalogue-products:${category}:${page}`,
    () => isDemo ? Promise.resolve({ rows: [], hasMore: false }) : listProducts({ catalogue: true }, page, category))
  const management = profile?.role === 'organizer' ? organizerProducts : profile?.role === 'admin' ? adminProducts : null
  return <div className="container page">
    <PageHeading title="Produtos" action={management && <Link to={management} className="button secondary">Gerenciar produtos</Link>}>
      Acessórios e lembranças dos organizadores.
    </PageHeading>
    {isDemo ? <Empty title="Catálogo disponível com Supabase">Conecte ao Supabase para consultar os produtos cadastrados.</Empty> : <>
      <ProductCategoryFilter category={category} onChange={value => { setCategory(value); setPage(0) }} />
      {result.pending && <Busy />}
      {result.error && <Notice>{result.error}</Notice>}
      {!result.pending && !result.error && !result.data?.rows.length &&
        <Empty title="Nenhum produto publicado">Os produtos publicados aparecerão aqui.</Empty>}
      <div className="product-grid">{result.data?.rows.map(product => <ProductCard key={product.id} product={product} />)}</div>
      <Pager page={page} next={Boolean(result.data?.hasMore)} onChange={setPage} />
    </>}
  </div>
}

export function MyProducts({ admin = false }: { admin?: boolean }) {
  const { profile } = useAuth()
  const [page, setPage] = useState(0)
  const [category, setCategory] = useState('')
  const [deleting, setDeleting] = useState<Product | null>(null)
  const viewer = profile!
  const root = admin ? adminProducts : organizerProducts
  const result = useResource(`managed-products:${viewer.id}:${admin}:${category}:${page}`,
    () => isDemo ? Promise.resolve({ rows: [], hasMore: false })
      : listProducts(admin ? { admin: true } : { ownerId: viewer.id }, page, category))
  const action = useAction(result.refresh)

  async function remove() {
    if (!deleting) return
    if (await action.run(() => deleteProduct(deleting.id, viewer.id), 'Produto excluído.')) setDeleting(null)
  }

  return <div className={admin ? undefined : 'container page'}>
    <PageHeading title={admin ? 'Produtos cadastrados' : 'Meus produtos'}
      action={admin ? <Link className="button secondary" to="/administracao/categorias">Categorias</Link>
        : !isDemo && <Link to="/produtos/novo" className="button primary"><Plus size={17} /> Novo produto</Link>}>
      {admin ? 'Consulte e gerencie o catálogo dos organizadores.' : 'Acompanhe o estoque e a publicação de seus produtos.'}
    </PageHeading>
    {isDemo ? <Empty title="Gestão disponível com Supabase">Conecte ao Supabase para gerenciar produtos.</Empty> : <>
      <ProductCategoryFilter category={category} onChange={value => { setCategory(value); setPage(0) }} />
      {action.notice}
      {deleting && <Confirmation title="Excluir produto?" confirmLabel="Excluir produto" busy={action.busy}
        onCancel={() => setDeleting(null)} onConfirm={() => void remove()}>{deleting.name}</Confirmation>}
      {result.pending && <Busy />}
      {result.error && <Notice>{result.error}</Notice>}
      {!result.pending && !result.error && !result.data?.rows.length &&
        <Empty title="Nenhum produto encontrado">Os produtos cadastrados aparecerão aqui.</Empty>}
      <div className="product-grid">{result.data?.rows.map(product => <div key={product.id}>
        <ProductCard product={product} edit={root + '/' + product.id + '/editar'} />
        {!admin && <button className="text-button danger-text product-delete" disabled={action.busy}
          onClick={() => setDeleting(product)}>Excluir produto</button>}
      </div>)}</div>
      <Pager page={page} next={Boolean(result.data?.hasMore)} onChange={setPage} />
    </>}
  </div>
}

export function ProductEditor({ admin = false }: { admin?: boolean }) {
  const { id } = useParams()
  const viewer = useAuth().profile!
  const navigate = useNavigate()
  const root = admin ? adminProducts : organizerProducts
  const product = useResource(`edit-product:${id}:${viewer.id}:${admin}`,
    () => id && !isDemo ? findProduct(id, admin ? undefined : viewer.id) : Promise.resolve(null))
  const categories = useResource(`edit-product-categories:${viewer.id}`, () => isDemo ? Promise.resolve([]) : listProductCategories())
  const existing = product.data
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const fields = new FormData(event.currentTarget)
    try {
      const name = String(fields.get('name') ?? '').trim()
      const description = String(fields.get('description') ?? '').trim()
      const category_id = String(fields.get('category_id') ?? '') || null
      const price_cents = parsePriceCents(String(fields.get('price') ?? ''))
      const stock = Number(fields.get('stock'))
      const image = String(fields.get('image_url') ?? '').trim()
      if (name.length < 3 || name.length > 120) throw new Error('O nome deve conter entre 3 e 120 caracteres.')
      if (description.length > 2000) throw new Error('A descrição deve ter até 2000 caracteres.')
      if (!category_id && !(id && existing?.category_id === null)) throw new Error('Selecione uma categoria.')
      if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000) throw new Error('Estoque inválido.')
      if (image && (image.length > 1200 ||
        !(/^https:\/\/[^\s]+$/i.test(image) || /^\/images\/products\/[a-z-]+\.webp$/.test(image)))) {
        throw new Error('Informe uma URL HTTPS válida para a imagem.')
      }
      const input: ProductInput = { name, description, category_id, price_cents, stock, image_url: image || null,
        active: fields.get('active') === 'on' }
      if (id) await updateProduct(id, input)
      else await createProduct(viewer.id, input)
      navigate(root, { replace: true })
    } catch (issue) { setError(errorMessage(issue)) }
    finally { setSaving(false) }
  }

  const problem = product.error || categories.error || error
  const options = categories.data?.filter(category => category.active || category.id === existing?.category_id)
  return <div className={admin ? undefined : 'container page'}>
    <Link to={root} className="back-link"><ArrowLeft size={16} /> {admin ? 'Produtos cadastrados' : 'Meus produtos'}</Link>
    <PageHeading title={id ? 'Editar produto' : 'Cadastrar produto'} />
    {problem && <Notice>{problem}</Notice>}
    {isDemo ? <Empty title="Gestão disponível com Supabase">Conecte ao Supabase para salvar alterações.</Empty>
      : product.pending || categories.pending ? <Busy />
      : id && !existing ? <Empty title="Produto indisponível">Confira os produtos que sua conta pode gerenciar.</Empty>
      : !categories.error && <form className="panel editor stack-form product-form" onSubmit={submit} key={existing?.id}>
        <label>Nome do produto<input name="name" required minLength={3} maxLength={120} defaultValue={existing?.name} /></label>
        <label>Descrição<textarea name="description" maxLength={2000} rows={4} defaultValue={existing?.description} /></label>
        <label>Categoria<select name="category_id" required={!id || Boolean(existing?.category_id)} defaultValue={existing?.category_id ?? ''}>
          <option value="">{id && !existing?.category_id ? 'Sem categoria' : 'Selecione uma categoria'}</option>
          {options?.map(category => <option key={category.id} value={category.id}>
            {category.name}{category.active ? '' : ' · Inativa'}
          </option>)}
        </select></label>
        <div className="form-grid">
          <label>Preço (R$)<input name="price" type="number" required min={0} max={2000000}
            step="0.01" defaultValue={existing ? (existing.price_cents / 100).toFixed(2) : ''} /></label>
          <label>Quantidade em estoque<input name="stock" type="number" required min={0} max={1000000}
            step={1} defaultValue={existing?.stock ?? 0} /></label>
        </div>
        <label>Endereço da imagem<input name="image_url" type="text" inputMode="url" maxLength={1200}
          defaultValue={existing?.image_url ?? ''} placeholder="https://…" /></label>
        <label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={existing?.active ?? false} />
          Publicar no catálogo</label>
        <div className="button-row"><Link className="button secondary" to={root}>Cancelar</Link>
          <button className="button primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar produto'}</button></div>
      </form>}
  </div>
}

export function ProductCategories() {
  const result = useResource('managed-product-categories', () => isDemo ? Promise.resolve([]) : listProductCategories())
  const action = useAction(result.refresh)
  const [editing, setEditing] = useState<ProductCategory | null>(null)
  const [formVersion, setFormVersion] = useState(0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const name = String(fields.get('name') ?? '').trim()
    const active = fields.get('active') === 'on'
    if (await action.run(() => saveProductCategory(name, active, editing?.id), 'Categoria salva.')) {
      setEditing(null)
      setFormVersion(version => version + 1)
    }
  }

  return <>
    <PageHeading title="Categorias de produtos">Cadastre, renomeie e desative categorias.</PageHeading>
    {isDemo ? <Empty title="Gestão disponível com Supabase">Conecte ao Supabase para administrar categorias.</Empty> : <>
      {action.notice}
      {result.error && <Notice>{result.error}</Notice>}
      <form className="panel expansion-panel stack-form" key={editing?.id ?? formVersion} onSubmit={submit}>
        <label>Nome da categoria<input name="name" minLength={2} maxLength={80} required defaultValue={editing?.name} /></label>
        <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /> Categoria ativa</label>
        <div className="button-row">
          <button className="button primary" disabled={action.busy}>{editing ? 'Salvar categoria' : 'Criar categoria'}</button>
          {editing && <button type="button" className="button secondary" disabled={action.busy} onClick={() => setEditing(null)}>Cancelar edição</button>}
        </div>
      </form>
      {result.pending && <Busy />}
      {!!result.data?.length && <div className="panel expansion-panel table-wrap">
        <table><thead><tr><th>Categoria</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody>{result.data.map(category => <tr key={category.id}>
            <td>{category.name}</td><td>{category.active ? 'Ativa' : 'Inativa'}</td>
            <td><button className="text-button" onClick={() => setEditing(category)} disabled={action.busy}
              aria-label={'Editar categoria ' + category.name}>Editar</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </>}
  </>
}
