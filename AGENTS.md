# Bash Builder — instruções de projeto

## MCP de produção

Use o MCP `mcp-bash-builder` como fonte de verdade operacional antes de planejar ou executar mudanças que dependam da estrutura de produção. Ele representa o servidor `bash-mcp-hub`, que é compartilhado com outros projetos.

- Quando houver incerteza sobre schema, dados, migrations, topologia, containers ou configuração, investigue primeiro pelas ferramentas de banco de dados e infraestrutura do MCP.
- Para diagnósticos e planejamento, prefira operações de leitura e consultas limitadas. Não faça DDL, escrita de dados, rotação de segredos, deploy, restart ou remoção sem pedido explícito do usuário.
- Antes de agir por SSH, identifique o Compose, os containers, redes e volumes que pertencem ao Builder Solutions. Nunca aplique comandos amplos no host nem interfira em outros projetos.
- Nunca registre, imprima ou copie tokens MCP, URLs com credenciais, senhas de banco, Redis ou variáveis de ambiente de produção.
- Para mudanças de produção, confira estado atual com MCP, descreva impacto e rollback, e valide os health checks após a alteração.

## Conexão MCP

Endpoint configurado localmente: `https://ai.bashcodes.dev/mcp/bash-builder`.

O servidor exige o cabeçalho HTTP `Authorization: Bearer <token>`. O token permanece apenas na configuração local do Codex; não o adicione ao Git nem a arquivos do projeto.

Inventário confirmado e regras detalhadas: `docs/PRODUCTION_MCP.md`.
