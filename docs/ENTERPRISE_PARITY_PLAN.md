# Plano de paridade empresarial — Builder Solutions

**Fonte analisada:** `source-review/` no commit `a4a0e0637ba7d47901b7d2c626ac5e2595f24` (Buildersolutions v9).  
**Estado da plataforma nova em 19/09/2026:** identidade, sessões, organizações, convites, RLS, auditoria, outbox, health e o processo base do worker existem. Ainda não existem modelos nem páginas dos domínios de negócio.

## Regra de migração

O objetivo não é copiar as telas ou as rotas Express. Cada capacidade legada será entregue como um módulo multi-tenant: rota web sob `/app`, API `/api/v1`, autorização por papel e capacidade, RLS em todas as tabelas de tenant, trilha de auditoria, contratos de evento versionados e dados de demonstração. Identificadores públicos nunca serão o identificador interno de um tenant.

O legado tem 38 modelos, 27 arquivos de rota e aproximadamente 276 handlers. Esse número é um inventário, não uma meta de copiar endpoints: handlers duplicados, administrativos ou inseguros serão consolidados.

## Catálogo de páginas e entregas

| Entrega | Páginas empresariais novas | Legado coberto | API, motor e dados de demonstração | Assíncrono obrigatório |
| --- | --- | --- | --- | --- |
| P0 — acesso e espaço de trabalho | `/login`, `/trocar-senha`, `/app`, `/app/configuracoes/organizacao`, `/app/equipe`, `/app/convites` | `auth`, perfil, usuários e parte do admin | identidade, organização, associação, convite, configurações por tenant | auditoria de acesso; nenhum efeito externo |
| P1 — formulários e arquivos | `/app/formularios`, `/novo`, `/:id/configurar`, `/:id/campos`, `/:id/respostas`; público `/f/:publicId` | `Form*`, `FormField*`, permissões, tratativas, upload e `/f/:slug`, `/t/:slug` | versionamento de formulário, validação de respostas, anexos privados, exportação e links públicos revogáveis | indexação/exportação/notificação por outbox |
| P2 — classificação e eventos | `/app/classificacao`, `/app/eventos`, detalhes e fila de tratativas | `Event`, `EventPhoto`, `DropdownList`, `Moderator` | taxonomia, SLA, anexos e workflow de classificação | notificações de SLA e escalonamento idempotentes |
| P3 — gestão de mudanças | `/app/mudancas`, `/app/mudancas/:id` | `ChangeManagement`, `ChangeManagementRisk` | máquina de estados, risco, aprovações e evidências | lembretes, vencimentos e exportação |
| P4 — quadro BASH | `/app/bash`, card, comentários e anexos | `BashCard*`, `BashBoardSetting` | quadro, colunas, ordenação transacional, comentário e arquivo | eventos de cartão e notificações |
| P5 — HHT e taxas | `/app/hht`, dashboard, empresas internas e configurações; público `/hht/reporte` e `/hht/dashboard` | `HHTCompany`, `HHTReport`, `HHTLatePermission`, `HHTSetting`, `HHTReportWindow` | janelas de reporte, cálculo de taxa, regras de atraso e visão por unidade | fechamento de janela, agregações e alertas |
| P6 — painéis, relatórios e TV | `/app/paineis`, editor, `/app/relatorios`, `/app/tv`; público `/p/:publicId`, `/tv/:publicId`, `/tv/playlist/:publicId` | `Dashboard*`, `FormTvDisplay`, `TvPlaylist*`, `BiApiKey` | consultas parametrizadas, blocos de painel, playlist e permissões públicas | publicação estática de painéis, Display e Playlist já entregue com token opaco, expiração, revogação, RLS, auditoria e snapshot permitido; próxima etapa: fontes autorizadas/projeções analíticas |
| P7 — integrações | `/app/integracoes`, conexões e notificações | `Integration`, WhatsApp, webhook, BI, scheduler | cofre de segredos externo, configuração por tenant, tentativas de entrega e assinatura de webhook | dispatcher de outbox, Kafka, retries, DLQ, idempotência e telemetria |
| P8 — operação segura | `/app/configuracoes/listas`, `/app/auditoria`, `/app/operacao` | settings, dropdowns, monitoring, servers | listas, branding, auditoria e saúde agregada | retenção, re-drive controlado e alertas |

Não migrar: `/admin/sql-executor`. Não haverá SQL arbitrário na aplicação. As telas `servers`, chaves de BI e configurações globais serão substituídas por operação restrita de plataforma e segredos fora do banco transacional.

## Ordem de implementação

1. **Contrato e autorização comum:** capability map, manifesto de rotas, paginação/filtros, erros RFC 9457, RLS migration helper e factories de fixture por tenant.
2. **P1 completo:** é a dependência dos anexos, dashboards e boa parte das tratativas. Entregar páginas, API, schema, RLS, arquivo, links públicos e seed em uma única mudança vertical.
3. **P2 e P3:** classificação/eventos e mudanças compartilham anexos, comentários, workflow e SLA.
4. **P4 e P5:** BASH e HHT, com seus motores de cálculo e jobs de fechamento.
5. **P6:** painéis e TV consomem apenas projeções autorizadas; não recebem acesso SQL do navegador.
6. **P7/P8:** integrações só entram depois de dispatcher/outbox, idempotência e observabilidade estarem prontos.

Cada entrega só entra em `main` quando possui migration reversível ou compatível, páginas responsivas, navegação por capacidade, fixture da empresa de demonstração e todos os testes abaixo.

## Garantia de rotas, motores e consumers

Há dois níveis de garantia. O primeiro já é aplicado à superfície atualmente implementada: um manifesto de contrato faz falhar o CI se alguma rota interna registrada sumir ou virar 404. Isso não substitui testes de comportamento.

Para cada módulo novo, o PR deverá adicionar ao manifesto e executar:

1. **Contrato HTTP:** sucesso, validação, autenticação, autorização, paginação, erros e resposta sem campos de outro tenant para cada rota interna.
2. **Integração PostgreSQL/RLS:** criar dados em A e B, executar a rota como A e provar que B é invisível para leitura, escrita, update, delete, busca e exportação.
3. **Motor de domínio:** transições válidas e inválidas, concorrência, idempotência, fuso horário, cálculo e propriedades críticas; exemplos: ordenação do BASH, SLA, taxa HHT e workflow de mudança.
4. **Outbox/Kafka:** publicação transacional, claim/lease, reprocessamento sem duplicar efeito, retry com backoff, DLQ e re-drive. Todo consumer terá uma tabela/registro de mensagem processada por `eventId` e testes com mensagem duplicada, inválida e com falha do provedor.
5. **Fluxo web:** Playwright contra o ambiente de teste para login, troca de senha, navegação por papel e fluxo principal de cada página. Links públicos serão testados com token inválido, expirado, revogado e outro tenant.

O CI passa somente se: o manifesto cobrir 100% das rotas internas registradas, a suíte unitária e de contrato passar, as integrações de PostgreSQL/Redis/Kafka passarem e cada novo handler tiver cenários de permissão e isolamento.

## Empresa de demonstração

O tenant `empresa-teste-builder` contém apenas fundação que já existe: uma organização ativa, owner de demonstração, duas configurações de tenant e evento de auditoria de seed. Dados de formulários, eventos, BASH, HHT e painéis serão incluídos por factories quando seus respectivos schemas forem entregues. Isto impede que a demonstração esconda lacunas com dados sem modelo ou sem RLS.

O rollback operacional é suspensão da organização e da associação, preservando a auditoria; não é exclusão física em produção.
