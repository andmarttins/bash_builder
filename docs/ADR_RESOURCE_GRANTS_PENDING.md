# ADR pendente — ResourceGrant por recurso

Os grupos tenant-scoped existem apenas como diretório de membros e **não
alteram permissões** nesta etapa. Nenhuma rota consulta grupo para autorizar
acesso, e nenhum grupo recebe capability implícita.

Antes de criar `ResourceGrant`, o dono de negócio deve aprovar, por escrito:

1. sujeitos (usuário, grupo e ambos), tipos/IDs de recurso e escopo tenant;
2. precedência sobre o RBAC central, inclusive allow/deny e conflitos;
3. expiração, revogação, delegação, auditoria e paginação;
4. matriz endpoint × capability/grant e enforcement obrigatório na API e RLS.

Até essa aprovação, `OWNER`, `ADMIN`, `MEMBER` e `VIEWER` continuam sendo a
única fonte de autorização da aplicação.
