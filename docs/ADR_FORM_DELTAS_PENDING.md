# ADR pendente — deltas de formulários do legado

## Estado preservado no novo domínio

O novo módulo já mantém campos tipados, versão otimista, snapshot de campos em
cada submissão, publicação com identificador opaco, expiração/revogação,
tratativas pai-filho, auditoria, outbox, RLS e exportação CSV limitada. Isso
substitui as partes essenciais de `Form`, `FormField` e `FormSubmission` do
baseline legado.

## Decisões necessárias

O baseline `a4a0e063` ainda tinha três mecanismos que não devem ser
reproduzidos por inércia:

1. **Histórico de slug** — definir se uma URL pública anterior deve redirecionar
   para o formulário atual, por quanto tempo, e se a revogação deve invalidar
   também esse histórico. O padrão recomendado é não manter redirecionamento:
   o identificador público opaco atual é rotacionado e revogável.
2. **Versões nomeadas de formulário** — definir se o negócio precisa restaurar
   uma configuração editável, em vez do snapshot imutável já mantido nas
   respostas. A decisão deve especificar autor, rótulo, restauração, retenção
   e como uma restauração afeta publicação e submissões.
3. **Contadores de campo** — definir campos elegíveis, chave de período,
   semântica de concorrência e se o contador é somente exibição ou compõe uma
   chave de negócio. Não será criado contador genérico que possa duplicar ou
   vazar uma sequência entre tenants.

## Dependências explícitas

Permissões individuais ou por grupo, exportação assíncrona de alto volume e
delegação de formulário aguardam a ADR de `ResourceGrant` e, quando aplicável,
a decisão de job de exportação. Arquivos seguem as regras de armazenamento
privado já entregues; URLs de anexo não são preservadas do legado.

## Critério para implementação

Cada item aprovado terá schema próprio, RLS, constraint de tenant,
versionamento, auditoria/outbox, teste A→B→A e um plano de reconciliação de
URL/contagem/snapshot. Sem essa decisão, o comportamento atual é a fonte de
verdade e não há migração desses campos legados.
