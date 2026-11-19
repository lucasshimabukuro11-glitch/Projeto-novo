# EventPass

EventPass é uma aplicação de eventos gratuitos com ingressos digitais, check-in por QR Code e painéis de organização e administração. O catálogo e os ingressos funcionam em telas de celular.

A aplicação usa React, TypeScript, Vite, Tailwind CSS, Supabase, Recharts, `qrcode.react` e ZXing.

## Executar localmente

Use Node.js 22.18 ou superior. A versão 24 é recomendada.

```sh
npm ci
npm run dev
```

Abra `http://localhost:5173`. Com as variáveis do Supabase vazias, a aplicação abre em **Modo demo**, com eventos e perfis fictícios. Os dados ficam no IndexedDB do navegador. Abas do mesmo navegador compartilham os eventos e ingressos, mas podem usar perfis diferentes. Abra cada perfil em uma nova aba pelo endereço da aplicação. Para reiniciar a demonstração, limpe os dados do site em um perfil de navegador reservado para esse fim.

## Configurar o Supabase

### Instância local

Com o Docker em execução, inicie o Supabase pela raiz do repositório. A CLI aplica a migração automaticamente.

```sh
npx supabase@3.2.0 start
cp .env.example .env.local
```

Use a **API URL** e a chave **Publishable** fornecidas pela CLI. Coloque os valores em `.env.local` e reinicie `npm run dev`.

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

O e-mail é confirmado automaticamente apenas na configuração local deste repositório.

### Projeto Supabase existente

1. No **SQL Editor** de um projeto Supabase, execute uma vez toda a migração. Ela instala as tabelas, as políticas RLS, as funções de reserva e validação, o bucket de capas e a publicação dos eventos no Realtime. [Migração de instalação](supabase/migrations/20261118000000_eventpass.sql)
2. Configure `VITE_SUPABASE_URL` com a **Project URL** e `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave **Publishable** ou a chave legada **anon**. As variáveis `VITE_*` são públicas. Mantenha as chaves `service_role` e `sb_secret_*` no ambiente administrativo.
3. Em **Authentication → URL Configuration**, cadastre o endereço da aplicação para receber os redirecionamentos após a confirmação do e-mail. Use confirmação de e-mail para contas reais.

### Contas e permissões

Todo cadastro cria um **participante**. Depois que as contas forem cadastradas e confirmadas, o responsável pelo projeto pode atribuir os papéis no SQL Editor. Troque os endereços do exemplo pelos das contas cadastradas.

```sql
update public.profiles
set role = 'organizer'
where email = 'organizador@seu-dominio.com';

update public.profiles
set role = 'admin'
where email = 'admin@seu-dominio.com';
```

Entre novamente na aplicação após mudar um papel. O organizador publica eventos e autoriza funcionários na seção **Equipe de acesso** de cada evento. O funcionário usa uma conta cadastrada e confirmada. A autorização vale somente para os eventos atribuídos. O administrador consulta contas, organizadores, eventos e indicadores gerais.

Para carregar eventos fictícios no Supabase local, cadastre `organizador@example.test`, `equipe@example.test` e, se quiser apresentar o painel administrativo, `admin@example.test`. Execute [supabase/seed-demo.sql](supabase/seed-demo.sql) no banco local. Com o cliente `psql` instalado, o comando é:

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -f supabase/seed-demo.sql
```

## Roteiro para a apresentação

1. Abra **Entrar → Organizador** em uma aba do modo demo. Crie um evento com data futura e capacidade de uma vaga. Salve o rascunho, publique e autorize `equipe@example.test`. No modo Supabase, entre com a conta que recebeu o papel de organizador.
2. Em outra aba, acesse o catálogo, abra o evento e faça um cadastro de participante. No modo demo, use um endereço fictício terminado em `@example.test`.
3. Reserve a vaga. Abra **Meus ingressos** e mostre o QR Code, a data, o local e o código de entrada manual.
4. Em uma terceira aba, entre como **Equipe de check-in** e selecione o evento. Leia o QR Code pela câmera apontada para outra tela ou cole o código do ingresso em **Entrada manual**. No modo Supabase, faça login com o e-mail da equipe e abra **Check-in**.
5. Valide o mesmo código novamente. O painel exibirá **Ingresso já utilizado**. Na aba do organizador, confira que **Participantes presentes** subiu de valor uma vez e que a entrada apareceu em **Movimentações recentes**.
6. Mostre que a conta do participante não tem acesso ao leitor. Para demonstrar a disputa pela última vaga, publique outro evento com uma vaga. Abra-o em duas abas com contas distintas e tente reservar ao mesmo tempo.
7. Entre como **Administrador** para mostrar a visão geral, os eventos e o filtro de organizadores em **Usuários**.

A câmera exige **HTTPS ou localhost** e permissão do navegador. Para demonstrar com dois aparelhos conectados ao mesmo conjunto de ingressos, use o modo Supabase. É possível testar em Android por USB sem publicar a aplicação. Com a depuração USB habilitada e o `adb` disponível no computador, encaminhe as portas locais:

```sh
adb reverse tcp:5173 tcp:5173
adb reverse tcp:54321 tcp:54321
```

Abra `http://localhost:5173` no Chrome do Android. Use o celular como leitor e o computador para exibir o ingresso. Se o navegador bloquear a câmera, faça a validação manual.

## Testes

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Para executar a integração e o cenário de navegador contra o Supabase local, deixe o Docker e a instância local em execução e forneça a chave pública local:

```sh
export EVENTPASS_TEST_PUBLIC_KEY="$(npx supabase@3.2.0 status -o env | sed -n 's/^PUBLISHABLE_KEY="\(.*\)"$/\1/p')"
npm run test:db
npm run test:e2e
```

A integração cria e remove apenas seus próprios registros fictícios. Ela verifica permissões, resultados de validação, Realtime e duas transações concorrendo pela mesma vaga ou pelo mesmo ingresso. O Playwright usa Chromium e um vídeo simulado com o QR do ingresso para testar o leitor de câmera.

## Regras e configuração para Vercel

- As políticas RLS controlam o acesso por conta, papel e evento. A emissão e o check-in são gravados por funções PostgreSQL. As funções bloqueiam a linha do evento durante a transação, e o registro de entrada tem chave única por ingresso.
- A contagem de ingressos emitidos é histórica. Presença, ausência e ocupação consideram as reservas ativas de eventos publicados. O painel acompanha mudanças pelo Supabase Realtime e atualiza os indicadores periodicamente se a conexão cair.
- A Vercel pode usar o preset **Vite**, `npm run build` e a pasta de saída `dist`. O arquivo `vercel.json` já inclui a regra para links diretos. Configure as duas variáveis públicas de ambiente e o endereço de redirecionamento no Supabase quando houver publicação autorizada.
