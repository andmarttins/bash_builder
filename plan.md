# Plano vivo — conclusão da migração Builder Solutions

## Como usar este arquivo

Este é o registro executivo do trabalho restante. A fonte técnica detalhada
continua sendo `docs/LEGACY_MIGRATION_LEDGER.md`; ADRs e o protocolo de ETL
definem decisões e gates específicos.

**Regra obrigatória:** toda conclusão de frente deste plano deve atualizar este
arquivo no mesmo conjunto de mudanças. A atualização deve registrar: status,
evidência (commit, teste/CI ou documento), data, impacto e próximo item. Um
item só pode ser marcado como concluído quando seus critérios de aceite forem
atendidos; aprovação pendente, deploy, ETL ou piloto não são inferidos.

**Regra de baixa:** os contadores oficiais acompanham as cinco frentes grandes
abaixo, e não microtarefas. Uma frente só recebe baixa quando todos os seus
critérios estão atendidos. Os IDs P0–P4 que aparecem depois são checkpoints e
dependências para executar a frente; eles não entram novamente na contagem.

Toda solicitação que mencionar plano, próximos passos, pendências, progresso,
roadmap, piloto ou corte deve começar pela consulta deste arquivo. O `README.md`
o referencia como a raiz do plano em curso.

| Status | Significado |
| --- | --- |
| `CONCLUÍDO (código)` | Implementado e validado em CI; não significa piloto ou corte aprovado. |
| `PENDENTE` | Pode ser iniciado sem decisão externa adicional. |
| `BLOQUEADO` | Exige decisão, evidência, acesso ou aprovação externa. |
| `NÃO INICIAR` | Não deve ser implementado até constar no escopo aprovado do piloto. |

**Última revisão:** 22/09/2026, commit `d69db82`; CI `35731296112` aprovado.

## Status executivo — frentes grandes

| Situação | Quantidade |
| --- | ---: |
| Frentes concluídas | 0 |
| Frentes pendentes | 1 |
| Frentes bloqueadas | 4 |
| Frentes não concluídas (total) | 5 |

**Entregas técnicas já validadas:** 21 incrementos de código concluídos. Elas
reduzem o escopo de cada frente, mas não encerram a migração sem as aprovações,
dados de piloto e corte exigidos.

## Frentes de execução e baixa

| ID | Frente grande | Status | Critério de baixa | Próximo movimento |
| --- | --- | --- | --- | --- |
| F1 | **Escopo e dados do piloto.** Consolidar carta do piloto, inventário legado, de-para de tenant/identidade/ownership e exceções. | `BLOQUEADO` | Carta aprovada; todas as linhas do piloto decididas; manifesto criptografado com hashes; carga de identidade reconciliada. | Disponibilizar dono, organização piloto e aprovações P0.1–P0.3. |
| F2 | **Decisões funcionais e autorização.** Fechar grants, configurações/catálogos, deltas de formulários, BASH, HHT e reconciliação dos domínios aprovados. | `BLOQUEADO` | ADRs e aceites aprovados; somente decisões aprovadas implementadas, auditadas, isoladas por tenant e reconciliadas. | Aprovar P1 e P2, que definem o escopo de implementação. |
| F3 | **Integrações e operação.** Homologar webhook/adapters exigidos e observabilidade de produção, com segredos protegidos e operação exercitada. | `BLOQUEADO` | Integrações do piloto homologadas; retry/DLQ/rotação/re-drive testados; SLOs, alertas, retenção e plantão aprovados. | Definir adapters, destino homologado, responsável e política operacional. |
| F4 | **Qualidade integral do escopo aprovado.** Consolidar cobertura E2E/RLS dos fluxos escolhidos e completar a revisão crítica independente de todo o escopo do piloto. | `PENDENTE` | Fluxo principal e negativos públicos/entre tenants de cada capacidade do piloto passam em CI; revisão independente final >=9/10, com achados corrigidos. | Mapear, no escopo aprovado, qualquer capacidade ainda sem fluxo E2E e executá-la como um único pacote de qualidade. |
| F5 | **Migração, corte e retirada do legado.** Executar dual-run, carga reexecutável, reconciliação, delta final, rollback, aceite e desativação controlada. | `BLOQUEADO` | Gates F1–F4 aprovados; RPO/RTO e rollback ensaiados; aceite, retenção e data de retirada registrados. | Liberar F1–F4; não iniciar corte ou retirada antes disso. |

## Revisão do que foi entregue

| Área | Estado revisado | Evidência principal | Pendência para release/migração |
| --- | --- | --- | --- |
| Governança do baseline | `CONCLUÍDO (código)` | manifesto imutável, gate Marco 0 e CI | carta de piloto real, donos e evidências externas |
| Identidade, sessões e RBAC por papel | `CONCLUÍDO (código)` | Identity, memberships, capabilities, RLS e testes | mapeamento/reconciliação de identidades do piloto |
| Grupos tenant-scoped | `CONCLUÍDO (código)` | commit `2ba400f` | não concedem permissões; grants aguardam ADR |
| Arquivos privados | `CONCLUÍDO (código)` | intent, scan, checksum, cleanup restrito ao worker | provisionar storage/scanner e ensaiar restore no piloto |
| Formulários, submissões e publicação | `CONCLUÍDO (código)` | versões, snapshots, links opacos, expiração/revogação e CSV limitado | decidir deltas de slug, versões nomeadas, contadores, grants e exportação de volume |
| Eventos, mudanças e BASH | `CONCLUÍDO (código)` | workflows, auditoria, outbox, anexos e RLS | reconciliação de dados; exportação/configuração BASH somente se aprovada |
| HHT | `CONCLUÍDO (código)` | janelas, publicação, metas e exceções de atraso (`5bba6b7`, `6c5e3f3`) | regras/configurações aprovadas e reconciliação dos totais do piloto |
| Catálogos | `CONCLUÍDO (código)` | classificação de eventos tipada (`0399493`) | definir outros catálogos/configurações aprovados |
| Webhook | `CONCLUÍDO (código)` | fila durável, assinatura, egress restrito, retry/DLQ e re-drive | provisionar segredo e testar destino do piloto |
| Integrações sem adapter | `CONCLUÍDO (proteção)` | `e0525a1` impede ativação de tipos não implementados | decidir quais adapters são necessários; não ativar por inventário |
| Analytics, painéis e TV | `CONCLUÍDO (código)` | fontes allowlisted, snapshots públicos e revogação | relatórios, fontes ou widgets extras somente se aprovados |
| Operação | `CONCLUÍDO (código/documentação)` | health, métricas internas, DLQ, runbook e ADR de monitoramento | SLO, retenção, alertas, plantão e plataforma de observabilidade |

## Checkpoints e dependências das frentes

Esta seção preserva a rastreabilidade técnica do ledger. Seus itens não são
microtarefas a executar isoladamente nem alteram os contadores executivos: são
evidências e pré-requisitos da frente correspondente.

### P0 — liberar um escopo de piloto

| ID | Item | Status | Critério de aceite |
| --- | --- | --- | --- |
| P0.1 | Nomear dono, organização piloto, capacidades, volumes, retenção, RPO/RTO, canal de incidente e janela de freeze/corte. | `BLOQUEADO` | Carta em `docs/migration/pilots/` aprovada, com referências externas imutáveis e `npm run migration:gate-marco0` aprovado em checkout autorizado. |
| P0.2 | Atualizar o ledger do escopo piloto: eliminar `TBD` para cada ativo, com decisão migrar/substituir/descontinuar. | `BLOQUEADO` | Decisão aprovada, dono e evidência para cada linha do piloto. |
| P0.3 | Definir de-para de tenant, identidade, ownership, usuários compartilhados e exceções. | `BLOQUEADO` | Manifesto externo criptografado, hashes/referências na carta e carga de identidade isolada reconciliada. |

### P1 — decisões que definem o modelo de autorização e configuração

| ID | Item | Status | Critério de aceite |
| --- | --- | --- | --- |
| P1.1 | Aprovar `ResourceGrant`: sujeitos, precedência sobre RBAC, expiração, revogação, delegação e matriz endpoint × grant. | `BLOQUEADO` | ADR `docs/ADR_RESOURCE_GRANTS_PENDING.md` aprovada. |
| P1.2 | Implementar grants somente se P1.1 os mantiver necessários no piloto. | `NÃO INICIAR` | Migration, RLS/API enforcement, auditoria e testes A→B→A. |
| P1.3 | Aprovar chaves tipadas por tenant e catálogos além de `event_classification`. | `BLOQUEADO` | ADR `docs/ADR_TENANT_SETTINGS_PENDING.md` aprovada, schemas e consumidores definidos. |
| P1.4 | Implementar somente as chaves e catálogos aprovados. | `NÃO INICIAR` | Schema tipado, versionamento, RLS, auditoria/outbox e testes. |

### P2 — fechar deltas funcionais por domínio

| ID | Item | Status | Critério de aceite |
| --- | --- | --- | --- |
| P2.1 | Decidir histórico de URLs, versões nomeadas, contadores e exportação assíncrona de formulários. | `BLOQUEADO` | ADR `docs/ADR_FORM_DELTAS_PENDING.md` aprovada por capacidade. |
| P2.2 | Implementar somente os deltas de formulário aprovados e grants quando aplicáveis. | `NÃO INICIAR` | Contrato, RLS, concorrência, auditoria/outbox, testes e reconciliação de snapshots. |
| P2.3 | Confirmar necessidade de exportação de mudanças e configurações locais do BASH. | `BLOQUEADO` | Aceite do dono; configuração BASH segue `docs/ADR_BASH_CONFIGURATION_PENDING.md`. |
| P2.4 | Reconciliar eventos, mudanças, BASH e anexos do tenant piloto. | `BLOQUEADO` | Contagens, relações, checksums e exceções assinadas conforme `docs/ETL_MIGRATION_PROTOCOL.md`. |
| P2.5 | Aprovar a regra operacional HHT restante e reconciliar empresa/período. | `BLOQUEADO` | Tolerância declarada, totais reconciliados e exceções justificadas. |

### P3 — integrações e operação

| ID | Item | Status | Critério de aceite |
| --- | --- | --- | --- |
| P3.1 | Reprovisionar e validar o webhook exigido pelo piloto, sem migrar segredo. | `BLOQUEADO` | Segredo protegido na API/worker, destino homologado, teste de duplicidade/timeout/DLQ e runbook executado. |
| P3.2 | Definir quais adapters adicionais são necessários: WhatsApp, e-mail, Smartsheet, IA e/ou BI. | `BLOQUEADO` | Cada adapter possui dono, contrato, classificação de dados e aceite do piloto. |
| P3.3 | Implementar cada adapter aprovado de forma incremental. | `NÃO INICIAR` | Referência externa de segredo, idempotência, timeout, retry, DLQ, métricas, rotação e re-drive testados. |
| P3.4 | Aprovar observabilidade de produção: plataforma, SLOs, retenção, alerta, escala e capacidade. | `BLOQUEADO` | ADR `docs/ADR_OPERATIONAL_MONITORING_PENDING.md` aprovada e alertas exercitados. |

### P4 — analytics, qualidade e corte

| ID | Item | Status | Critério de aceite |
| --- | --- | --- | --- |
| P4.1 | Decidir relatórios, fontes analíticas, widgets ou BI adicionais. | `BLOQUEADO` | Fonte allowlisted/contrato tipado ou aceite de descontinuação. |
| P4.2 | Ampliar cobertura Playwright para o caminho principal de cada capacidade escolhida e links públicos inválidos/expirados/revogados. | `PENDENTE` | Fluxos do escopo piloto passam em CI, incluindo isolamento entre tenants. |
| P4.2a | Cobrir o ciclo de formulários públicos no Playwright: criação com campo inicial, publicação, submissão anônima, links inválido/revogado/expirado e isolamento entre tenants. | `CONCLUÍDO (código)` | CI `35672957600` passou com E2E isolado, integração, unitários e build; revisão independente final 9/10. |
| P4.2b | Cobrir o ciclo de links públicos de Painéis: criação, publicação, acesso público, token inválido, expiração e revogação; provar também o isolamento autenticado de Painéis entre tenants. | `CONCLUÍDO (código)` | CI `35675306989` passou com Playwright, integração RLS, lint, tipos, unitários e build; revisão independente: 2/10 inicial, 9/10 final. |
| P4.2c | Cobrir o ciclo público de Tela TV: Painel publicado, criação da tela, publicação, acesso anônimo, token inválido, revogação e expiração herdada; provar o isolamento autenticado de telas entre tenants. | `CONCLUÍDO (código)` | CI `35715637710` passou com duas suítes Playwright isoladas, integração RLS, lint, tipos, unitários e build; revisão independente: 4/10 inicial, 9/10 final. |
| P4.2d | Cobrir o ciclo público de Playlist TV: Painel e Tela publicados, criação da playlist, acesso anônimo, token inválido, revogação e expiração herdada; provar o isolamento autenticado de playlists entre tenants. | `CONCLUÍDO (código)` | CI `35717066775` passou com três suítes Playwright isoladas, integração RLS, lint, tipos, unitários e build; revisão independente: 7/10 inicial, 9/10 final. |
| P4.2e | Cobrir o ciclo público do consolidado HHT: empresa, janela, reporte, bloqueio, encerramento, publicação, acesso anônimo, token inválido, revogação e expiração; provar também o isolamento autenticado de publicações HHT entre tenants. | `CONCLUÍDO (código)` | CI `35718935350` passou com quatro suítes Playwright isoladas, integração RLS, lint, tipos, unitários e build; revisão independente: 4/10 inicial, 9/10 final. |
| P4.2f | Cobrir os fluxos privados centrais de Eventos, Mudanças e BASH: ação e ciclo de evento, workflow de Mudança com bloqueio de risco, criação/comentário/movimentação de cartão e negação de mutações entre tenants. | `CONCLUÍDO (código)` | CI `35722752525` passou com Playwright, integração RLS, lint, tipos, 310 unitários e build; revisão independente: 6/10 inicial, 9/10 final. |
| P4.2g | Cobrir o inventário seguro de Integrações/Webhook: cadastro desativado, verificação de configuração sem segredo, bloqueio de ativação, ausência de vazamento do valor de runtime e negação de leitura/mutação entre tenants. | `CONCLUÍDO (código)` | CI `35724770312` passou com Playwright, integração RLS, lint, tipos, unitários e build; revisão independente: 8/10 inicial, 9/10 final. |
| P4.2h | Cobrir Arquivos privados com dependências efêmeras reais: upload no navegador, checksum, ClamAV, MinIO, download autenticado, cancelamento, rejeição de malware e isolamento entre tenants. | `CONCLUÍDO (código)` | CI `35729188873` passou com MinIO, ClamAV, Playwright, integração, lint, tipos, 310 unitários e build; revisão independente: 7,5/10 inicial, 9/10 final. |
| P4.2i | Cobrir Grupos e classificações tipadas de eventos: CRUD/membros, persistência após recarga, desativação, bloqueio de catálogo inativo e isolamento de leitura/mutação entre tenants. | `CONCLUÍDO (código)` | CI `35731296112` passou com Playwright, integração RLS, lint, tipos, unitários e build; revisão independente: 6,5/10 inicial, 9/10 final. |
| P4.3 | Executar revisão crítica independente por incremento e corrigir até nota >= 9/10, sem ajuste artificial. | `PENDENTE` | Registro da nota, achados, correções e reavaliação anexado ao item entregue. |
| P4.4 | Produzir runbook de dual-run e corte; executar carga reexecutável, reconciliação, delta final e rollback ensaiado. | `BLOQUEADO` | Gates P0–P3 aprovados, smoke tests e RPO/RTO comprovados. |
| P4.5 | Desativar capacidades legadas após aceite e retenção. | `NÃO INICIAR` | Aceite formal, data de retirada, evidências arquivadas e plano de reversão/compensação. |

## Próxima ação objetiva

O desbloqueio externo prioritário é **F1/P0.1**: criar e aprovar a carta de
piloto. Em paralelo, a frente ativa é **F4**: executar uma avaliação única da
cobertura E2E/RLS de todas as capacidades já implementadas, agrupar os gaps em
um pacote de qualidade e somente então dar baixa na frente quando o escopo do
piloto estiver totalmente coberto.

## Histórico de atualizações

| Data | Item atualizado | Alteração | Evidência |
| --- | --- | --- | --- |
| 21/09/2026 | revisão inicial | plano criado a partir do ledger, ADRs, protocolo de ETL e estado do commit atual | `e0525a1`; CI do `main` aprovado |
| 21/09/2026 | convenção de planejamento | `README.md` passou a apontar `plan.md` como raiz obrigatória para consulta e atualização | alteração conjunta em `README.md` e `plan.md` |
| 21/09/2026 | P4.2a e P4.3 | cobertura E2E de ciclo público de formulários e correções reveladas pelo CI: seletor acessível, criação aninhada de campos, preservação de formulários em handlers assíncronos e isolamento por tenant. Avaliação independente: 3/10 inicial, 9/10 final. | commits `df35881`–`0628df3`; CI `35672957600` aprovado |
| 21/09/2026 | P4.2b e P4.3 | cobertura E2E do ciclo público de Painéis e isolamento autenticado em RLS. Corrigidos o uso assíncrono de `currentTarget`, permissões restritas do outbox para defaults materializados pelo Prisma e a redundância de troca de tenant que fazia o E2E atingir o rate limit. Avaliação independente: 2/10 inicial, 9/10 final. | commits `adc19be`–`3c61434`; CI `35675306989` aprovado |
| 22/09/2026 | P4.2c e P4.3 | cobertura E2E da Tela TV: criação a partir de Painel publicado, acesso público, token inválido, revogação e expiração herdada; isolamento autenticado de telas provado no RLS. As suítes browser foram separadas para reiniciar somente o rate limiter em memória, sem reduzir a proteção de produção. Corrigidos o rótulo real da navegação e o timeout do cenário de expiração. Avaliação independente: 4/10 inicial, 9/10 final. | commits `979f568`–`45af03e`; CI `35715637710` aprovado |
| 22/09/2026 | P4.2d e P4.3 | cobertura E2E da Playlist TV: criação a partir de Tela publicada, acesso público, token inválido, revogação e expiração herdada; isolamento autenticado de playlists provado no RLS. Corrigidos o prazo de expiração insuficiente e o seletor dependente da ordem de formulários. Avaliação independente: 7/10 inicial, 9/10 final. | commit `11466f9`; CI `35717066775` aprovado |
| 22/09/2026 | P4.2e e P4.3 | cobertura E2E do consolidado público HHT: empresa, janela, reporte, bloqueio, encerramento, publicação, acesso anônimo, token inválido, revogação e expiração; isolamento autenticado de publicações provado no RLS. Corrigida a ordem temporal do cenário: a janela permanece aberta até o reporte estar bloqueado, e só então é encerrada/publicada. A tela pública passou a expor apenas o snapshot agregado por URL opaca. Avaliação independente: 4/10 inicial, 9/10 final. | commit `5f27cf2`; CI `35718935350` aprovado |
| 22/09/2026 | P4.2f e P4.3 | cobertura E2E privada de Eventos, Mudanças e BASH, com tentativas de mutação entre tenants. O ciclo crítico encontrou e corrigiu: serialização de `datetime-local` com segundos zero, criação aninhada das etapas Prisma, seletor Playwright do workflow de Mudança e serialização de campos opcionais vazios do cartão BASH. Avaliação independente: 6/10 inicial, 9/10 final. | commits `42b227d`–`3eeec1c`; CI `35722752525` aprovado |
| 22/09/2026 | P4.2g e P4.3 | cobertura E2E do inventário Webhook: configuração sem referência, estado `MISSING_SECRET_REFERENCE`, bloqueio de ativação, estado `READY` com sentinela exclusiva de E2E e ausência desse valor na resposta, DOM e auditoria; isolamento por listagem, alteração e verificação entre tenants. Avaliação independente: 8/10 inicial, 9/10 final. | commits `2dce189`–`dde0e72`; CI `35724770312` aprovado |
| 22/09/2026 | P4.2h e P4.3 | cobertura E2E de Arquivos privados com MinIO e ClamAV efêmeros: upload pela UI, checksum, persistência/validação S3, download autenticado, cancelamento e isolamento por tenant. O ciclo crítico encontrou e corrigiu acesso anônimo ao objeto real, montagem segura do EICAR em DOCX/ZIP, imagem MinIO no Quay, seletor de título e retorno à aba após reload. Avaliação independente: 7,5/10 inicial, 9/10 final. | commits `d1160fe`–`e08da67`; CI `35729188873` aprovado |
| 22/09/2026 | P4.2i e P4.3 | cobertura E2E de Grupos e classificações tipadas de Eventos: criação, associação, edição, persistência após recarga, exclusão, desativação, bloqueio de classificação inativa e negativas cross-tenant. O ciclo crítico encontrou o join indevido de `identity_users` na listagem de grupos, incompatível com a revogação intencional de leitura do papel runtime; a resposta passou a projetar somente IDs de associação, e a UI continua usando a rota já autorizada de membros para dados de exibição. Avaliação independente: 6,5/10 inicial, 9/10 final. | commits `0c352c2`, `d69db82`; CI `35731296112` aprovado |
| 22/09/2026 | modelo de baixa | replanejamento para cinco frentes grandes. Os contadores passaram a refletir frentes encerráveis, enquanto P0–P4 permanecem como checkpoints rastreáveis. Nenhuma pendência foi baixada artificialmente. | revisão do plano |
