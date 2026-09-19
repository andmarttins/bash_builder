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
2. Inicie PostgreSQL, Redis e Redpanda como serviços locais independentes e configure as URLs no `.env`. O Compose desta base não cria PostgreSQL nem Redis.
3. Instale dependências: `npm install`.
4. Gere o cliente e aplique migrations: `npm run db:generate` e `npm run db:deploy`.
5. Rode `npm run dev:api`, `npm run dev:worker` e `npm run dev:web` em terminais separados.

Validações: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.

## Primeiro deploy no Dokploy

1. Crie PostgreSQL 18 e Redis como serviços independentes do Dokploy, sem portas públicas. Crie também o banco `builder` no PostgreSQL.
2. Crie um serviço **Compose** a partir deste repositório e selecione `docker-compose.yml`. Configure no Dokploy as variáveis de `.env.example`; use secrets, não arquivo `.env` no Git.
3. Use somente os hostnames internos dos serviços separados nas URLs PostgreSQL e Redis. `BOOTSTRAP_DATABASE_URL` fica disponível apenas para o job `db-bootstrap`; nunca para API, worker ou `migrate`.
4. Crie domínio HTTPS para `web` (porta interna `80`). A API fica interna; exponha-a apenas se houver integração externa, com domínio próprio. Em `APP_ORIGIN`, informe as origens públicas exatas, separadas por vírgula quando houver mais de uma; a variante HTTPS convencional `www` do domínio principal também é aceita automaticamente.
5. No primeiro deploy, `db-bootstrap` cria os papéis limitados, `migrate` aplica o schema e então API, worker, web e Redpanda iniciam. Verifique a conclusão dos dois jobs.
5. Antes de subir, gere e cadastre `BOOTSTRAP_TOKEN` com pelo menos 32 caracteres no segredo do Compose. Depois de validar health checks, abra o domínio HTTPS. Enquanto não houver usuários, a tela **Primeira configuração** pede esse código e cria de forma atômica a primeira organização e seu administrador OWNER/SUPERADMIN; não existe seed nem credencial padrão. A senha informada nesse passo é temporária: após autenticar, a plataforma bloqueia o restante do acesso até que o administrador defina uma senha nova e revoga as demais sessões. Depois disso, a tela passa a exibir o login. Mantenha o segredo protegido e faça sua rotação em procedimento controlado após o primeiro acesso.

O volume `redpanda_data` é persistente. Configure no serviço PostgreSQL separado backup/PITR, retenção e teste de restauração antes de usar dados reais. Produção também requer rotação de segredos e monitoramento de health/lag do worker.

## Segurança já definida na base

- O usuário de bootstrap do PostgreSQL não entra em nenhum container de aplicação. O runtime usa `app_runtime`, sem propriedade das tabelas e sem `BYPASSRLS`; migrations usam `app_migrator`, também sem privilégio de superusuário/BYPASSRLS.
- Dados tenant-owned são protegidos por RLS e o acesso de aplicação deve ocorrer em `withTenantTransaction`, que usa `SET LOCAL app.tenant_id`.
- PostgreSQL e Redis são serviços independentes internos do Dokploy. A API verifica ambos em `/ready`; Redis fica preparado para cache, rate limit distribuído e jobs posteriores.
- O broker é interno no Compose. Nenhuma porta de banco, Redis ou Kafka é publicada no host.
- O primeiro acesso inclui bootstrap único de administrador, login, logout e sessão opaca revogável. Módulos administrativos e formulários de negócio continuam sendo entregas futuras.
