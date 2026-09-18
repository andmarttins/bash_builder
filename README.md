# Builder Solutions Platform

Base do novo Builder Solutions multi-tenant. O projeto substitui o legado gradualmente e começa por infraestrutura segura e módulos independentes.

## Aplicações

- `apps/api`: API NestJS com Fastify e contrato de contexto de tenant.
- `apps/worker`: worker Nest em application context para consumidores Kafka.
- `apps/web`: React 18, Vite, Tailwind e base shadcn/ui.
- `packages/contracts`: contratos Zod compartilhados entre API, worker e web.
- `prisma`: modelo inicial, RLS e migrations versionadas.

## Desenvolvimento

1. Copie `.env.example` para `.env` e troque todos os valores de senha.
2. Inicie PostgreSQL e Redpanda com `docker compose up -d postgres redpanda`.
3. Instale dependências: `npm install`.
4. Gere o cliente e aplique migrations: `npm run db:generate` e `npm run db:deploy`.
5. Rode `npm run dev:api`, `npm run dev:worker` e `npm run dev:web` em terminais separados.

Validações: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.

## Primeiro deploy no Dokploy

1. Crie um projeto e um serviço **Compose** a partir deste repositório.
2. Selecione `docker-compose.yml`. Configure no Dokploy as variáveis de `.env.example`; use secrets, não arquivo `.env` no Git.
3. Crie domínio HTTPS para `web` (porta interna `80`). A API fica interna; exponha-a apenas se houver integração externa, com domínio próprio e `APP_ORIGIN` exata.
4. Na primeira instalação, execute o serviço `migrate` uma vez e confirme conclusão. Em seguida inicie `api`, `worker`, `web`, `postgres` e `redpanda`.
5. Depois de validar health checks, crie o primeiro tenant pela futura interface administrativa. A base não inclui seed de conta administrativa para evitar credenciais padrão.

`postgres_data` e `redpanda_data` são volumes persistentes. Produção requer backup/PITR do PostgreSQL, backup de objetos quando o storage entrar, rotação de segredos e monitoramento de health/lag do worker.

## Segurança já definida na base

- O usuário de bootstrap do PostgreSQL não entra em nenhum container de aplicação. O runtime usa `app_runtime`, sem propriedade das tabelas e sem `BYPASSRLS`; migrations usam `app_migrator`, também sem privilégio de superusuário/BYPASSRLS.
- Dados tenant-owned são protegidos por RLS e o acesso de aplicação deve ocorrer em `withTenantTransaction`, que usa `SET LOCAL app.tenant_id`.
- O broker é interno no Compose. Nenhuma porta de banco ou Kafka é publicada no host.
- Esta base ainda não contém autenticação, UI administrativa ou formulários: esses módulos serão adicionados sobre os contratos de tenancy e auditoria já versionados.
