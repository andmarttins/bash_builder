# Regras arquiteturais da fundação

## Acesso a dados tenant-scoped

Nenhum módulo de domínio injeta `PrismaService` diretamente. Cada módulo futuro expõe repositórios internos que recebem `TenantContext` e executam consultas por `TenantTransactionService.withTenantTransaction`. A identidade resolve a sessão e a membership ativa no servidor; o futuro guard de rotas de domínio construirá esse contexto exclusivamente a partir dessa sessão. Cabeçalhos, IDs e slugs enviados pelo cliente não são fonte de autorização.

`PrismaService` é infraestrutura da plataforma, não uma dependência de controllers/casos de uso. A revisão de código e a regra de lint de arquitetura a serem adicionadas junto ao primeiro módulo de domínio devem impedir importação direta fora de `platform/database` e `platform/tenant`.

## Outbox

Nenhum endpoint ou caso de uso faz comunicação externa. O primeiro módulo que publicar `OutboxEvent` deve entregar na mesma mudança o dispatcher com claim/lease, publicação Kafka, retries, `ProcessedMessage`, DLQ e telemetria. Até isso existir, a tabela é somente fundação e nenhum evento de negócio é escrito nela.

## Identidade

`identity_users` não é acessível diretamente pela role `app_runtime`. O módulo de identidade usa somente funções `SECURITY DEFINER` estreitas, executadas como `app_migrator`: status do bootstrap, criação única do primeiro administrador, lookup de login, criação/resolução/revogação de sessão. A API nunca retorna hashes e o runtime não recebe `SELECT` em `identity_users` nem em `auth_sessions`.
