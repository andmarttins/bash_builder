# Fontes analíticas autorizadas

## Estado

Entregue no incremento `analytics-authorized-sources`. O endpoint interno é
`GET /v1/analytics/sources/:source`; ele exige a capability
`dashboards.view` e executa sempre no contexto da organização autenticada.

## Escopo do incremento

Expor somente métricas predefinidas por empresa, calculadas no backend sob
`TenantTransactionService`. O navegador nunca envia SQL, nomes de tabela,
credenciais ou filtros livres.

## Catálogo inicial

| Chave | Origem autorizada | Resultado |
| --- | --- | --- |
| `safety.open_events` | `safety_events` | total de eventos abertos/em revisão |
| `changes.by_status` | `change_requests` | contagem por estado |
| `hht.latest_rates` | `hht_reports` | taxas do último período disponível |
| `bash.by_stage` | `bash_cards` | cartões por etapa |

## Regras

1. Cada consulta recebe a empresa apenas da sessão, nunca do cliente.
2. Cada fonte é uma chave allowlisted com contrato de resposta tipado.
3. Filtros aceitos são estritamente validados: `year` e `month` devem ser
   enviados juntos; `status` só é aceito para Changes e `stage` só para BASH.
   O período é aplicado aos campos de data do domínio em UTC.
4. Widgets públicos continuam estáticos; somente um snapshot explicitamente
   publicado poderá carregar valores analíticos aprovados.
5. Toda alteração de widget/fonte invalida publicações de Display e Playlist.

## Widgets e publicação

Um widget interno pode usar `type: "ANALYTICS"` com `source`, `metric` e
`filters`. A API valida a combinação fonte/métrica/filtro antes de consultar
ou salvar. Ao publicar, esses widgets são resolvidos no servidor e gravados
como métricas estáticas em `dashboards.public_snapshot`.

As rotas públicas e a TV leem apenas esse snapshot; elas nunca recebem a
chave analítica nem fazem consultas às tabelas de operação. Revogar a
publicação remove o snapshot.

## Evoluções de escala

Quando o volume justificar, medir as consultas de período e considerar
índices compostos de organização, estado/etapa e data para Changes e BASH.
O editor visual de métricas e filtros é uma evolução de UX; os painéis novos
já nascem com os quatro widgets autorizados.

## Gates

- contrato HTTP e autorização por capability;
- RLS A/B para cada consulta;
- testes de cálculo e limites de filtro;
- auditoria/outbox para mudanças de fonte e publicação;
- sem SQL arbitrário ou segredo em payloads/logs.
