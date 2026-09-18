# Instalação inicial no Dokploy

## Serviço

Crie um projeto no Dokploy e adicione um serviço do tipo **Compose**, apontando para este repositório e para `docker-compose.yml`. A exposição externa deve ser apenas do serviço `web`, na porta interna `80`. Configure o domínio e TLS no Dokploy; o proxy do Dokploy termina HTTPS.

O `api`, PostgreSQL e Redpanda ficam somente na rede interna do Compose. Caso uma integração externa exija a API, crie domínio exclusivo para ela e limite CORS/origins, autenticação e rate limits antes de expor.

## Variáveis e segredos

Cadastre os valores de `.env.example` na interface de Environment do Dokploy. Gere senhas longas e únicas. `POSTGRES_PASSWORD`, `APP_MIGRATOR_DB_PASSWORD` e `APP_RUNTIME_DB_PASSWORD` devem ser segredos distintos. Derive as duas URLs com URL encoding de credenciais quando necessário.

`POSTGRES_USER` é apenas o usuário superusuário de bootstrap: sua senha não entra em `migrate`, API ou worker. `MIGRATOR_DATABASE_URL` usa `app_migrator`; `DATABASE_URL` usa `app_runtime`. Não inverta as credenciais: a API/worker com migrator tornaria RLS inefetivo. Não use arquivo `.env` nem secrets em Git.

Guarde a senha de bootstrap exclusivamente no ambiente do banco. Depois da inicialização confirmada, mantenha-a fora de runbooks de aplicação e faça a rotação em procedimento controlado; ela nunca é uma variável dos containers `migrate`, `api` ou `worker`.

## Ordem do primeiro deploy

1. Defina domínio de `web`, `APP_ORIGIN` com `https://` e todas as variáveis.
2. Faça o deploy. O container `postgres` cria o usuário runtime somente ao inicializar um volume novo.
3. Verifique que `migrate` terminou com sucesso. Ele aplica migrations uma única vez e é pré-requisito de `api` e `worker`.
4. Confira `https://SEU_DOMINIO/health` (liveness do web), `https://SEU_DOMINIO/api/health` (liveness da API) e `https://SEU_DOMINIO/api/ready` (readiness com banco). O worker só fica saudável depois de conectar tanto ao banco quanto ao broker.
5. Confirme volumes persistentes, backup PostgreSQL/PITR e alertas de containers antes de cadastrar dados reais.

## Releases posteriores

Cada release executa `migrate` antes da API. Migrations seguem expand–migrate–contract: não há DDL no boot nem rollback destrutivo automático. Antes de uma migration de contração, crie backup e ensaie restore em ambiente isolado.

## Limites conhecidos desta fundação

- Redpanda é o broker Kafka-compatível para a primeira instalação. Para produção de maior criticidade, trocar por Kafka gerenciado exige TLS/SASL, ACL, retenção, re-drive de DLQ e observabilidade de lag antes do corte.
- Este compose não cria backup automaticamente. Configurar backup/PITR externo é condição para uso real.
- O worker consome o tópico `builder.domain-events.v1`, mas o dispatcher/outbox será entregue junto ao primeiro módulo que emita efeitos assíncronos.
