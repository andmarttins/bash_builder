# ADR pendente — configuração do quadro BASH

O único `BashBoardSetting` do baseline legado armazenava um grupo de WhatsApp
e um booleano de notificação. Ele não definia colunas, ordenação alternativa,
SLA ou política local de quadro.

O novo quadro já possui estágios canônicos, ordenação transacional por posição,
comentários, anexos privados, auditoria e outbox. Não será criado um setting
por tenant sem consumidor aprovado.

O vínculo com WhatsApp fica fora de escopo até que o adapter seja aprovado:
serão necessários referência de segredo externa, destino tenant-scoped,
assinatura/contrato de evento, retry, DLQ, métricas, revogação e runbook.
Nenhum ID de grupo ou token legado será migrado.

Se o negócio aprovar configuração adicional, a ADR deve definir o comportamento
por tenant, papel que o altera, valores permitidos, impacto em cartões já
existentes, auditoria e rollback. Até lá, os cinco estágios atuais são a fonte
de verdade.
