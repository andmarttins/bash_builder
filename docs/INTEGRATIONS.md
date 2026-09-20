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
qualquer parte do segredo e ainda não realiza tráfego para sistemas externos.

Quando um consumer passar a executar uma integração, a mesma variável deve ser
configurada também no Worker. Essa alteração exige um adaptador específico por
tipo de integração, allowlist de destinos e testes de segurança contra SSRF.

## Estados da verificação

- `READY`: a referência é válida e existe no runtime da API.
- `MISSING_SECRET_REFERENCE`: a integração ainda não recebeu uma referência.
- `SECRET_NOT_CONFIGURED`: a referência foi cadastrada, mas a variável não foi
  encontrada no runtime da API. Salve a variável protegida no Dokploy e faça
  novo deploy da API antes de verificar novamente.
