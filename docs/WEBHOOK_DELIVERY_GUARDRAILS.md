# Guardrails para entrega de webhooks

Esta versão permite somente o adapter `WEBHOOK`. Tipos de catálogo sem adapter
aprovado podem ser mantidos como inventário, mas não podem ser ativados. A URL
do webhook é canonicalizada e não aceita credenciais, IPs literais, localhost,
portas não padrão, query string ou fragmento. Segredos continuam exclusivamente
em `secretRef`, uma variável protegida e isolada por organização.

O dispatcher resolve o host em cada tentativa e recusa endereços loopback,
privados, link-local, multicast e reservados; IPv6 permanece recusado até haver
uma política revisada. A entrega usa HTTPS na porta 443, fixa a conexão ao IP
validado (proteção contra DNS rebinding), não segue redirects, tem deadline e
limite de payload, assina o corpo com HMAC e descarta o corpo da resposta. A
auditoria não registra payload, cabeçalhos sensíveis ou valor do segredo. A
validação de cadastro não substitui essa defesa de egress.
