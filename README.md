# EventScan 2.0

EventScan, anteriormente EventPass, é uma plataforma de eventos gratuitos com ingressos digitais, assentos, check-in por QR Code e certificados de participação. Os painéis de organização e administração incluem monitoramento ao vivo e auditoria de acessos.

A aplicação usa React, TypeScript, Vite, Tailwind CSS, Supabase, Recharts, `qrcode.react`, ZXing e jsPDF.

## Executar localmente

Use Node.js 22.18 ou superior. A versão 24 é recomendada.

```sh
npm ci
npm run dev
```

Abra `http://localhost:5173`. Com as variáveis do Supabase vazias, a aplicação abre em **Modo demo**. Os eventos e as contas fictícias ficam no IndexedDB. Abas do mesmo navegador compartilham os dados da demonstração e podem usar perfis diferentes. Abra cada perfil digitando o endereço em uma nova aba. Se uma aba da versão anterior bloquear a atualização da demonstração, feche-a e recarregue o site.

A demonstração inclui o **Tech Summit Brasil** com modalidades Pista e VIP, mapa do auditório, portarias e histórico fictício. A participante Marina possui um certificado emitido para a **Jornada Universitária de Inovação**. Para usar os mesmos ingressos em aparelhos diferentes, configure o Supabase.

## Supabase

### Instância local

Com Docker em execução, inicie o Supabase pela raiz do repositório.

```sh
npx supabase@3.2.0 start
cp .env.example .env.local
```

Em uma instância local que já está rodando com a versão anterior, aplique somente as migrações pendentes.

```sh
npx supabase@3.2.0 migration up --local
```

Use a **API URL** e a chave **Publishable** fornecidas pela CLI em `.env.local`. Reinicie o Vite depois de editar o arquivo.

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

O banco local confirma e-mails automaticamente na configuração deste repositório.

### Atualizar um projeto Supabase com a versão anterior

1. Confirme que o banco possui o esquema inicial do EventPass e faça backup. Em uma instalação totalmente nova, comece pela [migração inicial](supabase/migrations/20261118000000_eventpass.sql).
2. Aplique os três arquivos seguintes, na ordem abaixo, em um ambiente de teste. Em um projeto administrado pelo SQL Editor, execute cada arquivo inteiro uma vez. Cada arquivo usa uma transação. Quando o histórico é administrado pela CLI, aplique as versões pendentes pelo fluxo normal da equipe.
3. Verifique o mapa, o check-in e o certificado no ambiente de teste antes de aplicar as migrações no projeto que será usado pela Vercel.

| Migração | O que acrescenta | Como validar |
|---|---|---|
| [20261119000000](supabase/migrations/20261119000000_eventscan_ticketing.sql) | Setores, modalidades, portarias, mapas e reserva transacional | Crie setores e uma modalidade. Verifique um ingresso anterior e simule a disputa de um mesmo assento. |
| [20261119000001](supabase/migrations/20261119000001_eventscan_audit.sql) | Auditoria, monitor, alertas e limites | Compare a presença antes e depois de um check-in. Confira a negativa por setor incorreto e o registro histórico das entradas anteriores. |
| [20261119000002](supabase/migrations/20261119000002_eventscan_certificates.sql) | Modelos, atividades, emissão, verificação e revogação | Teste uma conta com requisitos pendentes. Depois de cumprir os requisitos, emita um certificado e consulte o código público. |

Os códigos, IDs e relações dos ingressos anteriores são preservados. Ingressos da primeira versão usam a entrada geral. Se forem adicionadas portarias a um evento com ingressos antigos, configure uma **Portaria Geral**, sem setor, e dê acesso à equipe responsável. O painel de auditoria recebe os check-ins bem-sucedidos da primeira versão como histórico. As negativas anteriores à atualização não foram registradas pela versão original.

Use a **Project URL** e a chave **Publishable** ou **anon** nas duas variáveis `VITE_*`. Essas variáveis são públicas. Mantenha `service_role` e chaves secretas no ambiente administrativo. Em **Authentication → URL Configuration**, configure o endereço autorizado de retorno e mantenha a confirmação de e-mail ativa para contas reais.

### Contas e permissões

Todo cadastro cria um **participante**. O responsável pelo projeto pode atribuir papéis a contas cadastradas e confirmadas. Substitua os e-mails de exemplo pelos endereços das contas correspondentes.

```sql
update public.profiles set role = 'organizer' where email = 'organizador@seu-dominio.com';
update public.profiles set role = 'admin' where email = 'admin@seu-dominio.com';
```

Entre novamente após mudar um papel. O organizador adiciona contas à **Equipe de acesso** do próprio evento. Quando existem portarias, ele também atribui por onde cada funcionário pode operar. Administradores podem consultar os eventos, o monitor, a auditoria e os limites globais.

O [seed de eventos fictícios](supabase/seed-demo.sql) continua disponível para Supabase local. Cadastre e confirme `organizador@example.test`, `equipe@example.test` e, opcionalmente, `admin@example.test` antes de executar o seed. Os cenários ampliados já vêm no modo demo do navegador.

## Como operar e testar os módulos

1. **Setores e modalidades.** Em **Meus eventos → Gerenciar → Configurar evento**, crie os setores e as modalidades gratuitas. A soma das capacidades dos setores deve caber no evento. Defina o prazo, o limite por conta e a cor de cada modalidade.
2. **Mapa de assentos.** Marque um setor como sentado ao criá-lo. Na aba **Assentos**, escolha o número de fileiras e colunas e preencha corredores, lugares acessíveis e indisponíveis. Reserve pelo catálogo. O PostgreSQL serializa concorrentes e mantém uma restrição única para o assento ativo. Cancelar um ingresso sem check-in libera o lugar.
3. **Portarias e monitor.** Crie portarias ligadas aos setores e dê permissão aos funcionários. Faça check-in no setor correto e observe o **Monitoramento** em outra aba. Troque a perspectiva do gráfico entre horário, setor e modalidade. O painel refaz as consultas ao reconectar e atualiza periodicamente os valores.
4. **Certificados.** Em **Configurar evento → Certificados**, cadastre o modelo, o horário de liberação ou a conclusão manual e as atividades exigidas. Registre as presenças das atividades após o check-in. Em **Meus certificados**, emita e baixe o PDF. Use o QR ou cole o código em **Verificar certificado** para comparar os dados oficiais com os do documento. O verificador autentica o registro de emissão. A assinatura institucional opcional é uma imagem, sem assinatura criptográfica do arquivo. As imagens configuradas para o PDF precisam ser acessíveis por URL com CORS.
5. **Auditoria.** Valide um ingresso na portaria correta, tente reutilizá-lo e compare com uma negativa por setor incorreto. Em **Auditoria**, filtre evento, portaria, resultado e intervalo. Confira o funcionário responsável e exporte CSV. Os limites por funcionário e evento geram alertas de comportamento e bloqueiam excesso de leituras por minuto. Tentativas acima do bloqueio são agrupadas por janela e portaria, preservando a contagem.

Ingressos mantêm códigos aleatórios, sem dados pessoais no QR. RLS e funções SQL restringem o acesso por conta, papel, evento e portaria. A consulta pública de certificados exibe dados necessários para comparar o documento e omite e-mail, IDs internos e anexos. A base de demonstração é simulada no navegador. As garantias transacionais e as permissões reais são verificadas no PostgreSQL.

## Apresentação na faculdade

1. Abra **Organizador** e acesse o **Tech Summit Brasil**. Mostre as modalidades, o editor de assentos e as portarias.
2. Em outra aba, use o perfil **Participante** ou cadastre um e-mail fictício terminado em `@example.test`. Escolha Pista, selecione um assento e apresente o ingresso.
3. Na aba **Equipe de check-in**, tente a **Portaria VIP**, mostre a negativa e autorize a entrada na **Portaria Auditório**.
4. Mostre o contador subir uma vez, repita o mesmo código e abra o histórico de auditoria.
5. Acesse **Meus certificados** como Marina, baixe o PDF da Jornada Universitária e verifique o código. Use o roteiro para planejar a demonstração. [Apresentação em 10 slides](APRESENTACAO_FACULDADE.md)

A câmera exige HTTPS ou localhost e permissão do navegador. Para compartilhar a base local com um Android por USB, habilite a depuração USB e encaminhe as portas com o `adb`.

```sh
adb reverse tcp:5173 tcp:5173
adb reverse tcp:54321 tcp:54321
```

Abra `http://localhost:5173` no Chrome do Android e use o Supabase local para alternar entre computador e celular. A entrada manual funciona como alternativa para a apresentação.

## Testes

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Com o Docker e o Supabase local em execução e atualizado, informe a chave pública local para rodar também os testes conectados.

```sh
export EVENTPASS_TEST_PUBLIC_KEY="$(npx supabase@3.2.0 status -o env | sed -n 's/^PUBLISHABLE_KEY="\(.*\)"$/\1/p')"
npm run test:db
npm run test:e2e
```

As suítes de integração criam e removem apenas suas próprias contas e seus registros fictícios no Supabase local. Elas cobrem permissões, capacidade, concorrência por assento e check-in, portarias, alertas, Realtime e emissão e revogação. O Playwright cobre os fluxos anteriores e os novos, incluindo seleção de assento, CSV, PDF, verificação pública e reconexão. O leitor é exercitado no Chromium com vídeo simulado.

## Preparar a atualização na Vercel

O [vercel.json](vercel.json) usa o preset Vite com suporte a links diretos. Quando a atualização for autorizada, use o projeto Vercel existente, que deve apontar para este repositório. Configure Node 24, comando `npm run build` e diretório `dist`. Se o repositório for importado a partir de uma pasta acima do projeto, ajuste o **Root Directory** para a pasta que contém `package.json`.

Aplique as migrações incrementais no Supabase usado pelo ambiente antes de publicar a nova versão. Configure as duas variáveis públicas do Supabase na Vercel e os endereços de redirecionamento em Authentication. Para validar o endereço final, abra uma página de evento, o check-in e `/verificar-certificado` diretamente.

`git.deploymentEnabled.main` desativa o gatilho automático da Vercel para pushes na `main`. Após validar as migrações no Supabase usado pelo site, publique manualmente o commit autorizado no projeto Vercel existente. Para voltar a publicar automaticamente a `main`, retire a regra em uma atualização autorizada.

## Organização dos arquivos

- `src/pages/expansion` reúne configuração de eventos, monitoramento, auditoria e certificados.
- `src/components/expansion` contém editor de assentos, reserva por modalidade, formulários e PDF.
- `src/data/expansion` concentra os contratos de dados e as implementações supabase e demo.
- `supabase/migrations` mantém a instalação inicial e as três alterações incrementais.
- `tests` contém as suítes unitárias, de integração e de navegador.
