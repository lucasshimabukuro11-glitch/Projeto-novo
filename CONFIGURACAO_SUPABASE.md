# Configurar o Supabase do EventScan

Use o projeto Supabase que já contém os dados do EventScan. Se for a primeira instalação, crie um projeto em **New project** no painel do Supabase e guarde a senha do PostgreSQL em local seguro. Use o seed de demonstração somente em instâncias de teste.

## 1. Instalar ou atualizar o banco

Faça um backup antes de atualizar um projeto com dados. Os arquivos SQL estão na pasta [`supabase/migrations`](supabase/migrations).

1. Abra **SQL Editor → New query** no projeto Supabase escolhido.
2. Em um banco vazio, copie e execute o primeiro arquivo inteiro. Repita com cada arquivo seguinte, na ordem da tabela.
3. Em um banco com EventScan, confira as versões já aplicadas e execute apenas as pendentes, mantendo a ordem. Se a equipe controla as migrações pela CLI, use esse mesmo fluxo para manter o histórico de versões.
4. Se não souber como o banco foi instalado, confira o histórico das migrações ou verifique no **Table Editor** a presença das tabelas da coluna de referência. A presença de uma tabela ajuda a identificar a versão. Confirme o histórico da instalação inteira antes de executar o arquivo seguinte.

| Versão | Estrutura | Referência no Table Editor |
|---|---|---|
| [20261118000000](supabase/migrations/20261118000000_eventpass.sql) | Perfis, eventos, ingressos, check-ins, equipe e Storage | `events` |
| [20261119000000](supabase/migrations/20261119000000_eventscan_ticketing.sql) | Modalidades, setores, assentos, mapas, portarias e disponibilidade | `event_seats` |
| [20261119000001](supabase/migrations/20261119000001_eventscan_audit.sql) | Tentativas de leitura, monitoramento e alertas de auditoria | `validation_attempts` |
| [20261119000002](supabase/migrations/20261119000002_eventscan_certificates.sql) | Modelos, atividades, emissão e verificação de certificados | `certificates` |
| [20261122000000](supabase/migrations/20261122000000_eventscan_organizers_and_event_edit.sql) | Solicitações de organizador, edição com controle de versão e elegibilidade dos ingressos após promoção | `organizer_applications` |
| [20261122000001](supabase/migrations/20261122000001_eventscan_products.sql) | Catálogo de produtos | `products` |
| [20261126000000](supabase/migrations/20261126000000_eventscan_privileged_accounts.sql) | Ativação, permissões de contas e consulta administrativa de ingressos | `eventpass_private.provisioned_accounts` |
| [20261126000001](supabase/migrations/20261126000001_eventscan_product_management.sql) | Categorias, permissões de produtos e carga inicial | `product_categories` |

A migração de edição de eventos acrescenta `events.details_revision` e mantém os identificadores, códigos de ingresso e check-ins existentes. O SQL também instala as políticas de acesso e publica `events` e `event_activity` no Supabase Realtime. Para diagnosticar atualizações ao vivo, confira se as duas tabelas fazem parte da publicação `supabase_realtime`.

## 2. Configurar cadastro e recuperação

1. Em **Authentication → Sign In / Providers → Email**, habilite cadastro por e-mail e mantenha a confirmação de e-mail ativa para produção.
2. Em **Authentication → URL Configuration**, informe `https://eventscan.vercel.app` em **Site URL**.
3. Em **Redirect URLs**, acrescente os endereços abaixo e salve. Se usar outro domínio, adicione os endereços exatos desse ambiente também.

   ```text
   https://eventscan.vercel.app/
   https://eventscan.vercel.app/redefinir-senha
   ```

4. Configure um provedor SMTP em **Authentication → Email → SMTP Settings** para enviar confirmação e recuperação aos usuários do site. Use o link `{{ .ConfirmationURL }}` nos modelos de e-mail de confirmação e recuperação. [Configuração de SMTP no Supabase](https://supabase.com/docs/guides/auth/auth-smtp)

O Auth gerencia as credenciais e a sessão no navegador. As reservas, os perfis e os eventos ficam no PostgreSQL e podem ser consultados ao entrar na mesma conta em outro aparelho.

## 3. Conectar o projeto Vercel existente

1. No Supabase, abra **Connect** e copie a **Project URL** e a chave **Publishable** do mesmo projeto. A chave também fica em **Project Settings → API Keys**. Em instâncias anteriores, a chave pública legada `anon` é aceita.
2. Na Vercel, abra o projeto que atende `eventscan.vercel.app` e vá a **Settings → Environment Variables**. Adicione as duas variáveis ao ambiente **Production**.

   | Nome | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | **Project URL**, por exemplo `https://seu-projeto.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave **Publishable** ou chave legada `anon` |

   Mantenha a senha do PostgreSQL, a chave `service_role` e chaves `sb_secret_…` fora das variáveis `VITE_*` e do Git. O EventScan valida essas variáveis durante a compilação e inclui somente a configuração pública aceita no código entregue ao navegador.

3. Confira **Settings → Build and Deployment**. Use o preset **Vite**, a pasta do `package.json` como **Root Directory**, Node.js 24, `npm run build` como comando e `dist` como saída. O `vercel.json` habilita rotas diretas ao recarregar a página.
4. Depois de aplicar as migrações e salvar as variáveis, use o fluxo de publicação autorizado do projeto existente. As variáveis do Vite são lidas durante a compilação. Um build anterior mantém os valores que tinha na data em que foi criado.
5. Abra a vitrine, recarregue `/recuperar-senha` e `/verificar-certificado`, cadastre uma conta de teste e confirme o e-mail. Valide a recuperação e entre com a mesma conta em outro dispositivo.

Uma configuração ausente ou inválida apresenta uma mensagem de configuração. Se o Supabase estiver inacessível, as telas mostram o erro de conexão e continuam usando a configuração real. O Modo Demo é disponibilizado pelo servidor de desenvolvimento do Vite quando as duas variáveis estão vazias.

## 4. Provisionar o administrador e os organizadores

Todo cadastro público cria um participante. Para obter o administrador principal e três organizadores com troca obrigatória de senha, siga o procedimento protegido. [GUIA_CONTAS_EVENTSCAN.md](GUIA_CONTAS_EVENTSCAN.md)

Participantes podem usar **Minha conta → Perfil de organizador**. Um administrador aprova ou rejeita solicitações em **Solicitações de organizador**. A aprovação libera **Meus eventos** e preserva ingressos e certificados da conta.

## 5. Estrutura e permissões

| Área | Onde fica |
|---|---|
| Contas e acesso | `auth.users`, `profiles`, `organizer_applications`, `eventpass_private.provisioned_accounts` e histórico de papéis |
| Catálogo | `products` e `product_categories` |
| Eventos e disponibilidade | `events`, `event_sectors`, `ticket_types`, `seat_maps`, `event_seats`, `tickets` |
| Equipe e portarias | `event_staff`, `gate_staff`, `event_gates` |
| Entradas e auditoria | `check_ins`, `validation_attempts`, `event_activity`, `security_limits` |
| Certificados e critérios | `certificates`, `certificate_settings`, `certificate_activities`, `certificate_activity_presence` |
| Capas | Bucket `event-covers` no Storage, com leitura pública das imagens e gravação na pasta do próprio organizador |

RLS e permissões de execução delimitam o que cada usuário pode consultar e alterar. As operações de reserva e check-in mantêm travas e restrições de integridade no PostgreSQL. O painel lê dados autorizados ao receber atualizações do Realtime e refaz consultas após reconexão. A página pública verifica certificados pelo código de autenticidade e omite e-mails e identificadores internos.

## Testar no computador

Use o Mailpit em `http://127.0.0.1:54324` para abrir os e-mails de recuperação do Supabase local. Para apresentações, use o modo demo do navegador ou uma instância separada com dados fictícios. [Comandos de build e testes](README.md#testes)
