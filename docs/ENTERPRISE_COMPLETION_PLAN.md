# Plano de conclusão da migração do Builder Solutions

## Objetivo e fonte de verdade

Concluir a substituição controlada do Buildersolutions v9, cujo baseline é o
commit `a4a0e0637ba7d47901b7d2c626ac5e2595f24` de
`andmarttins/builder-solutions-9`. Paridade não significa copiar tabelas,
rotas ou telas literalmente: cada capacidade aprovada deve ter equivalente
multi-tenant, RLS, autorização, auditoria, testes e dados reconciliáveis.

Este plano substitui a sequência histórica de implementação. O
`LEGACY_MIGRATION_LEDGER.md` permanece o registro de decisão por ativo; ele
deve ser atualizado ao fim de cada marco abaixo.

## Estado atual comprovado

Os documentos `ENTERPRISE_PARITY_PLAN.md` e `LEGACY_COMPARISON.md` registram
o diagnóstico de 19/09/2026, antes da entrega dos domínios atuais; não devem
ser usados como estado executável. Hoje existem identidade/capabilities por
papel, formulários e arquivos, eventos, mudanças, BASH, HHT, dashboards/TV,
outbox/Kafka, operação e webhook. As evidências são o schema Prisma, os
controllers/serviços de `apps/api`, os dispatchers em `apps/worker` e o CI.

O de-para abaixo lista somente os deltas que ainda exigem decisão ou entrega:

| Legado | Estado novo | Delta a decidir/entregar |
| --- | --- | --- |
| grupos, moderadores e permissões por recurso | memberships e capabilities por papel | grupos e `ResourceGrant`, se aprovados no piloto |
| permissões/histórico de formulário | formulário versionado, snapshot, tratamento e CSV limitado | grants, histórico/contador e export job somente se necessários |
| configuração BASH e HHT | cartões/workflow e HHT com janelas/publicação | configurações de board, atraso e HHT aprovadas |
| integrações de fornecedor | webhook seguro, referências externas de segredo e fila | adapters aprovados: WhatsApp, Smartsheet, e-mail, IA, BI; storage é pré-requisito separado |
| dashboards, TV e BI | fontes allowlisted, publicação estática, TV/playlist | relatórios/widget adicionais e BI somente se aprovados |
| monitoramento de servidores | health, métricas e runbooks de aplicação | substituto restrito, alertas, retenção e SLOs |

## Princípios de execução

1. Nenhum dado legado entra na nova plataforma sem dono de negócio, tenant de
   destino, retenção e decisão de migração aprovados.
2. Cada incremento é vertical: contrato HTTP, interface, migration compatível,
   RLS A/B, capability, auditoria/outbox e teste de browser quando aplicável.
3. Segredos não são copiados para banco, payload, log ou ETL. Integrações são
   recriadas com referência de segredo no ambiente novo.
4. O legado continua como fonte de verdade até piloto aceito, reconciliação
   aprovada, freeze e rollback ensaiado.
5. Nenhuma avaliação de qualidade é presumida: cada marco passa por revisão
   independente e só fecha com nota >= 9/10 justificada por evidências.

## Marco 0 — descoberta, identidade e baseline operacional

### Entregas

- Atualizar cada linha do ledger com dono, evidência de uso, retenção,
  classificação de dados e uma decisão: **migrar**, **substituir** ou
  **descontinuar**.
- Criar o manifesto origem -> organização -> destino, incluindo usuários
  compartilhados, registros órfãos, arquivos sem dono e dados sem tenant.
- Criar uma carta de piloto: tenant, capacidades incluídas, dependências
  transitivas (identidade, arquivo, links públicos, integrações e jobs), dono,
  prazo, volumes, retenção e evidência. Um ativo necessário não pode ser
  removido do escopo sem decisão de descontinuação assinada.
- Definir tenant piloto, período de freeze, janela de corte, responsáveis,
  RPO/RTO, canal de incidentes e critérios de retorno ao legado.
- Registrar ADRs para autorização por recurso, retenção de arquivo,
  publicação pública, exportações, integrações, dual-run e rollback.
- Definir o mapeamento de identidade: normalização/colisão de e-mail,
  usuários ativos/inativos ou compartilhados, ownership inicial, memberships,
  convites pendentes e a política para hashes/sessões não portáveis. Sessões
  legadas são revogadas; usuários recebem convite ou reset obrigatório antes
  do primeiro login no novo ambiente.
- Executar uma carga de identidade em ambiente isolado e provar login, troca
  obrigatória de senha, seleção de organização e reconciliação de owners e
  memberships.
- Atualizar os documentos históricos que ainda descrevem a plataforma como
  "fundação sem módulos".

### Gate

Nenhuma carga, criação de adapter externo ou remoção de capacidade legada
começa enquanto houver item `TBD` no escopo do piloto, dependência transitiva
sem decisão ou mapeamento de identidade sem reconciliação.

## Marco 1 — fundação de armazenamento e autorização

### 1.1 Armazenamento antes de migração de arquivos

- Provisionar bucket privado, prefixo por tenant, credencial externa mínima,
  scanner, limites/quota, retenção e exclusão compatíveis com o piloto.
- Ensaiar upload, scan, download autorizado, expiração, limpeza, restore e
  reconciliação por checksum sem expor objeto ou URL pública.
- Definir transformador e chave idempotente para cada arquivo legado. R2/object
  storage é parte desta fundação; não é adiado para integrações de negócio.

### 1.2 Autorização e administração

#### Escopo

- Criar grupos tenant-scoped e memberships de grupo.
- Criar `ResourceGrant` por recurso para substituir permissões específicas de
  formulário, moderadores e permissões de página quando a matriz por papel não
  for suficiente.
- Antes de implementar grants, aprovar ADR que defina: sujeitos (usuário e
  grupo), `resourceType`/`resourceId`, precedência sobre papel/capability,
  allow/deny, expiração, revogação, delegação, auditoria, paginação e
  enforcement obrigatório na API e no banco. Grants jamais atravessam tenant.
- Completar catálogo de listas/configurações aprovadas por tenant, com schema
  tipado, auditoria e política de retenção.
- Manter `OWNER`, `ADMIN`, `MEMBER` e `VIEWER` como base; grants nunca podem
  cruzar organizações ou ampliar um papel acima da política central.

#### Aceite

- Matriz endpoint × capability/grant publicada e testada para todos os papéis.
- Testes A -> B -> A para leitura, escrita, exportação, arquivo e recurso
  público em conexão reutilizada.
- UI para membros, grupos e grants somente para os papéis autorizados.
- Os módulos que não exigem autorização por recurso podem seguir com o RBAC
  existente; o ADR de grants não bloqueia seus deltas funcionais.

## Marco 2 — fechar os deltas dos domínios de negócio

Os subitens podem ocorrer em paralelo. Apenas funcionalidades que dependem de
delegação por recurso aguardam o ADR/modelo de `ResourceGrant`; arquivos só
começam após o Marco 1.1.

### 2.1 Formulários e arquivos

- Decidir se histórico de slug, contador de campos e versões nomeadas são
  necessários; quando forem, implementar como entidades compatíveis sem perder
  o snapshot de submissão já existente.
- Aplicar `ResourceGrant` quando houver formulário privado ou delegado, se a
  decisão do Marco 1.2 mantiver esse requisito.
- Decidir entre exportação síncrona limitada (estado atual) e export job para
  volumes acima do limite; adicionar notificação/outbox se o job for aprovado.
- Reconciliar formulários, campos, submissões, tratativas e checksums de
  anexos do tenant piloto.

### 2.2 Eventos, mudanças e BASH

- Fechar a decisão de substituição de `Moderator` por grants/capabilities.
- Entregar exportação de mudanças caso o dono confirme necessidade; manter a
  máquina de estados, riscos, aprovações e evidências como fonte de verdade.
- Adicionar configurações de quadro BASH somente para comportamentos do
  legado que permaneçam aprovados (colunas, ordenação ou políticas locais).
- Reconciliar eventos, evidências, ações, mudanças, riscos, cartões,
  comentários e anexos por organização.

### 2.3 HHT

- Implementar ou descontinuar formalmente `HhtLatePermission` e `HhtSetting`.
- Completar regras de exceção de atraso, unidades/empresas e configurações de
  período aprovadas pelo negócio.
- Reconciliar totais por empresa e período com tolerância definida e explicar
  toda exceção antes de aceitar o piloto.

### Aceite comum do Marco 2

- Contrato HTTP, RLS A/B, regras de domínio, concorrência e fluxo Playwright
  do caminho principal por módulo.
- Auditoria e outbox para cada mutação de negócio relevante.
- Relatório de reconciliação assinado pelo dono do domínio.
- Para cada ativo, manter matriz: origem, destino, transformador/versionamento,
  chave idempotente, contagem esperada, hash/checksum, tolerância, exceções,
  retenção/eliminação de PII, testes de borda e responsável pelo aceite.
- Executar carga de volume representativo e registrar p95 de API/worker,
  backlog, throughput, espaço de storage e limites de exportação.
- Testar backup e restore do domínio e seus anexos antes de aceitar o piloto.

## Marco 3 — integrações e operação segura

### Integrações

- Webhook permanece o padrão de adapter já entregue. Acrescentar somente os
  adapters aprovados no ledger: WhatsApp, Smartsheet, e-mail/Resend, IA e BI.
  R2/object storage pertence à fundação do Marco 1.1.
- Para cada adapter: referência de segredo externa, teste de configuração sem
  expor segredo, contrato de evento versionado, idempotência, timeout, retry,
  DLQ, re-drive, métricas e runbook.
- Para WhatsApp, modelar conexões, grupos e destinos; para BI, criar service
  account/chave com escopo, rotação e revogação. Não migrar chaves antigas.

### Operação

- Definir SLOs, alertas e retenção para API, worker, Kafka, outbox e adapters.
- Decidir o substituto restrito para o monitoramento de servidores legado;
  nunca expor métricas de host ou executor SQL a usuários da aplicação.
- Completar procedimentos de incidente, rotação de segredo, restore e teste de
  re-drive por adapter.

### Aceite

- Cada efeito externo tem teste de falha, duplicidade, timeout, retry e DLQ.
- Alertas disparam em ambiente controlado e o runbook é executável sem acesso
  a segredos.

## Marco 4 — analytics, painéis e TV

As fontes analíticas autorizadas e publicações estáticas já existem. Este marco
fecha apenas as lacunas aprovadas pelo negócio:

- decidir se relatórios legados adicionais serão convertidos em fontes
  allowlisted ou descontinuados;
- adicionar widgets, filtros e projeções somente com contrato tipado e sem SQL
  livre no navegador;
- medir consultas e criar índices/projeções antes de ampliar volume;
- reconciliar snapshots públicos, expiração, revogação e playlists.

## Marco 5 — qualidade contínua e gates de release

- Ampliar Playwright do atual fluxo de autenticação para o fluxo principal de
  cada módulo e para links públicos inválidos, expirados, revogados e entre
  tenants.
- Manter manifesto de rotas, contrato HTTP, integração PostgreSQL/RLS, Redis,
  Kafka, lint, tipos, build e verificação de ACL em todo pull request.
- Fortalecer o verificador de ACL para analisar ACL efetiva/final, rejeitar
  grants amplos e não depender de ordenação lexicográfica da migration.
- Para cada entrega: revisão crítica independente, correção das falhas e nova
  avaliação até >= 9/10, sem aumento artificial de nota.

## Marco 6 — piloto, corte e desativação do legado

1. Antes da carga, produzir ADR e runbook de dual-run/corte conforme
   `ETL_MIGRATION_PROTOCOL.md`: snapshot consistente, watermark/CDC,
   transformação versionada, chave de idempotência, checkpoint e tratamento de
   falhas por ativo.
2. Executar carga reexecutável de um único tenant, com checkpoint e relatório
   de contagens, hashes de arquivos e exceções.
3. Rodar dual-run de leitura/validação pelo período aprovado, sem escrita
   concorrente não reconciliada. Definir previamente a regra de conflito e a
   fonte de verdade de cada capacidade.
4. Rodar smoke tests, jobs pendentes/DLQ e o fluxo operacional completo com o
   dono do piloto. Corrigir divergências e repetir a carga até aceite.
5. Ensaiar corte cronometrado: feature flags/roteamento por tenant e
   capacidade, write fencing ou read-only no legado, freeze, delta final,
   revalidação e critérios de rollback. Medir o resultado contra RPO/RTO.
6. No corte real, aplicar o mesmo runbook e manter rollback para o legado
   enquanto durar a janela definida. Após novas escritas no novo sistema,
   rollback exige estratégia explícita de reversão/compensação; não há retorno
   automático que perca dados.
7. Após estabilidade e aceite, revogar acessos legados, preservar retenção e
   arquivar evidências de migração. Itens descontinuados exigem aceite e data
   de retirada explícitos.

## Ordem recomendada de execução

1. Marco 0: decisões e piloto.
2. Marco 1: storage seguro, grants, grupos e configurações aprovadas.
3. Marco 2.3: HHT, caso seja parte do piloto; caso contrário, o domínio de
   maior uso confirmado pelo Marco 0.
4. Marco 2.1 e 2.2: fechar deltas do domínio escolhido e reconciliá-lo.
5. Marco 3: somente os adapters exigidos pelo piloto.
6. Marco 4 e 5 em paralelo com as entregas de domínio.
7. Marco 6: carga piloto e corte por capacidade, nunca corte total implícito.

## Itens explicitamente fora de migração literal

- `/admin/sql-executor` não será reconstruído.
- Métricas de host, páginas institucionais e design antigo só entram mediante
  decisão registrada; não são importados por inércia.
- Credenciais, tokens e chaves legadas nunca são migrados; são rotacionados ou
  recriados no ambiente novo.
