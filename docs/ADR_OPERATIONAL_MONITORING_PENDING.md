# ADR pendente — monitoramento operacional restrito

## Contexto

O módulo legado `/monitoring` recebia amostras de CPU, memória e disco do host,
mantinha somente a última amostra em memória e a transmitia por WebSocket para
usuários administrativos. Esse desenho não oferece retenção, não é uma fonte
confiável para incidentes e mistura telemetria de infraestrutura com a
interface do produto.

O runtime novo já oferece health/readiness protegidos, métricas internas da API
e do worker e um resumo operacional da outbox por tenant. O indicador e o
procedimento de fila estão em `METRICS_ALERTS.md` e `OPERATIONS_RUNBOOK.md`.

## Decisão atual

Não migrar o endpoint, o WebSocket ou os cartões de CPU/memória/disco do
legado para usuários do produto. A substituição aprovada para a release é:

- métricas de runtime acessíveis somente pela infraestrutura autorizada;
- health checks e readiness para API, worker, PostgreSQL, Redis e broker;
- alertas de disponibilidade, taxa de erro, worker, outbox, DLQ e leases;
- resumo de fila estritamente tenant-scoped para OWNER e ADMIN, sem payloads;
- diagnóstico e recuperação pelo runbook operacional.

Essa decisão não autoriza expor métricas de host, logs brutos, comandos de
executor ou dados de outros tenants na aplicação.

## Decisões necessárias antes de produção

O responsável de operação deve aprovar e registrar:

1. a plataforma que coletará as métricas restritas e quem pode acessá-la;
2. SLOs formais, dependências consideradas na disponibilidade e janelas de
   manutenção;
3. roteamento de alertas, cobertura de plantão, escalonamento e responsável por
   cada alerta;
4. retenção de métricas, logs e trilhas de auditoria, de acordo com requisitos
   legais e de privacidade;
5. critérios de backup, capacidade e alertas de infraestrutura do Compose do
   Builder Solutions.

Até esses itens terem dono, evidência e aceite, o monitoramento de
infraestrutura continua uma responsabilidade operacional externa, não uma
funcionalidade administrativa do produto.

## Consequências e rollback

O corte não exige migration nem remove dados de negócio. Em caso de reversão da
interface, a versão anterior pode ser publicada, mas isso não torna a última
amostra em memória um registro histórico ou um substituto para observabilidade
de infraestrutura. Nenhum segredo, endpoint de métricas ou acesso de host deve
ser copiado para a configuração de tenant.
