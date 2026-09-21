# Guardrails para entrega de webhooks

Esta versão permite apenas cadastrar uma URL HTTPS canonicalizada para um
webhook; ela não faz chamadas externas. A URL não aceita credenciais, IPs
literais, localhost, portas não padrão, query string ou fragmento. Segredos
continuam exclusivamente em `secretRef`, uma variável protegida e isolada por
organização.

Antes de habilitar um dispatcher, ele deve resolver o host em cada tentativa e
recusar endereços loopback, privados, link-local, multicast, reservados e ULA,
inclusive após redirects. A entrega deve usar somente HTTPS na porta 443, sem
seguir redirect para outro host, com timeout curto, limite de resposta,
assinatura HMAC calculada a partir do segredo de runtime e registro auditável
sem payload, cabeçalhos sensíveis ou valor do segredo. A validação de cadastro
não substitui essa defesa de egress contra DNS rebinding.
