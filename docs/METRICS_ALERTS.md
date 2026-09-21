# Métricas e alertas operacionais

## Exposição segura

As métricas usam o formato Prometheus e só são habilitadas se
`METRICS_TOKEN` estiver configurado como secret de pelo menos 32 caracteres.
Sem ele, `http://api:3000/metrics` retorna 404 e o endpoint interno do worker
não inicia. Nunca publique esses endpoints em um domínio externo; o proxy web
bloqueia explicitamente `/api/metrics`.

- API: `GET http://api:3000/metrics`, pela rede interna, com
  `Authorization: Bearer <METRICS_TOKEN>`.
- Worker: `GET http://worker:<WORKER_METRICS_PORT>/metrics`, pela rede interna, com o mesmo
  header. A porta configurada em `WORKER_METRICS_PORT` não é exposta pelo proxy público.

Os rótulos são deliberadamente limitados a rota estática, método e status. Não
incluem tenant, URL de webhook, payload, e-mail, segredo ou mensagem de erro.

## Sinais e alertas iniciais

| Sinal | Condição de alerta | Severidade | Primeira ação |
| --- | --- | --- | --- |
| `builder_api_up` | ausente por 2 minutos | crítica | confirmar `/health`, `/ready`, logs e dependências internas |
| `builder_worker_up` | ausente por 2 minutos | crítica | confirmar health do worker, banco e broker |
| `builder_api_http_requests_total` | taxa de 5xx acima de 2% por 10 minutos | alta | verificar rota, readiness e erros sem copiar dados sensíveis |
| `builder_worker_events_total{outcome="outbox_failed"}` | cresce continuamente por 10 minutos | alta | verificar a saúde operacional e aguardar o backoff antes de re-drive |
| `builder_worker_events_total{outcome="webhook_failed"}` | cresce continuamente por 10 minutos | alta | verificar a integração ativa e o destino; não registrar segredo ou URL completa |

Os alertas de backlog, DLQ e lease vencido continuam no resumo operacional
tenant-scoped. Eles devem acionar quando o SLI estiver `CRITICAL`; use a tela
**Saúde operacional** e o [runbook de operações](OPERATIONS_RUNBOOK.md).

## Smoke de release

1. Confirme web, API e worker saudáveis.
2. Com uma credencial de scrape aprovada, obtenha `http://api:3000/metrics` e
   `http://worker:<WORKER_METRICS_PORT>/metrics`; confirme
   `builder_api_up 1` e `builder_worker_up 1`.
3. Sem o header ou com token inválido, confirme 404.
4. Confira que nenhuma série inclui identificador de tenant, endpoint ou erro.
5. Registre o resultado do smoke, versão e horário no ticket de release.
