import { pageSize, toPage } from './domain'
import { supabase, value } from './supabase'

export interface ProductCategory {
  id: string
  name: string
  active: boolean
}

export interface Product {
  id: string
  owner_id: string
  name: string
  description: string
  price_cents: number
  stock: number
  image_url: string | null
  category_id: string | null
  category: Pick<ProductCategory, 'name'> | null
  is_example: boolean
  active: boolean
  created_at: string
  updated_at: string
  owner_name?: string
}

export type ProductInput = Pick<Product, 'name' | 'description' | 'price_cents' | 'stock' | 'image_url' | 'active' | 'category_id'>
type Scope = { catalogue: true } | { ownerId: string } | { admin: true }

const productFields = '*,category:product_categories(name)'

function client() {
  if (!supabase) throw new Error('Conecte o Supabase para acessar os produtos.')
  return supabase
}

export async function listProducts(scope: Scope, page: number, category?: string) {
  const db = client()
  const query = db.from('products').select(productFields)
  if ('catalogue' in scope) query.eq('active', true)
  if ('ownerId' in scope) query.eq('owner_id', scope.ownerId)
  if (category) query.eq('category_id', category)
  const start = page * pageSize
  const result = toPage(value<Product[]>(await query.order('created_at', { ascending: false })
    .order('id').range(start, start + pageSize)))
  if ('admin' in scope && result.rows.length) {
    const ownerIds = [...new Set(result.rows.map(row => row.owner_id))]
    const owners = value<{ id: string; display_name: string }[]>(await db.from('profiles').select('id, display_name').in('id', ownerIds))
    const names = new Map(owners.map(owner => [owner.id, owner.display_name]))
    return { ...result, rows: result.rows.map(row => ({ ...row, owner_name: names.get(row.owner_id) })) }
  }
  return result
}

export async function findProduct(id: string, ownerId?: string) {
  const query = client().from('products').select(productFields).eq('id', id)
  if (ownerId) query.eq('owner_id', ownerId)
  return value<Product | null>(await query.maybeSingle())
}

export async function createProduct(ownerId: string, product: ProductInput) {
  return value<Product>(await client().from('products').insert({ owner_id: ownerId, ...product })
    .select(productFields).single())
}

export async function updateProduct(id: string, product: ProductInput) {
  return value<Product>(await client().from('products').update(product).eq('id', id).select(productFields).single())
}

export async function deleteProduct(id: string, ownerId: string) {
  return value(await client().from('products').delete().eq('id', id).eq('owner_id', ownerId).select('id').single())
}

export async function listProductCategories() {
  return value<ProductCategory[]>(await client().from('product_categories').select('id, name, active').order('name'))
}

export async function saveProductCategory(name: string, active: boolean, id?: string) {
  const table = client().from('product_categories')
  const result = id ? table.update({ name, active }).eq('id', id) : table.insert({ name, active })
  return value<ProductCategory>(await result.select('id, name, active').single())
}

export function parsePriceCents(raw: string): number {
  const numeric = Number(raw)
  if (!raw.trim() || !Number.isFinite(numeric) || numeric < 0 || numeric > 2_000_000 ||
      !/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) {
    throw new Error('Informe um preço válido, com até duas casas decimais.')
  }
  return Math.round(numeric * 100)
}
