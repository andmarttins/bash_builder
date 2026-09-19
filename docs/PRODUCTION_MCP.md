# MCP de produção — Bash Builder

## Escopo

`mcp-bash-builder` é o ponto de acesso operacional ao servidor de produção `bash-mcp-hub`, onde o Builder Solutions é executado no Dokploy junto de outros projetos. Ele deve ser usado para reduzir suposições sobre dados, containers, redes e deploy.

## Regra de uso

Antes de criar um plano ou aplicar correção que dependa do estado de produção:

1. Consulte o MCP para confirmar schema, estado de migrations, serviços, containers e logs relevantes.
2. Delimite o alvo ao Compose/containers do Builder Solutions antes de usar SSH.
3. Prefira diagnósticos somente de leitura e consultas com escopo limitado.
4. Só execute mudanças persistentes, deploys, reinicializações ou comandos destrutivos mediante autorização explícita.
5. Valide health checks e logs após uma mudança.

## Segurança

- O host é compartilhado: nunca use comandos amplos que possam afetar outros projetos.
- Nunca inclua tokens, senhas, URLs de conexão autenticadas, variáveis de ambiente ou saídas sensíveis em issues, commits, documentação ou respostas.
- O endpoint usa autenticação Bearer. O token deve permanecer exclusivamente na configuração local do Codex, fora do repositório.

## Estado da integração

- Endpoint configurado: `https://ai.bashcodes.dev/mcp/bash-builder`
- Conexão autenticada: **confirmada em 2026-09-19**.
- O servidor não implementa `resources/list`; isso não impede o uso das ferramentas.
- Validação de leitura: o PostgreSQL de produção respondeu e os containers `web`, `api`, `worker` e `redpanda` do Builder Solutions estavam `healthy`.

## Ferramentas confirmadas

| Ferramenta | Capacidade | Limites confirmados |
| --- | --- | --- |
| `mcp__mcp_bash_builder__db_banco_de_produ_o` | Executa SQL no PostgreSQL de produção. | `SELECT` limitado a 500 linhas e 15.000 caracteres; DDL e múltiplas instruções são bloqueados. A ferramenta tecnicamente permite `INSERT`, `UPDATE` e `DELETE` (os dois últimos requerem `WHERE`), mas este projeto exige autorização explícita do usuário para qualquer escrita. |
| `mcp__mcp_bash_builder__ssh_mesmo_servidor_do_hub_mcp` | Executa comandos SSH no host de produção e, opcionalmente, dentro de um container/serviço identificado. | Usar apenas comandos POSIX e exclusivamente alvos previamente confirmados como pertencentes ao Builder Solutions. Não usar comandos amplos nem administrar containers de outros projetos. |

## Consultas e diagnósticos recomendados

Para entendimento de dados, use consultas de metadados ou `SELECT` com filtro e limite explícito. Para infraestrutura, primeiro liste somente containers cujo nome pertença ao Compose do Builder Solutions; depois consulte logs ou saúde do alvo específico.

Exemplos seguros:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

```sh
docker ps --format '{{.Names}}\t{{.Status}}' | grep '^builder-solutions-gqtlzz' || true
```

Não use dados retornados pelo MCP como autorização para mudanças. Confirme escopo, impacto, rollback e autorização do usuário antes de qualquer ação persistente.

## Manutenção

Revalidar o inventário após qualquer mudança no servidor MCP. Antes de utilizar uma capacidade nova, ler integralmente a descrição da ferramenta e atualizar este documento com limites confirmados.
