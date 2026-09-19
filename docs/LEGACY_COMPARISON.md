# Comparação com Builder Solutions 9

Data da análise: 19 de setembro de 2026.

## Escopo e método

Esta é uma comparação de código e contratos, não uma inferência de uso real. O
baseline é o commit imutável
`a4a0e0637ba7d47901b71b7d2c626ac5e2595f24` do repositório
`andmarttins/builder-solutions-9`, clonado localmente apenas para leitura. Não
foram lidos nem copiados arquivos `.env`, dados de produção ou segredos.

O legado é uma aplicação React/Vite com API Express/Prisma. Ele declara 38
modelos Prisma e registra 28 grupos de rotas. A nova plataforma é um monorepo
NestJS/Fastify, React/Vite e PostgreSQL com isolamento por organização. Ela
possui, hoje, a fundação de identidade, tenancy, auditoria, outbox, health e um
worker ainda sem fluxos de negócio.

**Conclusão:** a nova plataforma é uma fundação apropriada para migração, mas
não substitui funcionalmente o legado. A migração deve ser por vertical slice,
nunca por cópia literal de tabelas ou componentes.

O [ledger rastreável](LEGACY_MIGRATION_LEDGER.md) é obrigatório para qualquer
implementação ou carga: cada linha define o conjunto de ativos, decisão,
destino, gate, release, dono e evidência de uso. O
[protocolo de ETL](ETL_MIGRATION_PROTOCOL.md) define a transformação e a
reconciliação; ambos prevalecem sobre estimativas genéricas deste documento.

## O que a nova base já melhora

| Tema | Legado | Nova plataforma |
| --- | --- | --- |
| Isolamento | banco e rotas globais, sem tenant | `Organization`/`Membership`, RLS forçada e `SET LOCAL app.tenant_id` em transação |
| Sessão | sessão vinculada ao usuário global | cookie opaco, hash de token, expiração e organização vinculada |
| Senhas | fluxo existente, porém sem fronteira de plataforma | Argon2id, rate limit, troca obrigatória da senha inicial e validação HTTP estável |
| Banco | patches idempotentes no boot | migrations forward-only e roles separadas de migrator/runtime |
| Assíncrono | scheduler e integrações acopladas na API | schema de outbox, Kafka e worker separados; dispatcher ainda pendente |
| Deploy | imagem e stack acopladas | API, web, migration job, worker, PostgreSQL e Redis isolados no Dokploy |

## Matriz de capacidades

`Estado atual` descreve código executável, não apenas intenção arquitetural.

| Domínio legado | Evidências no legado | Estado atual | Destino na nova plataforma | Prioridade |
| --- | --- | --- | --- | --- |
| Identidade e administração | usuários, sessões, grupos, permissões de página | bootstrap/login/sessão/membership básicos | convites, troca de organização, gestão de membros e capabilities por recurso | P0 |
| Form builder | `forms`, campos, permissões, respostas, tratativa, exportação | ausente | `forms`, versões imutáveis, campos/validações, publicação e `submissions` | P0 |
| Arquivos | uploads, anexos de formulário/evento/BASH | ausente | upload intent, `FileAsset`, URL assinada, verificação e retenção | P0 |
| Eventos de segurança | eventos, fotos, classificação e ações | ausente | `safety-events`, classificação canônica, evidências e ações | P1 |
| BASH | cartões, comentários, anexos e board settings | ausente | `bash-board` sobre comentários, anexos e eventos de domínio | P1 |
| Gestão de mudanças | seis etapas, riscos e aprovações | ausente | máquina de estados, riscos e aprovações auditadas | P1 |
| HHT/Taxas | empresas, relatórios, janelas e consolidação | ausente | `hht`, regras puras, períodos e autorização de exceção | P1 |
| Listas e configurações | dropdowns, settings, moderadores | somente `TenantSetting` genérico | catálogo de opções por tenant e administração auditada | P1 |
| Integrações | R2, WhatsApp, Smartsheet, Resend, OpenAI, webhooks, BI | schema de outbox e consumer esqueleto | adaptadores com segredos, idempotência, retries e DLQ | P1 |
| Dashboards e TV | dashboards, widgets, displays e playlists | ausente | analytics autorizado, widgets versionados e publicação controlada | P2 |
| Monitoramento | métricas de servidor e versões | health/readiness | métricas, tracing, alertas e runbooks por tenant/integração | P2 |

## Decisões de não migração literal

- Não transportar o executor SQL administrativo do legado. A nova plataforma
  não executará SQL livre em nome de um usuário.
- Não expor `/uploads` como diretório público. Arquivos serão privados por
  padrão e liberados por URL curta assinada após autorização.
- Não reutilizar slugs globais como controle de acesso. Publicações terão
  escopo de organização, estado, expiração e revogação.
- Não armazenar chaves de fornecedores em JSON de configuração devolvido pela
  API. Segredos serão tratados por adaptador e cofre/variáveis do runtime.
- Não migrar tabelas nem dados antes da aprovação explícita da atribuição de
  cada registro e arquivo a uma organização.

## Plano de entrega verificável

### Fase 0 — descoberta e contrato de migração

1. Confirmar quais fluxos do legado estão ativos, seus donos, retenção, volume
   e exposição pública.
2. Produzir inventário origem → organização → destino, incluindo exceções de
   dados órfãos, usuários compartilhados e arquivos sem dono.
3. Aprovar ADRs de autorização por recurso, arquivos, integrações, retenção,
   publicação pública e corte/rollback.

**Gate:** nenhuma carga de dados começa sem matriz de atribuição aprovada.

### Fase 1 — autorização operacional

1. Gestão de membros, convites, suspensão e seleção de organização.
2. Capabilities e `ResourceGrant` por recurso, com testes A→B→A em conexão
   reutilizada.
3. Ativar, no CI, os testes de integração PostgreSQL/RLS hoje pulados no
   ambiente local.

**Gate:** usuário de A não enumera nem acessa recurso de B, inclusive por URL
pública, arquivo, exportação e job.

### Fase 2 — formulário, respostas e arquivos

1. Formulário versionado, campos usados no piloto, regras e publicação.
2. Submissão idempotente, permissões, tratativa pai-filho e exportação.
3. Upload intent e ciclo de `FileAsset` (`pending` → `quarantined` → `ready`)
   com autorização no download.

**Gate:** um tenant cria, publica, responde, anexa, consulta e exporta sem
vazamento; resposta antiga é interpretada pela versão publicada original.

### Fase 3 — operações

Migrar, nesta ordem salvo evidência de negócio contrária: Eventos/BASH,
Gestão de Mudanças e HHT. Cada domínio recebe API versionada, RLS, auditoria,
testes de regra e ETL reexecutável por organização.

### Fase 4 — analytics e integrações

Implementar dispatcher de outbox, idempotência, retry, DLQ e telemetria antes
de habilitar R2, WhatsApp, Smartsheet, IA, webhooks e BI. Dashboards/TV só
consomem fontes autorizadas e consultas predefinidas.

### Fase 5 — piloto e corte

Executar carga de um tenant, reconciliar contagens/checksums/arquivos, aceitar
o fluxo com o dono operacional, fazer freeze e delta. Rollback volta tráfego
ao legado; nunca sobrescreve dados legados.

## Backlog inicial

| Ordem | Entrega | Evidência de conclusão |
| --- | --- | --- |
| 1 | capabilities, membros, convite e troca de organização | matriz de autorização e testes de isolamento ativos |
| 2 | form builder e submissões | fluxo browser privado/público e versão imutável testados |
| 3 | arquivos seguros | upload/download autorizados, checksum e limpeza testados |
| 4 | eventos e BASH | regras e anexos por tenant reconciliados |
| 5 | mudanças e HHT | transições/cálculos testados com casos de fronteira |
| 6 | outbox e integrações | replay idempotente, DLQ e alertas operacionais |
| 7 | dashboards/TV | consultas autorizadas e publicação revogável |

## Critérios para declarar substituição

Só será correta uma nota de paridade alta após os fluxos aprovados terem: (1)
isolamento multi-tenant automatizado; (2) dados e arquivos reconciliados por
organização; (3) integrações observáveis e idempotentes; (4) piloto aceito;
e (5) rollback ensaiado. A qualidade da fundação ou de um plano não substitui
esses critérios.
