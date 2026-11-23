import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PackagePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../data/auth'
import { errorMessage } from '../data'
import { createProduct, deleteProduct, myProduct, myProducts, parsePriceCents, publicProducts, updateProduct } from '../data/products'
import type { Product, ProductInput } from '../data/products'
import { Busy, Empty, Notice, PageHeading } from '../components/ui'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function ProductCard({ product, manage = false }: { product: Product; manage?: boolean }) {
  return <article className="panel product-item">
    <div className="product-picture">
      {product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy" /> : <PackagePlus size={34} />}
    </div>
    <div className="product-information">
      <h2>{product.name}</h2>
      <p>{product.description || 'Sem descrição'}</p>
      <strong>{currency.format(product.price_cents / 100)}</strong>
      <small>Estoque: {product.stock} {manage ? (product.active ? '· Publicado' : '· Rascunho') : ''}</small>
      {manage && <Link to={`/produtos/meus/${product.id}/editar`} className="button secondary small">
        <Pencil size={15} /> Editar
      </Link>}
    </div>
  </article>
}

export function ProductCatalog() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    publicProducts().then(rows => { if (active) setProducts(rows) })
      .catch(issue => { if (active) setError(errorMessage(issue)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  return <div className="container page">
    <PageHeading title="Produtos" action={<Link to="/produtos/meus" className="button primary">
      <Plus size={17} /> Gerenciar produtos</Link>}>Explore os produtos cadastrados na plataforma.</PageHeading>
    {loading && <Busy />}
    {error && <Notice>{error}</Notice>}
    {!loading && !error && !products.length && <Empty title="Nenhum produto publicado">Os produtos disponíveis aparecerão aqui.</Empty>}
    <div className="product-grid">{products.map(product => <ProductCard key={product.id} product={product} />)}</div>
  </div>
}

export function MyProducts() {
  const { profile } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  async function load() {
    if (!profile) return
    setError('')
    try { setProducts(await myProducts(profile.id)) }
    catch (issue) { setError(errorMessage(issue)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [profile?.id])
  async function remove(product: Product) {
    if (!profile || !window.confirm(`Excluir definitivamente "${product.name}"?`)) return
    setDeleting(product.id)
    setError('')
    try {
      await deleteProduct(product.id, profile.id)
      setProducts(items => items.filter(item => item.id !== product.id))
    } catch (issue) { setError(errorMessage(issue)) }
    finally { setDeleting(null) }
  }
  return <div className="container page">
    <PageHeading title="Meus produtos" action={<Link to="/produtos/novo" className="button primary"><Plus size={17} /> Novo produto</Link>}>
      Cadastre, edite e publique seus produtos. Somente você pode gerenciá-los.</PageHeading>
    {error && <Notice>{error}</Notice>}
    {loading ? <Busy /> : !products.length && !error ? <Empty title="Você ainda não cadastrou produtos">Clique em Novo produto para começar.</Empty>
      : <div className="product-grid">{products.map(product => <div key={product.id}>
        <ProductCard product={product} manage />
        <button className="text-button danger-text product-delete" disabled={deleting !== null}
          onClick={() => void remove(product)}><Trash2 size={15} /> {deleting === product.id ? 'Excluindo…' : 'Excluir produto'}</button>
      </div>)}</div>}
  </div>
}

export function ProductEditor() {
  const { id } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [existing, setExisting] = useState<Product | null>(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!id || !profile) return
    let active = true
    myProduct(id, profile.id)
      .then(product => { if (active) setExisting(product) })
      .catch(issue => { if (active) setError(errorMessage(issue)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, profile?.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    setSaving(true)
    setError('')
    const fields = new FormData(event.currentTarget)
    try {
      const name = String(fields.get('name') ?? '').trim()
      const description = String(fields.get('description') ?? '').trim()
      const price_cents = parsePriceCents(String(fields.get('price') ?? ''))
      const stock = Number(fields.get('stock'))
      const image = String(fields.get('image_url') ?? '').trim()
      if (name.length < 3 || name.length > 120) throw new Error('O nome deve conter entre 3 e 120 caracteres.')
      if (description.length > 2000) throw new Error('A descrição deve ter até 2000 caracteres.')
      if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) throw new Error('Estoque inválido.')
      if (image && (!image.startsWith('https://') || image.length > 1200)) throw new Error('Informe uma URL de imagem HTTPS válida.')
      const input: ProductInput = { name, description, price_cents, stock, image_url: image || null,
        active: fields.get('active') === 'on' }
      if (id) await updateProduct(id, profile.id, input)
      else await createProduct(profile.id, input)
      navigate('/produtos/meus', { replace: true })
    } catch (issue) { setError(errorMessage(issue)) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="container page"><Busy /></div>
  if (id && !error && !existing) return <div className="container page"><Empty title="Produto não encontrado">Você não pode editar este produto.</Empty></div>
  return <div className="container page">
    <Link to="/produtos/meus" className="back-link"><ArrowLeft size={16} /> Meus produtos</Link>
    <PageHeading title={id ? 'Editar produto' : 'Cadastrar produto'}>
      {id ? 'Atualize as informações do seu produto.' : 'Preencha as informações do produto para cadastrá-lo.'}</PageHeading>
    {error && <Notice>{error}</Notice>}
    {(!id || existing) && <form className="panel editor stack-form product-form" onSubmit={submit} key={existing?.id}>
      <label>Nome do produto<input name="name" required minLength={3} maxLength={120}
        defaultValue={existing?.name} placeholder="Ex.: Camiseta do evento" /></label>
      <label>Descrição<textarea name="description" maxLength={2000} rows={4}
        defaultValue={existing?.description} placeholder="Descreva o produto" /></label>
      <div className="form-grid">
        <label>Preço (R$)<input name="price" type="number" required min={0} max={2000000}
          step="0.01" defaultValue={existing ? (existing.price_cents / 100).toFixed(2) : ''} placeholder="49.90" /></label>
        <label>Quantidade em estoque<input name="stock" type="number" required min={0} max={1000000}
          step={1} defaultValue={existing?.stock ?? 0} /></label>
      </div>
      <label>URL da imagem (HTTPS)<input name="image_url" type="url" maxLength={1200}
        defaultValue={existing?.image_url ?? ''} placeholder="https://..." /></label>
      <label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={existing?.active ?? false} />
        Publicar no catálogo</label>
      <div className="button-row"><Link className="button secondary" to="/produtos/meus">Cancelar</Link>
        <button className="button primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar produto'}</button></div>
    </form>}
  </div>
}
