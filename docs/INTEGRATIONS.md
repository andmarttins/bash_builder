# Integrações e segredos de runtime

## Princípio

O PostgreSQL multi-tenant guarda somente a configuração não sensível e a
referência lógica ao segredo. Nunca grave tokens, senhas, chaves de API ou
headers de autorização no formulário de integração, no banco ou em logs.

## Dokploy

Cadastre cada segredo como variável de ambiente **protegida** no serviço da
API. Use o namespace canônico da organização ativa:
`INTEGRATION_<SLUG_DA_ORGANIZACAO_EM_MAIUSCULAS>_`. Troque hífens do slug por
sublinhados e use apenas letras maiúsculas, números e sublinhado. Isso impede
que uma empresa use a referência de runtime de outra. Exemplo de nome (não de
valor) para a organização `acme`:

```dotenv
INTEGRATION_ACME_WEBHOOK_SECRET=<valor-fornecido-pelo-destino>
```

Ao criar a integração, informe apenas `INTEGRATION_ACME_WEBHOOK_SECRET` em
**Referência de segredo**. O botão **Verificar configuração** confirma apenas
se a variável está presente e não vazia; ele não revela valor, tamanho ou
qualquer parte do segredo e não realiza tráfego para sistemas externos.

## Webhooks

Uma integração `WEBHOOK` ativa enfileira cada evento de domínio em uma fila
durável por integração. A variável protegida precisa existir tanto na API
(para permitir a ativação) quanto no Worker (para assinar a entrega). O Worker
aceita somente URLs HTTPS sem IP, porta, credenciais, query ou fragmento; faz
resolução DNS pinada e envia apenas para IPv4 público. Redirecionamentos não
são seguidos.

O corpo contém `eventId`, `eventType`, `schemaVersion`, `tenantId`,
`aggregateId`, `occurredAt` e `payload`. Ele é assinado com HMAC-SHA256 no
header `x-builder-signature-sha256`; `x-builder-event-id` é a chave de
deduplicação do receptor. A semântica é **at-least-once**: o receptor deve
deduplicar pelo `eventId` antes de executar efeitos externos.

Falhas usam backoff, lease e DLQ. A desativação ou reconfiguração da integração
cancela entregas ainda pendentes; entregas já em trânsito podem completar uma
única vez. Operadores com `operations.view` consultam a DLQ em
`GET /v1/operations/webhooks/dead-letter`; `operations.manage` pode reenfileirar
uma entrega em `POST /v1/operations/webhooks/dead-letter/:deliveryId/redrive`.

## Estados da verificação

- `READY`: a referência é válida e existe no runtime da API.
- `MISSING_SECRET_REFERENCE`: a integração ainda não recebeu uma referência.
- `SECRET_NOT_CONFIGURED`: a referência foi cadastrada, mas a variável não foi
  encontrada no runtime da API. Salve a variável protegida no Dokploy e faça
  novo deploy da API antes de verificar novamente.
