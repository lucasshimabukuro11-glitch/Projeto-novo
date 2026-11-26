# Catálogo de produtos do EventScan

O catálogo utiliza o mesmo Supabase Auth dos eventos. A instalação inicial está em `20261122000001_eventscan_products.sql`. A gestão de categorias requer as migrações de contas e produtos descritas no guia geral. [Ordem das migrações](CONFIGURACAO_SUPABASE.md#1-instalar-ou-atualizar-o-banco)

## Operar o catálogo

- Em **Produtos**, qualquer pessoa pode consultar os itens publicados e filtrar por categoria.
- Organizadores acessam **Meus produtos** no painel para cadastrar, editar, publicar e desativar seus itens.
- Administradores acessam **Administração → Produtos** para gerenciar itens de todos os organizadores. Em **Categorias**, podem cadastrar, renomear e desativar categorias. A desativação limita novos cadastros nessa categoria e preserva os produtos existentes.
- A carga inicial abastece cada organizador provisionado com seis produtos ilustrativos publicados. A repetição do provisionamento preserva o catálogo. [Provisionar contas e produtos](GUIA_CONTAS_EVENTSCAN.md#provisionar-as-quatro-contas)

## Dados e permissões

`public.products` armazena o dono, categoria, descrição, preço em centavos, estoque, imagem e estado de publicação. `public.product_categories` armazena as categorias. Produtos anteriores à migração podem permanecer sem categoria. A imagem cadastrada pelo organizador usa uma URL HTTPS. Os exemplos usam imagens ilustrativas do próprio aplicativo.

RLS libera a criação de produtos a organizadores para sua própria conta e a edição de todos os itens a administradores. A coluna do proprietário é protegida contra alterações pelo navegador. Organizadores podem excluir seus próprios itens mediante confirmação. Administradores podem desativar a publicação pelo formulário de edição.

Para testar, entre em duas sessões com organizadores distintos, edite e recarregue o produto na sessão do dono e tente abrir o mesmo editor pela outra conta. Confirme também na vitrine do participante que somente os produtos publicados aparecem.
