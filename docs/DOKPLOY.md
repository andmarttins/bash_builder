# Instalação inicial no Dokploy

## Topologia

Use três serviços independentes no mesmo ambiente e na mesma rede interna do Dokploy:

| Serviço | Tipo | Função | Exposição pública |
| --- | --- | --- | --- |
| `builder-postgres` | Database / PostgreSQL 18 | dados, RLS e migrations | nenhuma |
| `builder-redis` | Redis | cache e coordenação distribuída | nenhuma |
| `Builder Solutions Platform` | Compose | `db-bootstrap`, `migrate`, API, worker, web e Redpanda | somente `web:80` |

Os Dockerfiles da aplicação ficam em `infra/docker/`. PostgreSQL e Redis não fazem parte do `docker-compose.yml`: o Compose acessa-os somente por hostnames internos e URLs injetadas pelo ambiente. Isso permite backup, atualização e rotação de credenciais de dados sem recriar os containers da aplicação.

## Criar serviços de dados

1. No ambiente `production`, crie uma Database PostgreSQL 18 chamada `builder-postgres`, no servidor `bash-mcp-hub`. Use o banco inicial `builder`, mantenha a porta apenas interna e ative o volume persistente.
2. Crie um serviço Redis chamado `builder-redis`, também interno e persistente. Não publique a porta Redis.
3. Configure backup/PITR, retenção e teste de restauração no PostgreSQL antes de cadastrar dados reais. Redis não é fonte de verdade; configure a persistência conforme a política de cache/fila adotada.

O usuário administrador da Database é usado exclusivamente pelo job de bootstrap. Se o Dokploy não criar o banco `builder` automaticamente, crie-o no serviço PostgreSQL antes do primeiro deploy.

## Serviço Compose

Crie um serviço do tipo **Compose**, apontando para este repositório, branch de implantação e `docker-compose.yml`. A exposição externa deve ser somente do serviço `web`, na porta interna `80`. Configure domínio e TLS no Dokploy; o proxy do Dokploy termina HTTPS.

O `api`, worker, PostgreSQL, Redis e Redpanda ficam somente na rede interna. Caso uma integração externa exija API, crie domínio exclusivo para ela e limite CORS/origins, autenticação e rate limits antes de expor.

## Variáveis e segredos

Cadastre os valores de `.env.example` na interface Environment do serviço Compose. Gere senhas longas e únicas; não use arquivo `.env` nem secrets em Git.

- `BOOTSTRAP_DATABASE_URL`: URL interna de administrador do PostgreSQL, direcionada ao banco `builder`. É montada somente no `db-bootstrap`, que termina após criar/atualizar os papéis limitados.
- `MIGRATOR_DATABASE_URL`: URL interna de `app_migrator`. Ela é usada somente por `migrate` e possui `CREATE` de schema para aplicar migrations.
- `DATABASE_URL`: URL interna de `app_runtime`. Ela é usada apenas por API e worker, sem propriedade das tabelas e sem `BYPASSRLS`.
- `REDIS_URL`: URL interna autenticada do `builder-redis`, usada pela API. Nunca aponte para um endpoint público.

O segredo de bootstrap não entra em `migrate`, API ou worker. Não inverta as credenciais de migrator e runtime: executar aplicação com a credencial migrator tornaria RLS inefetivo. Mantenha o segredo de bootstrap fora de runbooks de aplicação e faça sua rotação em procedimento controlado.

## Ordem do primeiro deploy

1. Crie os dois serviços de dados, confirme seus hostnames internos e defina `APP_ORIGIN` como o domínio HTTPS final do web.
2. Preencha todas as variáveis no Compose e faça o deploy.
3. Confirme que `db-bootstrap` terminou com sucesso. Ele é idempotente e cria os papéis `app_migrator` e `app_runtime` no PostgreSQL separado.
4. Confirme que `migrate` terminou com sucesso. Ele aplica migrations uma única vez e é pré-requisito de API e worker.
5. Confira `https://SEU_DOMINIO/health` (liveness do web), `https://SEU_DOMINIO/api/health` (liveness da API) e `https://SEU_DOMINIO/api/ready` (readiness de PostgreSQL e Redis). O worker só fica saudável depois de conectar ao banco e broker.
6. Confirme backups, volumes, alertas e logs antes de cadastrar dados reais.

## Releases posteriores

Cada release executa `db-bootstrap` (idempotente) e `migrate` antes da API. Migrations seguem expand–migrate–contract: não há DDL no boot nem rollback destrutivo automático. Antes de uma migration de contração, crie backup e ensaie restore em ambiente isolado.

## Limites conhecidos desta fundação

- Redpanda é o broker Kafka-compatível para a primeira instalação. Para produção de maior criticidade, trocar por Kafka gerenciado exige TLS/SASL, ACL, retenção, re-drive de DLQ e observabilidade de lag antes do corte.
- Redis está conectado e compõe a readiness da API. Cache de domínio e rate limit distribuído serão ativados com os módulos que os consumirem.
- O worker consome o tópico `builder.domain-events.v1`, mas o dispatcher/outbox será entregue junto ao primeiro módulo que emita efeitos assíncronos.
