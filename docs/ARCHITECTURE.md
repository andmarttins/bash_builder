# Regras arquiteturais da fundação

## Acesso a dados tenant-scoped

Nenhum módulo de domínio injeta `PrismaService` diretamente. Cada módulo futuro expõe repositórios internos que recebem `TenantContext` e executam consultas por `TenantTransactionService.withTenantTransaction`. O guard de autenticação futuro constrói esse contexto exclusivamente a partir de sessão, membership ativa e domínio/organização autorizados; cabeçalhos, IDs e slugs enviados pelo cliente não são fonte de autorização.

`PrismaService` é infraestrutura da plataforma, não uma dependência de controllers/casos de uso. A revisão de código e a regra de lint de arquitetura a serem adicionadas junto ao primeiro módulo de domínio devem impedir importação direta fora de `platform/database` e `platform/tenant`.

## Outbox

Nenhum endpoint ou caso de uso faz comunicação externa. O primeiro módulo que publicar `OutboxEvent` deve entregar na mesma mudança o dispatcher com claim/lease, publicação Kafka, retries, `ProcessedMessage`, DLQ e telemetria. Até isso existir, a tabela é somente fundação e nenhum evento de negócio é escrito nela.

## Identidade

`identity_users` pertence ao futuro módulo de identidade e não é acessível pela role `app_runtime`. O módulo de autenticação introduzirá operações mínimas de login e sessão, com políticas/funções específicas revisadas; nunca concederá leitura genérica da tabela ou de `password_hash` ao runtime.

