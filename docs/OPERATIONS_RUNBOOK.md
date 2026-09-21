# Runbook operacional — Outbox

## Objetivo e escopo

Este procedimento cobre a fila transacional da plataforma e deve ser usado por
OWNER ou ADMIN da organização. A tela **Saúde operacional** mostra somente
contagens e identificadores da própria organização; payloads e dados de outros
tenants não devem ser usados para diagnóstico.

## Indicador de serviço

O indicador mede a idade do item acionável mais antigo (`PENDING` ou `FAILED`
com `available_at` já atingido). Um item em backoff ainda não é acionável e não
acrescenta idade até ficar elegível para o worker.
Ele não mede disponibilidade de um fornecedor externo nem substitui alertas de
infraestrutura.

| Estado | Critério | Ação inicial |
| --- | --- | --- |
| `HEALTHY` | sem falhas, DLQ, leases vencidos; idade abaixo de 300 s | acompanhar normalmente |
| `DEGRADED` | ao menos uma falha ou idade entre 300 s e 899 s | atualizar a tela, conferir o worker e investigar a causa antes de nova tentativa |
| `CRITICAL` | DLQ, lease vencido ou idade de 900 s ou mais | pausar mudanças não essenciais, acionar o responsável e seguir o diagnóstico abaixo |

Os limiares representam o objetivo operacional atual: itens acionáveis devem
ficar na fila por no máximo cinco minutos; quinze minutos é incidente crítico.

## Diagnóstico seguro

1. Atualize **Saúde operacional** e registre horário, estado SLI, contagens e
   tipo do evento em DLQ. Não copie payloads, segredos ou dados pessoais para
   tickets ou chat.
2. Confirme os health checks do escopo Builder Solutions: web e API devem estar
   saudáveis; a readiness da API cobre PostgreSQL e Redis; o worker deve estar
   saudável após conectar ao banco e broker.
3. Se houver lease vencido ou idade crescente, verifique os logs do worker e
   broker usando acesso operacional aprovado. Não reinicie serviços como
   primeiro passo e não execute comandos fora do Compose do Builder Solutions.
4. Se houver uma falha transitória, aguarde o retry exponencial automático. A
   contagem de tentativas e o estado atual podem ser acompanhados na tela.
5. Se o item chegou à DLQ, corrija a causa raiz antes de usar **Reenfileirar**.
   A ação é permitida apenas a gestores, é auditada e redefine o item para
   `PENDING`; ela não altera o payload nem garante entrega imediata.
6. Após reenfileirar, atualize a tela até o evento sair da DLQ e o SLI voltar a
   `HEALTHY`. Se ele retornar à DLQ, interrompa novas tentativas e escale o
   incidente com o tipo do evento e os horários observados.

## Recuperação e rollback

Esta funcionalidade não exige migration nem altera a semântica dos eventos.
Para reverter a interface, publique a versão anterior; os procedimentos de
retry, DLQ e auditoria existentes continuam compatíveis. Não apague eventos de
outbox ou registros de auditoria como forma de recuperação.
