# Cadastro de produtos no EventScan

Este módulo utiliza o **login já existente do Supabase Auth**. Não há segundo cadastro de usuários.

## Instalação
1. Conclua as migrações anteriores da branch `eventscan/supabase-integration`.
2. No SQL Editor do Supabase **do mesmo projeto conectado à Vercel**, execute integralmente `supabase/migrations/20261122000001_eventscan_products.sql` uma única vez, após backup.
3. Em Vercel, configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no ambiente de produção. O projeto utiliza **Vite**, não Next.js.
4. Publique a branch depois de revisar o PR e a configuração de `vercel.json`. No momento, o deploy automático está desativado para `main` e a branch anterior de integração.
5. Valide em dois navegadores: criar duas contas, cadastrar produto com uma, verificar catálogo público, confirmar que a outra conta não pode editar/excluir o produto. Verifique também preços e estoque após recarregar a página.

## Páginas
- `/produtos`: catálogo público, somente produtos publicados, listagem limitada aos 100 mais recentes.
- `/produtos/meus`: meus produtos, exige login.
- `/produtos/novo`: novo produto, exige login.
- `/produtos/meus/:id/editar`: edição de produto próprio, exige login.

## Dados e segurança
- Tabela `public.products`: dono, nome, descrição, preço em centavos (BRL), estoque, URL HTTPS da imagem, publicado/rascunho e datas.
- RLS permite leitura pública apenas de produtos publicados e leitura de todos os registros pelo próprio dono. Criar, alterar e excluir dependem do usuário autenticado ser o proprietário.
- O preço é armazenado como centavos inteiros para evitar erro de arredondamento de valores monetários.
- V1 usa **URL HTTPS** de imagem e não inclui upload de arquivo, carrinho, pagamento ou pedidos. Isso evita criar fluxo de vendas não solicitado.
- Para tornar a listagem privada em vez de pública, remova a condição `active` da política de leitura e a rota pública; atualmente os produtos publicados são visíveis a todos.

## Verificações
O código foi escrito e enviado ao GitHub, mas build e testes ainda precisam ser executados em um ambiente com dependências instaladas. Não considerar o aplicativo publicado até concluir SQL, configuração da Vercel, revisão e deploy.
