# Matriz de capacidades por organização

Esta é a fonte de verdade de autorização funcional. Papéis são associados a uma
`membership`; capacidades são verificadas no servidor em cada endpoint de
alteração e em toda leitura que exponha dados operacionais.

| Capacidade | OWNER | ADMIN | MEMBER | VIEWER | Uso previsto |
| --- | --- | --- | --- | --- | --- |
| `workspace.view` | ✓ | ✓ | ✓ | ✓ | home e navegação |
| `organization.manage` | ✓ | — | — | — | configuração sensível da organização |
| `forms.view` | ✓ | ✓ | ✓ | ✓ | lista e definição privada |
| `forms.manage` | ✓ | ✓ | — | — | criar, editar campos, publicar, arquivar |
| `forms.submissions.view` | ✓ | ✓ | ✓ | — | respostas e tratativas |
| `forms.submissions.manage` | ✓ | ✓ | — | — | alterar estado de resposta |
| `forms.submissions.export` | ✓ | ✓ | — | — | exportação CSV auditável |
| `events.*`, `changes.*`, `bash.*`, `hht.*`, `dashboards.*`, `tv.*` | ✓ | ✓ | view | view | mesma convenção: `manage` não é concedido a MEMBER/VIEWER |
| `integrations.*`, `operations.*` | ✓ | ✓ | — | — | conexões, webhooks e operação |

`ADMIN` não recebe `organization.manage`: criação de tenants e mudanças de
propriedade permanecem uma decisão do OWNER ou administrador de plataforma.
O superadministrador de plataforma não ignora RLS; ele entra na organização por
uma membership explícita.

## Obrigação por endpoint

1. Declarar `@RequiredCapabilities(...)` antes de liberar um endpoint de
   domínio; não usar o papel diretamente como autorização de negócio.
2. Adicionar caso positivo e negativo para os papéis da tabela, além de teste
   A→B→A no PostgreSQL para toda consulta ou mutação tenant-owned.
3. A rota pública não recebe capability. Ela usa token/identificador opaco,
   expiração e revogação do recurso, rate limiting e escopo RLS próprio.
4. Toda nova capacidade atualiza este arquivo, `packages/contracts` e a matriz
   endpoint × capacidade do módulo no mesmo pull request.
