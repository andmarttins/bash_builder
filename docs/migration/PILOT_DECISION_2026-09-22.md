# Decisão de escopo do piloto — 22/09/2026

Decisão registrada sob autorização do responsável pelo projeto. Ela define o
escopo a preparar; não inventa tenant, aprovações, dados de produção nem
autoriza carga, corte ou alteração no ambiente de produção.

## F1 — piloto e dados

- Executar um piloto com **uma organização representativa**, escolhida pelo
  responsável operacional quando o acesso aos dados for liberado.
- Migrar somente identidade/memberships, formulários e submissões, eventos,
  mudanças, BASH, HHT, anexos privados e o webhook já suportado.
- Excluir telemetria de host, segredos, adapters não implementados e qualquer
  ativo sem decisão de destino no ledger.
- Classificar as evidências como `CONFIDENTIAL`, manter o legado em leitura
  durante o período de retenção aprovado e usar RPO de 15 minutos e RTO de 60
  minutos como metas iniciais do ensaio.

## F2 — funcional e autorização

- Manter RBAC central (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) como única regra
  de autorização do piloto; `ResourceGrant` fica fora do escopo.
- Não criar configurações tenant-scoped além de classificações de eventos.
- Não adicionar deltas de formulários, exportação assíncrona de mudanças ou
  configuração local de BASH sem evidência de necessidade no piloto.
- Aplicar a regra HHT existente; totais precisam reconciliar sem tolerância
  automática. Qualquer diferença vira exceção aprovada.

## F3 — integrações e operação

- Homologar somente o adapter `WEBHOOK` já implementado; não ativar e-mail,
  WhatsApp, Smartsheet, IA ou BI neste piloto.
- Reprovisionar o segredo fora do banco, exercitar timeout, idempotência,
  retry, DLQ e re-drive com o destino homologado.
- Usar health/readiness e as métricas internas já existentes. Definir antes do
  corte o canal de incidente, responsável de plantão, alertas de DLQ/outbox e
  retenção de logs/métricas.

## F4 e F5 — qualidade e corte

- F4 só recebe baixa com CI integral verde e revisão crítica independente
  maior ou igual a 9/10.
- O corte terá dual-run, freeze, delta final, reconciliação por domínio e
  rollback por retorno de tráfego ao legado; não haverá rollback destrutivo de
  dados novos.

## Evidências ainda obrigatórias

Antes de executar o piloto, registrar no charter a organização real, donos de
negócio/segurança/privacidade/operação, volumes, retenção, mapeamento
legacy→target, hashes, destino do webhook, canal de incidente, aprovações e
janela de corte. O formato obrigatório está em
`docs/migration/templates/pilot-charter.example.json`.
