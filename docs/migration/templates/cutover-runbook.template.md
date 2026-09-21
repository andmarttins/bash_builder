# Runbook de corte por tenant

> Template sem dados de produção. Preencha e aprove fora do Git os IDs e
> evidências referenciados na carta de piloto.

## Pré-condições

- Carta `ACTIVE` aprovada por negócio, segurança, privacidade e operação.
- Snapshot, watermark/CDC, versão de transformador e checkpoint validados.
- Plano de identidade, storage, exceções e reconciliação aprovados.
- RPO/RTO, feature flags, janela de freeze e critério de retorno confirmados.

## Execução

1. Habilitar observabilidade e registrar início da janela.
2. Aplicar write fencing/read-only no legado para as capacidades no corte.
3. Extrair e aplicar delta idempotente desde o último checkpoint.
4. Executar reconciliação, smoke tests, jobs pendentes/DLQ e validação do dono.
5. Alternar feature flags por tenant/capacidade e monitorar contra RPO/RTO.

## Retorno e pós-corte

Desfazer o roteamento somente conforme a política de compensação aprovada.
Depois de escrita no novo sistema, não descartar dados nem retornar ao legado
sem reconciliação/compensação explícita. Registrar fim, exceções, aprovação e
retenção dos extratos externos.
