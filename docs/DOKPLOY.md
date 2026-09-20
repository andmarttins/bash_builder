# Instalação inicial no Dokploy

## Topologia

Use três serviços independentes no mesmo ambiente. A aplicação usa duas redes com finalidades distintas:

- `dokploy-network` é a rede externa compartilhada somente por PostgreSQL, Redis, `db-bootstrap`, `migrate`, API e worker.
- `platform-internal` é privada ao Compose para `web` ↔ API, worker ↔ Redpanda e Redpanda. O broker Kafka em PLAINTEXT nunca é anexado à rede global.

| Serviço | Tipo | Função | Exposição pública |
| --- | --- | --- | --- |
| `builder-postgres` | Database / PostgreSQL 18 | dados, RLS e migrations | nenhuma |
| `builder-redis` | Redis | cache e coordenação distribuída | nenhuma |
| `Builder Solutions Platform` | Compose | `db-bootstrap`, `migrate`, API, worker, web e Redpanda | somente `web:80` |

Os Dockerfiles da aplicação ficam em `infra/docker/`. PostgreSQL e Redis não fazem parte do `docker-compose.yml`: o Compose acessa-os somente pelas Internal Connection URLs exibidas pelo Dokploy. O arquivo anexa somente os consumidores de dados a `dokploy-network`; confirme no **Preview Compose** e nos detalhes de Connection que as duas Database services, `db-bootstrap`, `migrate`, API e worker aparecem nessa rede. Isso permite backup, atualização e rotação de credenciais de dados sem recriar os containers da aplicação.

## Criar serviços de dados

1. No ambiente `production`, crie uma Database PostgreSQL 18 chamada `builder-postgres`, no servidor `bash-mcp-hub`. Use o banco inicial `builder`, mantenha a porta apenas interna e ative o volume persistente.
2. Crie um serviço Redis chamado `builder-redis`, também interno e persistente. Não publique a porta Redis.
3. Configure backup/PITR, retenção e teste de restauração no PostgreSQL antes de cadastrar dados reais. Redis não é fonte de verdade; configure a persistência conforme a política de cache/fila adotada.

O usuário administrador da Database é usado exclusivamente pelo job de bootstrap. Se o Dokploy não criar o banco `builder` automaticamente, crie-o no serviço PostgreSQL antes do primeiro deploy. Após criar cada serviço, copie da aba **Connection** o Internal Host/Connection URL; não suponha que o nome informado no formulário seja o hostname Docker.

## Serviço Compose

Crie um serviço do tipo **Compose**, apontando para este repositório, branch de implantação e `docker-compose.yml`. A exposição externa deve ser somente do serviço `web`, na porta interna `80`. Configure domínio e TLS no Dokploy; o proxy do Dokploy termina HTTPS.

PostgreSQL, Redis e os consumidores de dados ficam somente em `dokploy-network`; API e worker também usam a rede privada `platform-internal`. Redpanda e web usam somente a rede privada. Para publicar web, use a aba **Domains** do Dokploy: ela anexa apenas o serviço selecionado ao proxy. Antes do deploy, use **Preview Compose** para confirmar a associação de redes. Caso uma integração externa exija API, crie domínio exclusivo para ela e limite CORS/origins, autenticação e rate limits antes de expor.

## Variáveis e segredos

Cadastre os valores de `.env.example` na interface Environment do serviço Compose. Gere senhas longas e únicas; não use arquivo `.env` nem secrets em Git.

- `BOOTSTRAP_DATABASE_URL`: URL interna de administrador do PostgreSQL, direcionada ao banco `builder`. É montada somente no `db-bootstrap`, que termina após criar/atualizar os papéis limitados.
- `MIGRATOR_DATABASE_URL`: URL interna de `app_migrator`. Ela é usada somente por `migrate` e possui `CREATE` de schema para aplicar migrations.
- `DATABASE_URL`: URL interna de `app_runtime`, usada somente pela API e limitada por RLS ao tenant da sessão.
- `WORKER_DATABASE_URL`: URL interna de `app_worker`, usada somente pelo worker. Esta role não é proprietária, não tem `BYPASSRLS` e só pode acessar a fila por procedimentos armazenados; não reutilize `DATABASE_URL`.

## Armazenamento de objetos privado

O serviço S3 compatível deve permanecer sem domínio público. A API recebe os bytes autenticados e os encaminha para o endpoint interno; por isso não há CORS de navegador nem URL S3 exposta ao cliente. Para ativar uploads, configure na aplicação **os cinco valores** abaixo usando o endpoint interno do serviço, sem salvá-los no Git:

```env
S3_ENDPOINT=http://<host-interno>:9000
S3_REGION=us-east-1
S3_BUCKET=builder-assets
S3_ACCESS_KEY_ID=<credencial-de-runtime>
S3_SECRET_ACCESS_KEY=<segredo-de-runtime>
```

Se algum deles ficar vazio, a API preserva os arquivos como pendentes e informa que o adaptador não está configurado; ela nunca grava credenciais em `integrations.config`.
- `REDIS_URL`: URL interna **autenticada** (`redis://` ou `rediss://`) do `builder-redis`, usada pela API. Nunca aponte para um endpoint público. A configuração da API rejeita URL sem senha ou com protocolo diferente.
- `BOOTSTRAP_TOKEN`: segredo aleatório de ao menos 32 caracteres, obrigatório em produção. Ele é enviado uma única vez, no formulário de primeira configuração, e impede que o primeiro visitante público assuma a conta OWNER. Cadastre-o como secret; não use URL, senha de banco ou token reaproveitado.

O segredo de bootstrap entra somente na API e não entra em `migrate` ou worker. Não inverta as credenciais de migrator e runtime: executar aplicação com a credencial migrator tornaria RLS inefetivo. Mantenha o segredo de bootstrap fora de runbooks de aplicação e faça sua rotação em procedimento controlado.

## Ordem do primeiro deploy

1. Crie os dois serviços de dados, confirme em Connection que estão em `dokploy-network`, copie os Internal Connection URLs, defina `APP_ORIGIN` com as origens HTTPS públicas exatas do web, separadas por vírgula quando houver mais de uma, e gere `BOOTSTRAP_TOKEN` no cofre de senhas. A variante HTTPS convencional `www` do domínio primário é aceita automaticamente.
2. Preencha todas as variáveis no Compose, configure o domínio do `web` e use Preview Compose para confirmar: dados + jobs + API/worker em `dokploy-network`; web, API, worker e Redpanda em `platform-internal`.
3. Confirme que `db-bootstrap` terminou com sucesso. Ele é idempotente e cria os papéis `app_migrator` e `app_runtime` no PostgreSQL separado.
4. Confirme que `migrate` terminou com sucesso. Ele aplica migrations uma única vez e é pré-requisito de API e worker.
5. Teste no próprio serviço Redis que a conexão autenticada funciona e que uma conexão sem senha recebe `NOAUTH`. Confira `https://SEU_DOMINIO/health` (liveness do web), `https://SEU_DOMINIO/api/health` (liveness da API) e `https://SEU_DOMINIO/api/ready` (readiness de PostgreSQL e Redis). O worker só fica saudável depois de conectar ao banco e broker.
6. Abra o domínio em uma janela privada. Sem usuário cadastrado, a página deve apresentar **Primeira configuração**; informe `BOOTSTRAP_TOKEN`, crie o primeiro administrador e confirme que ela entra no painel. Em seguida, saia e entre novamente para validar a sessão. Não use credenciais reais de produção em capturas de tela ou logs. Depois do sucesso, mantenha o segredo protegido e faça sua rotação por procedimento controlado.
7. Confirme backups, volumes, alertas e logs antes de cadastrar dados reais.

## Releases posteriores

Cada release executa `db-bootstrap` (idempotente) e `migrate` antes da API. Migrations seguem expand–migrate–contract: não há DDL no boot nem rollback destrutivo automático. Antes de uma migration de contração, crie backup e ensaie restore em ambiente isolado.

## Limites conhecidos desta fundação

- Redpanda é o broker Kafka-compatível para a primeira instalação. Para produção de maior criticidade, trocar por Kafka gerenciado exige TLS/SASL, ACL, retenção, re-drive de DLQ e observabilidade de lag antes do corte.
- Redis está conectado e compõe a readiness da API. O login usa contadores distribuídos por IP e e-mail; cache de domínio permanece futuro.
- O worker publica a outbox transacional em `builder.domain-events.v1`, aplica retry exponencial com lease, persiste o último erro, move falhas esgotadas para `DEAD_LETTER` e registra recibo idempotente por consumer. O re-drive exige procedimento operacional autenticado; antes de ligar um provedor externo, inclua seu consumer e métrica de atraso.
