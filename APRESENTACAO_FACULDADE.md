# EventScan 2.0 na faculdade

Use os dados marcados como demonstração. Prepare abas separadas para o organizador, o participante e a equipe de check-in.

## Slide 1 — EventScan

- Plataforma de eventos com ingresso digital, check-in e certificado.
- Apresente a página inicial e as opções de perfis fictícios.

## Slide 2 — Problema

- Listas manuais dificultam conferir lotação, presença e permissões por setor.
- Uma única confirmação no banco evita contagem duplicada na portaria.

## Slide 3 — Objetivos

- Unificar inscrição, seleção de assentos e entrada.
- Dar visibilidade ao organizador e comprovante a quem cumpriu os requisitos.

## Slide 4 — Tecnologias

- React, TypeScript, Vite e Tailwind CSS para a interface.
- Supabase Auth, PostgreSQL, RLS e Realtime.
- QR Code com qrcode.react e ZXing, gráficos com Recharts e PDF com jsPDF.

## Slide 5 — Arquitetura

- O navegador pede a reserva ou o check-in por uma função do PostgreSQL.
- A transação confere capacidade, assento, ingresso e autorização.
- Os painéis consultam totais atualizados após os avisos do Realtime.

## Slide 6 — Ingressos VIP e setores

- Abra o Tech Summit Brasil e mostre a diferença entre Auditório e Sala VIP.
- Explique o limite por conta e por modalidade. Todas as reservas nesta versão são gratuitas.

## Slide 7 — Seleção de assentos

- Escolha um assento A2 e confirme que o código do lugar aparece no ingresso.
- Mostre a legenda de acessibilidade e reservas. Explique a regra de unicidade do assento no banco.

## Slide 8 — Monitoramento em tempo real

- Abra o monitor do Tech Summit Brasil.
- Valide o ingresso na portaria autorizada e mostre o novo total de presentes e o gráfico por setor.

## Slide 9 — Certificados e prevenção de fraudes

- Apresente uma negativa por setor incorreto e uma segunda leitura do mesmo código no histórico.
- Abra o certificado da Jornada Universitária de Inovação, baixe o PDF e compare o registro público com o documento.
- Diferencie alertas de comportamento de conclusões de uma investigação.

## Slide 10 — Demonstração e conclusão

1. Na aba do participante, reserve uma cadeira no Tech Summit Brasil.
2. Na aba da equipe, teste a Portaria VIP e depois a Portaria Auditório.
3. Repita a leitura e abra a auditoria no painel do organizador.
4. Baixe o certificado fictício e consulte o código.
5. Conclua mostrando como o banco preserva a lotação e o histórico de entradas.
