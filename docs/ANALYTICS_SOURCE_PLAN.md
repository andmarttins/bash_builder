# Fontes analíticas autorizadas

## Escopo do próximo incremento

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
3. Filtros aceitos serão estritamente validados e limitados a período/status.
4. Widgets públicos continuam estáticos; somente um snapshot explicitamente
   publicado poderá carregar valores analíticos aprovados.
5. Toda alteração de widget/fonte invalida publicações de Display e Playlist.

## Gates

- contrato HTTP e autorização por capability;
- RLS A/B para cada consulta;
- testes de cálculo e limites de filtro;
- auditoria/outbox para mudanças de fonte e publicação;
- sem SQL arbitrário ou segredo em payloads/logs.
