import { supabase } from './supabase'

export interface Product {
  id: string
  owner_id: string
  name: string
  description: string
  price_cents: number
  stock: number
  image_url: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type ProductInput = Pick<Product, 'name' | 'description' | 'price_cents' | 'stock' | 'image_url' | 'active'>

function client() {
  if (!supabase) throw new Error('O cadastro de produtos exige conexao com o Supabase.')
  return supabase
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data
}

export async function publicProducts(): Promise<Product[]> {
  return check(await client().from('products').select('*').eq('active', true)
    .order('created_at', { ascending: false }).limit(100)) as Product[]
}

export async function myProducts(ownerId: string): Promise<Product[]> {
  return check(await client().from('products').select('*').eq('owner_id', ownerId)
    .order('created_at', { ascending: false }).limit(100)) as Product[]
}

export async function myProduct(productId: string, ownerId: string): Promise<Product | null> {
  return check(await client().from('products').select('*').eq('id', productId)
    .eq('owner_id', ownerId).maybeSingle()) as Product | null
}

export async function createProduct(ownerId: string, product: ProductInput): Promise<Product> {
  return check(await client().from('products').insert({ owner_id: ownerId, ...product })
    .select('*').single()) as Product
}

export async function updateProduct(id: string, ownerId: string, product: ProductInput): Promise<Product> {
  return check(await client().from('products').update(product).eq('id', id)
    .eq('owner_id', ownerId).select('*').single()) as Product
}

export async function deleteProduct(id: string, ownerId: string): Promise<void> {
  check(await client().from('products').delete().eq('id', id).eq('owner_id', ownerId)
    .select('id').single())
}

export function parsePriceCents(raw: string): number {
  const numeric = Number(raw)
  if (!raw.trim() || !Number.isFinite(numeric) || numeric < 0 || numeric > 2000000 ||
      !/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) {
    throw new Error('Informe um preco valido, com ate duas casas decimais.')
  }
  return Math.round(numeric * 100)
}
