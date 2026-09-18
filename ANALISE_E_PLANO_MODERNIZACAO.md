# Análise do Builder Solutions 9 e plano para a nova versão multi-tenant

## Escopo e método

Esta análise é estática e foi feita sobre o commit `a4a0e0637ba7d47901b71b7d2c626ac5e2595f24` do repositório informado, clonado apenas para leitura em `source-review/`. Não foram modificados código, dados nem configurações do sistema legado.

O objetivo da nova versão é preservar as capacidades de negócio existentes, tornando-as isoladas por organização (*tenant*), auditáveis, testáveis e operáveis. A recomendação é construir uma aplicação nova em paralelo, sem tentar converter gradualmente o Express atual em NestJS.

## O que o produto atual faz

| Domínio | Capacidades observadas | Decisão para a nova versão |
| --- | --- | --- |
| Formulários | construtor de campos, regras/condições, passos, anexos, formulários públicos/privados, respostas, exportação, tratativa pai-filho, PDF | **Núcleo do MVP**; preservar, mas versionar o esquema do formulário |
| Segurança operacional | eventos/classificação, fotos, filtros, acompanhamento e notificações | Migrar após o núcleo de formulários |
| Gestão de mudanças | fluxo por etapas, riscos e aprovação | Migrar como módulo próprio, não como JSON genérico sem contrato |
| BASH | cartões, estágios, comentários, anexos e intake a partir de resposta | Migrar como fluxo de trabalho sobre Formulários e Arquivos |
| Indicadores | dashboards configuráveis, widgets, dashboards públicos, telas de TV e playlists | Migrar depois de dados, filtros e autorização estarem estáveis |
| HHT & Taxas | empresas, relatórios mensais, consolidação, metas, permissões de atraso | Manter como módulo operacional independente, com modelo relacional |
| Integrações | Cloudflare R2, Smartsheet, WhatsApp, OpenAI, webhooks e BI | Implementar por adaptadores assíncronos; não chamar fornecedores no caminho crítico da requisição |
| Administração | usuários, grupos, permissões de página, aparência e configurações | Substituir por memberships, papéis/capacidades e configurações por tenant |

## Constatações técnicas relevantes

- O backend é Express 4 com Prisma 5, apesar de o `docker-compose` chamá-lo de NestJS. A inicialização registra rotas diretamente em `main.ts`; não há módulos, controladores ou serviços Nest.
- Há 224 handlers HTTP distribuídos por rotas. `forms.routes.ts` concentra 3.331 linhas; outros pontos críticos são dados de dashboard (1.017), integrações (906), Smartsheet (1.992) e TV (1.093). Isso mistura transporte HTTP, autorização, regra de negócio, acesso a dados e integrações externas.
- O frontend React/Vite já usa tecnologias aproveitáveis (React 18, TypeScript, Tailwind, shadcn/ui e React Query), mas há componentes excessivamente grandes: `TvDisplayDialog` tem 3.242 linhas, `FormFieldCard` 2.658 e `PublicFormPage` 2.045. Foram encontradas 307 ocorrências de `as any` em `backend/src` e `src`.
- O Prisma contém 38 modelos, mas não há diretório de migrations. O processo de inicialização executa DDL idempotente por `$executeRawUnsafe`, e continua mesmo se um patch falhar. Isto torna versão de esquema, rollback e reprodução de ambientes não confiáveis.
- Não foram encontrados testes automatizados nem configuração de Vitest/Jest. A aplicação não tem contrato OpenAPI nem pipeline de CI visível no repositório.
- Não existe entidade `Tenant`/`Organization`, `tenantId` nas tabelas ou escopo de tenant nas consultas. Identificadores públicos hoje são globais (`Form.slug`, `Dashboard.publicSlug`, displays e playlists), e as permissões globais são baseadas em `MASTER`/`ADMIN`/`USER`.
- Alguns dados são acessíveis sem autenticação por desenho de produto (formulários e eventos usam rotas com autenticação opcional). Em uma aplicação multi-tenant isso exige uma política explícita de publicação e escopo, não apenas uma rota pública.
- Credenciais de integrações são recebidas e persistidas no JSON `Integration.config`. Embora as respostas administrativas mascarem parte dos segredos, não há evidência de criptografia em repouso nem de rotação/auditoria de uso de segredo.
- O repositório versiona `.env`. Nenhum valor será exposto neste documento; o arquivo deve ser removido do histórico e todos os segredos nele contidos devem ser rotacionados antes de qualquer migração.

## Arquitetura proposta

Usar um **monólito modular** em workspace TypeScript, com um único deploy de API e outro de worker. Kafka é usado somente para comandos que podem ser assíncronos ou reexecutados; não é justificativa para decompor cada domínio em microserviço.

```text
apps/web (React 18 + Vite) ─── HTTPS ──> apps/api (NestJS + Fastify)
                                                │
                                                ├── PostgreSQL 18 + Prisma
                                                ├── Object storage (arquivos por tenant)
                                                └── outbox ──> Kafka ──> apps/worker (Nest application context)
                                                                       └── R2 / WhatsApp / Smartsheet / IA / e-mail
```

Estrutura inicial:

```text
apps/
  api/                 # NestJS/Fastify: controllers finos, guards, módulos de domínio
  worker/              # consumidores Kafka, retries, DLQ, agendamentos
  web/                 # React/Vite, páginas e componentes por feature
packages/
  contracts/           # DTOs/Zod, tipos de eventos e clientes HTTP gerados/manual
  domain/              # regras puras, políticas e testes unitários
  config/              # ESLint, TypeScript, Vitest e convenções compartilhadas
prisma/
  schema.prisma
  migrations/          # somente migrations versionadas; sem DDL no boot
```

Tecnologias necessárias: NestJS com adaptador Fastify, Prisma, PostgreSQL 18, React 18, Vite, TypeScript, Tailwind e shadcn/ui; Vitest para testes; Kafka apenas para a caixa de saída e tarefas externas. Redis, OpenTelemetry, um gateway de API, GraphQL, CQRS completo ou microserviços não entram na primeira versão sem uma necessidade medida.

## Decisões de identidade e perímetro HTTP

O primeiro corte mantém a identidade local porque o legado já administra usuário e senha e não foi apresentada uma exigência de SSO. Senhas novas usam Argon2id; na primeira autenticação, hashes legados compatíveis são re-hasheados com os parâmetros atuais. OIDC/SAML entra depois somente se a Fase 0 confirmar um provedor corporativo e seus requisitos de associação de conta. Não haverá duas fontes de identidade concorrentes no MVP.

- Web e API serão servidos pelo mesmo site lógico. A sessão é opaca, com ID aleatório armazenado somente como hash no banco, cookie `HttpOnly`, `Secure`, `SameSite=Lax` e escopo de domínio mínimo. A sessão tem expiração deslizante curta e limite absoluto; é rotacionada em login, troca de tenant, mudança de privilégio e eventos sensíveis, e é revogável por usuário/membership/tenant. Não usar JWT de acesso no `localStorage`.
- Escritas autenticadas exigem proteção CSRF (token vinculado à sessão), `Origin`/`Referer` validados e CORS em allowlist exata. CORS cross-site não é habilitado no MVP. Cabeçalhos de segurança, CSP por ambiente, HSTS após HTTPS, limite de corpo e rate limit são testados no gateway Fastify.
- Recuperação de senha usa token de uso único, hash e expiração; não revela se o e-mail existe. MFA TOTP ou WebAuthn será obrigatório para `PlatformAdmin` e administradores de tenant antes do piloto, com códigos de recuperação armazenados como hash. Sessões podem ser listadas e encerradas.
- `ServiceAccount` é uma identidade não humana, vinculada a um tenant, com capacidades mínimas, credencial de API somente exibida uma vez, hash, expiração e rotação. Conta de serviço não troca de tenant e não recebe cookie de navegador.
- O rate limit tem chaves explícitas: IP + rota para recursos públicos, sessão/usuário + tenant para recursos privados e chave de serviço + tenant para API. Há limites de upload, submissão, exportação e IA, quotas configuráveis por tenant e resposta `429` consistente. WAF/CDN é uma camada complementar, não a única defesa.

## Contrato de multi-tenancy

### Modelo e resolução de contexto

1. Criar `Organization` (tenant), `Membership` e `Role`/`Permission`. Uma pessoa pode participar de várias organizações; `PlatformAdmin` fica separado de papéis internos de tenant.
2. Cada requisição autenticada resolve o tenant por domínio/subdomínio ou por seleção explícita de membership. O `tenantId` não é aceito diretamente do cliente como fonte de autorização.
3. Token/sessão contém `userId`, `membershipId`, `tenantId` e versão de sessão; o guard verifica membership ativa e domínio antes de invocar o caso de uso. Trocar de organização reemite o contexto.
4. Todo agregado pertencente a uma organização recebe `tenantId` obrigatório: usuários de negócio/memberships, formulários, versões/campos/respostas, arquivos, eventos/fotos, BASH, mudanças/riscos, HHT, dashboards/widgets/TV, integrações, webhooks, listas e configurações. Tabelas plataforma ficam explicitamente sem tenant.
5. Exclusividades e índices passam a ser compostos pelo tenant, por exemplo `@@unique([tenantId, slug])` e índices `(tenantId, createdAt DESC)`. Endereços públicos usam `tenantSlug + recursoSlug` ou domínio do tenant; nunca uma busca global apenas por slug.

### Defesa em profundidade

- O serviço de aplicação recebe um `TenantContext` obrigatório; repositórios não aceitam buscas sem filtro de tenant. IDs recebidos são sempre consultados com `{ id, tenantId }`.
- PostgreSQL aplica RLS nas tabelas tenant-scoped. Para cada unidade de trabalho, a API define `SET LOCAL app.tenant_id` dentro de transação; a role de runtime não pode ser superusuária nem ter `BYPASSRLS`. A suíte de integração prova isolamento entre dois tenants e a ausência de contexto.
- Papéis são permissões orientadas a capacidade (`forms.read`, `forms.manage`, `submissions.export`, `integrations.manage`, etc.), não verificações dispersas de `MASTER`. Uma matriz de autorização por caso de uso será a fonte única.
- Todo acesso público exige uma publicação explícita: recurso ativo, tenant ativo, token/slug público de alta entropia quando houver dado sensível, expiração/revogação e rate limit. Respostas públicas nunca retornam configurações internas ou dados de outro tenant.
- Arquivos são registrados em `FileAsset` com tenant, dono e estado. Upload ocorre por URL assinada limitada a chave prefixada `tenants/{tenantId}/...`; a API valida a relação campo/formulário antes de finalizar o anexo. Definir verificação de tipo, tamanho e antivírus conforme política de risco.
- Segredos não ficam em JSON de configuração. Persistir apenas metadados e um `secretRef` para cofre de segredos/KMS; registrar criação, rotação, teste e uso sem registrar valores. Remover `.env` do Git e rotacionar os segredos atuais.
- Criar `AuditLog` append-only com tenant, ator, ação, recurso, correlação, IP e resumo redigido; cobrir permissões, exportações, dados sensíveis e integrações.

### Contrato de RLS, transações e conexões

`app_migrator` é a role exclusiva do job de migration, separada de `app_runtime`. A role runtime não é dona das tabelas, não é superusuária, não tem `BYPASSRLS` e só recebe privilégios DML necessários. O worker usa outra role runtime com a mesma restrição. A administração de banco não compartilha essas credenciais.

Todo caso de uso tenant-scoped inicia por uma única fábrica `withTenantTransaction(context, work)`. Ela abre `prisma.$transaction`, executa `SELECT set_config('app.tenant_id', $tenantId, true)` e passa apenas o `TransactionClient` ao repositório. Consultas fora dessa fábrica são proibidas por convenção verificada em lint/revisão; repositórios exigem `TenantContext` e adicionam o predicado `tenantId`, de modo que RLS seja segunda barreira e não a única. O contexto é estabelecido também para jobs e rotinas administrativas, nunca a partir de header ou parâmetro do cliente.

O início usa pool direto do banco. Se PgBouncer for introduzido após teste de carga, será exclusivamente em *transaction pooling*, pois `SET LOCAL` termina com a transação; não se usa contexto de sessão. A suíte de integração executa, em conexões reutilizadas e em paralelo, sequência A→B→A e falha se qualquer consulta sem `set_config`, contexto residual ou acesso cruzado retornar linha. O teste também verifica políticas RLS, role runtime e `FORCE ROW LEVEL SECURITY` nas tabelas de tenant.

### Classes de dado e relações entre tenants

| Classe | Exemplos | Regra |
| --- | --- | --- |
| Global de plataforma | `IdentityUser`, provedor de login, `Organization`, catálogo de planos | não possui `tenantId`; só a plataforma administra |
| Associação | `Membership`, `ServiceAccount`, convite e grupo | conecta identidade global a **um** tenant; únicas incluem `organizationId` |
| Propriedade de tenant | formulários/versões/campos/respostas, eventos, BASH, HHT, mudanças, dashboards, displays, integrações e arquivos | `tenantId NOT NULL`, RLS e FKs que preservam o mesmo tenant |
| Referência pública | publicação de formulário/dashboard/display e link de download temporário | pertence ao tenant, possui estado/expiração/revogação; não concede acesso a outros recursos |

Toda FK entre agregados tenant-owned carrega validação de mesmo tenant (FK composta onde for viável, ou trigger invariável quando o modelo exigir). Exclusividades com campos opcionais recebem índice parcial explícito; não se presume semântica desejada de `NULL` em unique composto. Não há compartilhamento de dados entre tenants no MVP. Qualquer futuro recurso compartilhado exige um agregado de concessão explícita, não a remoção de RLS.

## Design por domínio

| Módulo Nest | Agregados e responsabilidades | Limites importantes |
| --- | --- | --- |
| Identity & Tenancy | organização, membership, papel, sessão, domínio, convite | autenticação e seleção de tenant antes dos outros módulos |
| Form Builder | formulário, `FormVersion`, campo, regra, publicação, permissão | uma resposta referencia uma versão imutável; configs flexíveis permanecem JSONB validado por schema versionado |
| Submissions & Files | resposta, anexos, workflow/tratativa, exportação | idempotência para submit público; dados de resposta em JSONB com índices somente para filtros realmente usados |
| Safety Events | evento, classificação, foto e ações | campos canônicos relacionais; metadados extensíveis separados |
| Change Management | mudança, etapas, risco, aprovação | transições de estado validadas por máquina de estados e auditadas |
| Bash Board | cartão, comentário, anexo, estágio e intake | eventos de domínio para notificação, sem chamada HTTP síncrona a WhatsApp |
| HHT | empresa, período, relatório, autorização de atraso, meta e consolidação | regra de consolidação pura e testada; chaves únicas por tenant/empresa/período |
| Analytics & Display | dashboard, widget, fonte de dados, display e playlist | filtros autorizados e queries pré-definidas; não executar SQL livre de usuário |
| Integrations | conexão, segredo, endpoint, assinatura, tentativa e entrega | adaptadores isolados; webhooks assinam/verificam payloads e são idempotentes |

Autorização combina papel de tenant e concessão por recurso. Papéis concedem capacidades; para formulários e seus derivados, o acesso pode vir de proprietário, grupo ou `ResourceGrant` direto, preservando a necessidade atual de permissões por formulário. Precedência é: tenant suspenso ou membership inativa nega; `PlatformAdmin` só atua em suporte auditado; papel com capacidade permite no tenant; para recurso protegido exige também proprietário ou grant compatível. O MVP não tem `deny` explícito: uma concessão adicional soma permissões. Se uma regra de negação for necessária, será um ADR e não uma condição ad-hoc em controller. Essa matriz, inclusive para service accounts, vira teste parametrizado por caso de uso.

## Comunicação assíncrona e confiabilidade

As ações que disparam comunicação externa gravam o resultado de negócio e um `OutboxEvent` na **mesma transação**. O worker publica/consome com chave de partição `tenantId`, chave de idempotência, contagem de tentativas, backoff e DLQ. Os primeiros eventos são `submission.created`, `event.created`, `bash-card.created`, `change.status-changed`, `export.requested` e `integration.delivery-requested`.

O worker processa notificações, Smartsheet, IA, geração de arquivo e consolidações. Handlers são at-least-once: efeitos externos exigem chave idempotente e a tabela `ProcessedMessage`. Não colocar dados sensíveis inteiros do formulário no tópico; transportar identificadores e buscar o conteúdo autorizado no worker.

O dispatcher de outbox faz *claim* atômico com lease, publica e só então marca entrega; leases vencidos podem ser retomados. Eventos têm `eventId`, `eventType`, `schemaVersion`, `occurredAt`, `tenantId`, `aggregateId` e payload mínimo. Compatibilidade é aditiva por versão; consumidores desconhecidos encaminham para DLQ, nunca descartam silenciosamente. A chave Kafka é `tenantId:aggregateId` (ou outra chave de agregado justificada por evento), preservando ordem onde ela importa sem concentrar todo o tenant em uma única partição. Tópicos usam TLS/SASL, ACL por produtor/consumidor e retenção definida; DLQ tem alerta, re-drive auditado, ferramenta de replay e prazo de retenção. Métricas cobrem idade do outbox, mensagens em atraso/DLQ, retries, taxa de idempotência e falhas por fornecedor.

## Arquivos: ciclo de vida completo

O cliente inicia um `UploadIntent` autorizado para o recurso e campo específicos. A API gera chave opaca e URL assinada de uso/tempo/tamanho/tipo limitados — o cliente não escolhe caminho, `tenantId` nem `fieldId`. Ao concluir, API/worker valida checksum, MIME/magic bytes e relação com o agregado, registra `FileAsset` como `quarantined`, executa scan conforme a classificação de risco e só então muda para `ready`. Download também é autorizado por tenant/grant e usa URL curta assinada; objetos não são públicos por padrão.

Estados são `pending`, `quarantined`, `ready`, `rejected`, `deleted` e `expired`. Um job limpa intents e objetos órfãos, mas respeita retenção e `legalHold`; deleção lógica precede exclusão física auditada. Metadados incluem classificação, checksum, tamanho, uploader, objeto, datas de retenção e vínculo ao recurso. Backups e restore verificam metadados e disponibilidade do objeto sem registrar conteúdo em logs.

## API, web e qualidade

- APIs REST versionadas em `/v1`, DTOs validados e respostas de erro estáveis. Schemas Zod em `packages/contracts` são a fonte de verdade para validação HTTP e geração do OpenAPI/tipos do cliente, impedindo divergência de DTO. Paginação cursor para coleções grandes; filtros/sort fields em allowlist.
- Controllers adaptam HTTP; casos de uso coordenam políticas; repositórios Prisma ficam por módulo. Não permitir `PrismaClient` em controllers nem DDL/patch de banco no boot.
- Web organizado por feature (`features/forms`, `features/events`, etc.). Form builder, renderer e editor de regras usam o mesmo contrato de campo. Componentes de UI shadcn permanecem genéricos; páginas não acumulam fetch, transformação e apresentação.
- React Query conserva cache por `tenantId` e invalida ao trocar organização. O roteamento exige contexto de tenant antes de páginas privadas; links públicos incluem o escopo do tenant.
- Vitest: unidades para regras puras e políticas; integração Nest+PostgreSQL para RLS, repositórios, autenticação e contratos; testes de consumidor para idempotência/DLQ. Acrescentar poucos fluxos de browser críticos (login/troca de tenant, formulário público, exportação autorizada) se a equipe já mantiver Playwright.
- Pipeline obrigatório: lint, `tsc --noEmit`, testes, `prisma validate`, migrations em banco efêmero e verificação de dependências/segredos. Repositório deve usar lockfile único e versões pinadas em CI.

### Operação, privacidade e resiliência

- Definir SLI/SLO antes do piloto: disponibilidade e latência da API/formulário público, taxa de submissão, atraso máximo do outbox, RPO/RTO e sucesso de entrega por integração. Alertas têm limite, responsável e runbook para RLS, banco, Kafka, storage, quota e fornecedor externo.
- Backup automatizado inclui PostgreSQL com WAL/PITR e inventário de objetos. Restaurar uma cópia isolada, executar reconciliação e medir RPO/RTO é exercício trimestral, com evidência; backup sem restore testado não é gate de produção.
- Antes de cada módulo com consulta pesada, testar carga com volume esperado e 3× pico para JSONB, exportação, widgets/TV e uploads. Definir limites de página/exportação, stream/worker para arquivos grandes e quotas/custos por tenant para storage, jobs, IA e chamadas externas.
- Classificar PII em colunas, JSONB, anexos, eventos e logs. Definir por classe retenção, exportação de dados, eliminação/anonimização verificável e `legalHold`. `AuditLog` é append-only para a role runtime, com retenção definida e conteúdo redigido; não alegar imutabilidade absoluta sem armazenamento WORM/controle externo.
- Logs usam campos estruturados, `requestId`/`tenantId` e lista de redaction para senha, token, cookie, chave, payload de formulário e URL assinada. Há procedimento de resposta a incidente, rotação e comunicação de segredo/dado exposto.

## Plano de execução

### Fase 0 — Descoberta e contratos (1–2 semanas)

1. Validar com usuários e operação a matriz de capacidades acima: quais fluxos são usados, dados sensíveis, papéis, retenção, volume, SLA e quais links públicos devem existir.
2. Produzir glossário e backlog por fluxo; definir o que entra no primeiro corte. Gerar inventário de tabelas, endpoints, JSONs de configuração, buckets e integrações sem copiar segredos.
3. Formalizar modelo de tenants: modelo de domínio, domínios/URLs, papel de plataforma, matriz de capacidade e casos de acesso público. Decidir com negócio a política de exclusão/retensão e requisitos LGPD.
4. Congelar um dump de leitura e amostras anonimizadas para testes de migração. Mapear cada origem para destino e definir reconciliações por contagem, checksum e amostragem.
5. Construir uma matriz rastreável `endpoint/tabela/componente legado → capacidade → dono → evidência de uso → destino (migrar, substituir ou descontinuar) → release`. Considerar usado somente o que tiver telemetria, entrevista com dono ou obrigação regulatória documentada.
6. Criar e obter aceite do negócio para a matriz de atribuição `registro/arquivo/identidade legado → Organization`. Resolver usuários em múltiplas empresas, registros órfãos, duplicados, empresas inativas, links públicos e ownership de arquivos em uma fila de exceções, não por inferência no ETL.

**Saída/gate:** ADRs aprovados para tenancy/RLS/pooling, autenticação/sessões/MFA, autorização por recurso, arquivos, segredos, publicação pública, privacidade/retenção, migration/release e eventos; matriz de escopo e atribuição de tenant tem dono e aceite do negócio; backlog priorizado por valor e risco.

### Fase 1 — Fundação executável (2–3 semanas)

1. Criar workspace, `apps/api`, `apps/worker`, `apps/web` e pacotes compartilhados; configurar Nest/Fastify, Prisma, React/Vite, Tailwind/shadcn e Vitest.
2. Criar migrations iniciais para organização, membership, papéis/capacidades, sessões, audit log e outbox; testar migrate deploy em banco vazio e upgrade controlado.
3. Implementar resolução de tenant, guards, `TenantContext`, RLS e matriz de autorização. Implementar login, convite, troca de organização e bloqueio de tenant.
4. Criar saúde/readiness, logs estruturados com `requestId`/`tenantId` redigidos, métricas básicas e CI.

**Gate:** nenhum teste entre tenant A/B pode ler, escrever, anexar, baixar ou enumerar recurso do outro; testes de pool não vazam contexto RLS; nenhum segredo é retornado ou logado; fluxos de login, revogação, CSRF e MFA administrativo passam nos testes definidos.

### Fase 2 — Primeiro vertical slice: Formulários e respostas (3–5 semanas)

1. Entregar criação/publicação/versionamento de formulário, campos essenciais, regras de visibilidade/validação e resposta pública/privada idempotente.
2. Entregar permissões de formulário, anexos por URL assinada, exportação autorizada, auditoria e a primeira tratativa pai-filho necessária.
3. Criar web por feature para gestão, preenchimento e consulta; migrar somente os widgets/campos realmente usados no corte.
4. Criar contrato OpenAPI, testes de unidade/integrados e três fluxos críticos de browser.

**Gate:** uma organização pode criar, publicar, preencher, anexar, consultar e exportar sem acesso cruzado; uma resposta antiga continua interpretável pela `FormVersion` original.

### Fase 3 — Fluxos operacionais (3–5 semanas)

1. Migrar Eventos/Classificação e BASH sobre os serviços de arquivo, resposta e auditoria.
2. Migrar Gestão de Mudanças com transições explícitas e aprovações auditadas.
3. Migrar HHT com consolidação determinística, limites de edição por período e permissão de atraso.

**Gate:** regras de cálculo e de transição possuem casos de fronteira em Vitest; totais de dados migrados reconciliam com o legado por tenant.

### Fase 4 — Indicadores e integrações (2–4 semanas)

1. Implementar dashboards/widgets e TV a partir de fontes de dados autorizadas e queries parametrizadas; migrar apenas widgets aprovados.
2. Implementar outbox/Kafka/worker, adaptadores de R2, WhatsApp, Smartsheet, IA, webhook e BI na ordem de uso confirmada na Fase 0.
3. Usar cofre/KMS para segredos, assinatura de webhooks, tentativas/DLQ e painel de estado de entrega.

**Gate:** falha de fornecedor não perde nem duplica efeito de negócio; replay é idempotente e rastreável; consultas de analytics continuam tenant-scoped.

### Fase 5 — Migração, piloto e corte (2–4 semanas)

1. Construir ETL versionado e reexecutável por tenant, com validação de referências, arquivos e valores de JSON; não executar DDL ad-hoc no ambiente de produção.
2. Executar piloto com um tenant representativo e paralelismo controlado: leitura/reconciliação, aceite por fluxo e treinamento.
3. Realizar corte por tenant com janela, freeze de escrita no legado, migração delta, smoke tests e plano de rollback (voltar tráfego ao legado; não sobrescrever dados legados).
4. Após retenção definida, revogar segredos antigos, arquivar infraestrutura legada e preservar exportação/auditoria conforme LGPD.

**Gate:** atribuição de cada registro/arquivo a tenant foi aprovada ou está em exceção resolvida; reconciliação aprovada, sem incidente de isolamento, métricas e alertas ativos, restore/PITR e plano de suporte/rollback ensaiados.

### Processo de release e migrations

Migrations são *forward-only* por padrão: correção é uma nova migration ou procedimento compensatório revisado, não a promessa genérica de `down`. Cada alteração segue **expand → deploy compatível → backfill reexecutável e observável → validação → contract**. API e worker permanecem compatíveis com as duas formas de dados durante o rollout; feature flags protegem leituras/escritas novas.

O pipeline executa um job único de `migrate deploy` com role `app_migrator`, lock de advisory e registro da versão. As instâncias de API não aplicam DDL nem tentam corrigir esquema no boot; seu readiness verifica compatibilidade da versão e o orquestrador só recebe tráfego após o job aprovado. Antes de mudança destrutiva há backup, janela e restauração/PITR ensaiada. Rollback de aplicação preserva a camada expandida; rollback de dados é um plano de compensação explicitamente testado.

## Backlog inicial priorizado

| Prioridade | Item | Justificativa |
| --- | --- | --- |
| P0 | tenancy, RLS, memberships/capacidades, auditoria, segredos e migrations | são pré-requisitos de segurança e impedem retrabalho em todos os módulos |
| P0 | formulário versionado, resposta, arquivos e permissões | é a capacidade com maior reaproveitamento e sustenta BASH/tratativa |
| P1 | eventos/classificação, BASH, gestão de mudanças e HHT | preservam os fluxos operacionais identificados |
| P1 | outbox/worker e integrações realmente utilizadas | desacopla fornecedores e dá confiabilidade a notificações/exportações |
| P2 | dashboards, TV, playlists e conectores de BI | dependem de dados e permissões estáveis; podem ser entregues sem bloquear o núcleo |
| P2 | recursos visuais legados e customizações não usadas | só migrar mediante evidência de uso e aceite funcional |

## Riscos e decisões pendentes

1. **Escopo funcional:** o código revela funcionalidades, não frequência/criticidade. A ordem P1/P2 deve ser confirmada pela Fase 0; não se deve inferir que todos os campos e widgets merecem migração literal.
2. **Atribuição de tenant:** como o legado não tem tenant, a migração só inicia após a matriz de atribuição e suas exceções serem aprovadas pelo negócio; contagens e checksum não substituem esse aceite.
3. **RLS com Prisma/pooling:** implementar e testar o `SET LOCAL` exclusivamente dentro de transação, inclusive no worker. Um cliente de banco com `BYPASSRLS` invalidaria a proteção.
4. **Dados em JSONB:** respostas e layouts podem permanecer flexíveis, mas campos de busca, joins, unicidade e estados precisam de colunas e índices explícitos. Cada nova consulta deve ter plano de índice e teste de volume.
5. **Links públicos:** formulários, dashboards e TV exigem uma decisão de exposição e revogação antes da migração; `slug` humano isolado não é um segredo.
6. **Credenciais já expostas:** o `.env` versionado deve ser tratado como incidente operacional, com rotação antes do piloto. A remoção do arquivo no próximo commit não apaga o histórico.
7. **Kafka:** iniciar somente com outbox, eventos mínimos, DLQ e operação observável. Não publicar payloads de formulário contendo dados pessoais.

## Critérios de aceite do programa

- Isolamento verificado em testes automatizados e tentativa manual: A nunca acessa objetos, arquivos, exports, dashboards ou mensagens de B.
- Toda alteração de esquema é uma migration revisável e reversível/compensável; boot não executa DDL.
- Fluxos aprovados pelo piloto são reconciliados com o legado e têm dono operacional, telemetria e runbook.
- APIs públicas, cookies/tokens, segredos, upload e webhooks passam por revisão de segurança antes do corte.
- A cobertura é medida por risco: todas as políticas de tenant/autorização, transições, cálculos HHT, idempotência e mapeamentos de migração têm teste.
