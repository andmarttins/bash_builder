# Catálogo de classificações aprovado

O catálogo por tenant disponível nesta etapa é exclusivamente
`event_classification`. Ele alimenta as classificações real e potencial de
eventos de segurança.

- Somente quem possui `operations.manage` pode criar, alterar ou desativar um
  item; a leitura requer `operations.view`.
- `value` é uma chave estável minúscula com hífens. Depois de criado, não é
  alterado, para preservar integrações e os registros históricos que o usam.
- Itens referenciados não são removidos: a desativação impede uso futuro e
  preserva as referências, auditoria e retenção dos eventos existentes.
- Toda alteração exige `expectedVersion`, gera auditoria e outbox, e ocorre
  dentro da transação com RLS do tenant ativo.

Qualquer categoria adicional ou configuração de domínio precisa ser aprovada
e incluída explicitamente no schema, na API e nesta política; a API rejeita
categorias arbitrárias.

O constraint de banco é aplicado como `NOT VALID` para não interromper uma
base que ainda tenha categorias legadas. Essas linhas não podem ser alteradas
por esta API e devem ser reconciliadas em uma migração aprovada antes que o
constraint seja validado.
