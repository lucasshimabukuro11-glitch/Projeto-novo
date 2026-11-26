# Contas e catálogo do EventScan

O provisionamento cria um administrador principal e três organizadores no Supabase Auth. Cada organizador recebe seis produtos publicados, identificados como **Exemplo**. O cadastro público continua criando participantes.

## Preparar o banco e o site

Confirme que o site e o script usam o mesmo projeto Supabase. Se as migrações até `20261122000001` já estão aplicadas, execute somente as duas abaixo, na ordem. O guia do Supabase contém a sequência completa para instalações novas. [CONFIGURACAO_SUPABASE.md](CONFIGURACAO_SUPABASE.md)

1. Instale a troca obrigatória de senha e o controle administrativo de papéis. [20261126000000_eventscan_privileged_accounts.sql](supabase/migrations/20261126000000_eventscan_privileged_accounts.sql)
2. Atualize as permissões de produtos, instale as categorias e disponibilize a carga inicial. [20261126000001_eventscan_product_management.sql](supabase/migrations/20261126000001_eventscan_product_management.sql)
3. Instale os eventos fictícios e os modelos de certificado. [20261126000002_eventscan_sample_events.sql](supabase/migrations/20261126000002_eventscan_sample_events.sql)
4. Valide as migrações em uma instância de teste antes de integrar o Pull Request. A configuração atual da Vercel publica a `main` automaticamente. A branch de revisão tem o deploy automático desativado.
5. Use `https://eventscan.vercel.app/entrar` depois de publicar a versão revisada. O site precisa incluir a tela **Primeiro acesso** para que as novas contas possam concluir a ativação.

## Provisionar as quatro contas

Use Node.js 22.18 ou superior, as dependências do projeto e o programa `age`. O destinatário cria o par de chaves no próprio computador e guarda a chave privada em local protegido. Compartilhe somente a saída do segundo comando com quem fará o provisionamento. [Instalação do age](https://github.com/FiloSottile/age#installation)

```sh
age-keygen -o /caminho/seguro/eventscan-chave.txt
age-keygen -y /caminho/seguro/eventscan-chave.txt
```

1. Confirme quatro e-mails distintos com o responsável pelas contas. Em produção, use endereços que os responsáveis controlem. Supabase local aceita endereços fictícios sob `example.test`. O Mailpit recebe as mensagens de recuperação nesse ambiente.
2. Crie um JSON fora da pasta do Git, preenchendo os campos abaixo. O arquivo contém os endereços e a chave pública de criptografia. Informe uma pasta existente para `bundlePath`.

   ```json
   {
     "adminEmail": "<e-mail do administrador>",
     "organizerEmails": ["<e-mail do organizador 1>", "<e-mail do organizador 2>", "<e-mail do organizador 3>"],
     "siteUrl": "https://eventscan.vercel.app",
     "recipient": "<chave pública age1… do destinatário>",
     "bundlePath": "/caminho/seguro/eventscan-acessos.age"
   }
   ```
3. No ambiente protegido que executará o script, defina `EVENTSCAN_SUPABASE_URL`, `EVENTSCAN_SUPABASE_PUBLISHABLE_KEY` e `EVENTSCAN_SUPABASE_ADMIN_KEY`. A última recebe a chave **Secret** ou a chave legada `service_role` do mesmo projeto. Use um cofre ou variável secreta do ambiente. Mantenha as configurações da Vercel limitadas às duas variáveis públicas `VITE_*`.
4. Execute da raiz do repositório.

   ```sh
   npm ci
   node scripts/provision-eventscan-accounts.mjs /caminho/seguro/provisionamento.json
   ```
5. Confira o relatório com e-mail, papel, resultado do login no Auth e quantidade de exemplos. Entregue o arquivo `.age` ao destinatário. O arquivo criptografado é criado antes da primeira conta. A saída do comando inclui o caminho e os resultados dos testes de login, com as senhas dentro do arquivo criptografado.
6. O mesmo comando cria também os eventos fictícios, uma vez por organizador. Se as contas e os produtos já existirem no ambiente local, **aplique a terceira migração e execute o script novamente** com a mesma configuração: os eventos serão adicionados sem gerar novas senhas nem duplicar produtos.

Repetir o comando com as mesmas contas preserva as senhas e os produtos existentes. Se uma execução criar apenas parte do lote, repita com o mesmo mapa de e-mails e outro caminho de saída para receber as credenciais das contas restantes. Guarde o primeiro pacote para os acessos já criados. Uma conta comum vinculada a um dos e-mails é sinalizada como conflito.

| Posição | Perfil inicial | Produtos | Eventos fictícios | Eventos com certificado habilitado |
|---|---|---:|---:|---:|
| Administrador principal | Administrador | 0 | 0 | 0 |
| Organizador 1 | Organizador | 6 | 3 | 1 |
| Organizador 2 | Organizador | 6 | 3 | 1 |
| Organizador 3 | Organizador | 6 | 3 | 2 |
| **Total** | | **18** | **9** | **4** |

## Eventos fictícios e certificados

A carga cria 3 eventos **publicados e identificados como “Exemplo”** para cada organizador (9 no total). A propriedade `events.is_demo` é verdadeira e o sistema mantém os eventos vinculados a seus proprietários. As datas começam de 21 a 37 dias após o provisionamento, e os locais são ilustrativos. Cada evento recebe um setor Geral, uma modalidade **Entrada gratuita (Exemplo)** e uma portaria **Entrada principal (Exemplo)** para testar reservas, ingresso com QR Code e check-in.

Os quatro eventos com certificado habilitado são:

- Organizador 1: **Oficina de Desenvolvimento Web (Exemplo)** — 4 horas
- Organizador 2: **Oficina de Producao Cultural (Exemplo)** — 3 horas
- Organizador 3: **Semana Academica de Tecnologia (Exemplo)** — 6 horas; **Seminario de Inovacao na Educacao (Exemplo)** — 4 horas

Estes eventos terão configurações em `certificate_settings` e uma atividade obrigatória em `certificate_activities`. **Não são gerados certificados falsos ou presenças fictícias.** Para emitir um certificado real de teste, um participante deve estar inscrito, realizar um check-in válido, cumprir a atividade obrigatória (presença registrada pelo organizador) e aguardar a conclusão do evento. Certificados de exemplos contêm a indicação de que se trata de demonstração.

O provisionamento é **idempotente**: as contas existentes são mantidas e a carga de eventos não é refeita após a primeira execução. Se um evento de exemplo for removido posteriormente, o script não o recriará automaticamente. Os eventos reais existentes nunca são alterados.

Verificação opcional no Supabase SQL Editor, **somente leitura**:

```sql
select p.display_name, count(e.id) as eventos_ficticios,
       count(cs.event_id) filter (where cs.enabled) as com_certificado
from public.profiles p
join public.events e on e.owner_id = p.id and e.is_demo
left join public.certificate_settings cs on cs.event_id = e.id
where p.role = 'organizer'
group by p.id, p.display_name
order by p.display_name;
```

## Ativar e operar os acessos

1. Abra o arquivo criptografado no seu computador em uma sessão privada. Evite terminais com gravação de sessão. Guarde as novas senhas no seu gerenciador de senhas.

   ```sh
   age --decrypt --identity /caminho/seguro/eventscan-chave.txt /caminho/seguro/eventscan-acessos.age
   ```
2. Entre no EventScan com o e-mail e a senha temporária da conta. Em **Primeiro acesso**, escolha outra senha. O Supabase Auth substitui a credencial e a aplicação exige um novo login. O banco impede que sessões criadas antes da ativação acessem as funções protegidas.
3. Se a troca da senha for concluída e a conexão cair antes de confirmar a ativação, entre com a nova senha e escolha **Concluir primeiro acesso**. Contas com e-mail acessível também podem usar **Esqueci minha senha**.
4. O administrador usa **Usuários** para filtrar organizadores e confirmar alterações no perfil de outras contas. O histórico registra a mudança. **Solicitações de organizador** continua disponível para aprovação e rejeição. Em **Produtos → Categorias**, ele gerencia categorias e produtos. Em **Eventos → Ver ingressos**, consulta os inscritos e horários de entrada.
5. Cada organizador usa **Meus eventos** para gerenciar eventos, ingressos e check-ins e **Meus produtos** para editar o catálogo, com preços em reais, estoque, categoria e imagem. Participantes podem acessar os eventos e produtos publicados.

## Verificar em um ambiente de teste

Use uma instância de teste Supabase local antes de usar os quatro endereços reais. Os testes de provisionamento criam e removem suas próprias contas, usando as quatro posições em uma instância sem lote provisionado.

```sh
npm run build
npm test
npm run test:db
npm run test:provisioning
npm run test:e2e -- --workers=1
```

Para integração, defina `EVENTPASS_TEST_PUBLIC_KEY` com a chave pública local. Para provisionamento e primeiro acesso no navegador, defina também `EVENTSCAN_TEST_ADMIN_KEY` com a chave administrativa **local** e tenha `age` no PATH. Consulte os valores no seu terminal com `npx supabase@3.2.0 status`. Os testes cobrem a entrega criptografada, a rejeição das senhas iniciais, os quatro papéis, edição e persistência de produtos, catálogo, categorias, permissões e reexecução da carga.

No ambiente hospedado, confirme separadamente que o site publicado contém a nova tela e que as quatro contas acessam os painéis corretos depois da ativação. Os resultados do Supabase local e os do site publicado devem ser registrados separadamente.
