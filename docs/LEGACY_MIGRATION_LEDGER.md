# Ledger rastreável de migração do Builder Solutions 9

## Controle do baseline

- **Fonte:** `https://github.com/andmarttins/builder-solutions-9`
- **Commit auditado:** `a4a0e0637ba7d47901b71b7d2c626ac5e2595f24`
- **Escopo:** código, schema Prisma, grupos de rotas e páginas do commit acima.
- **Fora do escopo:** `.env`, credenciais, dados de produção e inferência de
  frequência de uso. Nenhum item com `dono` ou `evidência` pendente entra em
  release ou ETL.

`TBD` não é uma aprovação implícita: o dono de negócio deve ser indicado e a
evidência deve ser uma entrevista registrada, telemetria, obrigação legal ou
aceite de descontinuação.

## Catálogo de ativos e decisão

| ID | Ativos legados (rotas / modelos / páginas) | Capacidade | Decisão | Destino novo | Fase/release | Dono e evidência | Reconciliação/gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IDN-01 | `/auth`, `User`, `Session`; `Auth`, `ProfilePage`, `Admin/Users` | login, perfil, usuários, reset | substituir | Identity, sessions opacas, convites e membership | F1 / R1 | TBD / TBD | usuários ativos/inativos por tenant; e-mail normalizado; aceite do dono |
| IDN-02 | `/admin`, `/admin/user-groups`, `/moderators`; `UserPagePermission`, `UserGroup`, `UserGroupMember`, `Moderator`; `UserPermissionsModal`, `UserGroupsPage` | grupos, permissões e hierarquias | substituir | capabilities, `ResourceGrant`, grupos tenant-scoped | F1 / R1 | TBD / TBD | memberships/grants por tenant; teste A→B→A e matriz de capacidades |
| CFG-01 | `/settings`, `/dropdown-lists`; `SystemSetting`, `DropdownList`; `SettingsPage`, `CustomizationPage` | configurações, listas e aparência | migrar seletivamente | `TenantSetting` tipado e catálogo de opções | F1 / R1 | TBD / TBD | aprovar `ADR_TENANT_SETTINGS_PENDING.md`; chaves aprovadas e JSON validado; nenhuma credencial no payload |
| FOR-01 | `/forms`; `Form`, `FormSlugHistory`, `FormField`, `FormPermission`, `FormFieldCounter`; `FormManagerPage`, `FormConfigPage`, `FormFieldsPage`, componentes `forms/*` | builder, campos, regras e permissões | substituir | Form, FormVersion, FieldDefinition, ResourceGrant | F2 / R2 | TBD / TBD | aprovar `ADR_FORM_DELTAS_PENDING.md`; formulários/versões/campos por tenant; snapshot canônico de configuração |
| FOR-02 | `/forms` submissões e relatórios; `FormSubmission`; `Formulario`, `FormSubmissionsPage`, `ReportsPage` | submissão, tratativa, busca e exportação | substituir | Submission, workflow pai-filho e export job | F2 / R2 | TBD / TBD | contagem por formulário/período; JSON normalizado; IDs de resposta mapeados |
| PUB-01 | `/public`; `PublicFormPage`, `PublicTratativaPage` | formulários e tratativas públicos | substituir | Publication com escopo de tenant, expiração e revogação | F2 / R2 | TBD / TBD | links ativos/revogados, amostra de respostas e teste de isolamento |
| FIL-01 | `/upload`; `FileUpload`, `FormFileUpload`, anexos em eventos/BASH | upload e download de arquivo | substituir | UploadIntent e FileAsset privado | F2 / R2 | TBD / TBD | número, tamanho e checksum de objetos; URLs assinadas e scan antes de `ready` |
| EVT-01 | `/events`; `Event`, `EventPhoto`; `Eventos`, `EventEditModal`, `EventViewModal` | eventos, classificação, fotos e ações | migrar seletivamente | SafetyEvent, classificação e evidências | F3 / R3 | TBD / TBD | eventos/fotos por tenant; amostra de campos canônicos e anexos |
| BSH-01 | `/bash-cards`; `BashCard`, `BashCardComment`, `BashCardAttachment`, `BashBoardSetting`; `GestaoBashPage`, `components/bash/*` | quadro BASH, comentários e anexos | substituir | BashCard, Comment, FileAsset e workflow | F3 / R3 | TBD / TBD | `ADR_BASH_CONFIGURATION_PENDING.md`; cartões por estágio, comentários e checksums de anexos |
| CHG-01 | `/change-management`; `ChangeManagement`, `ChangeManagementRisk`; páginas e `components/change-management/*` | seis etapas, riscos e aprovações | substituir | Change, Risk, Approval e state machine | F3 / R3 | TBD / TBD | mudanças/riscos por estado; transições válidas e trilha de auditoria |
| HHT-01 | `/hht`, `/public/hht`, `/hht/settings`; `HHTCompany`, `HHTReport`, `HHTLatePermission`, `HHTSetting`, `HHTReportWindow`; páginas `hht-taxas/*` | taxas, empresas, janelas e consolidação | migrar seletivamente | HHTCompany, HHTReport, period/window e regras puras | F3 / R3 | TBD / TBD | totais por empresa/período; tolerância monetária zero salvo exceção aprovada |
| INT-01 | `/integrations`; `Integration`; `IntegrationsPage`, modais R2/Resend/OpenAI/Smartsheet | conexões e segredos de fornecedores | substituir | IntegrationConnection + secret reference | F4 / R4 | TBD / TBD | inventário de conexões sem segredo; teste de conexão e rotação documentados |
| INT-02 | `/whatsapp`, `/webhook`; `WhatsAppConnection`, `WhatsAppGroup`, `WhatsAppNotification`, `WhatsAppNotificationNumber`; páginas WhatsApp | notificações, grupos e webhooks | substituir | adapter WhatsApp, delivery attempt, assinatura e outbox | F4 / R4 | TBD / TBD | mapeamentos de grupo e webhooks ativos; replay idempotente/DLQ |
| INT-03 | `/bi`, `/bi/api-keys`; `BiApiKey`; `PowerBiPage` | BI e chaves de consumo | substituir | service account/BI key com escopo e rotação | F4 / R4 | TBD / TBD | chaves não migradas literalmente; consumidor recriado e autorizado |
| ANL-01 | `/dashboard`, `/dashboards`, `/dashboard-data`; `Dashboard`, `DashboardView`; `DashboardBuilderPage`, widgets `dashboards/*`, `PublicDashboardPage` | dashboards, widgets e publicação | migrar seletivamente | Dashboard, WidgetDefinition, DataSource e Publication | F4 / R4 | base entregue / dados dinâmicos TBD | publicação estática por token opaco rotacionável, RLS, expiração, revogação e auditoria/outbox; faltam fontes de dados autorizadas e widgets analíticos |
| TV-01 | `/tv-displays`, `/tv-playlists`; `FormTvDisplay`, `TvPlaylist`, `TvPlaylistItem`; `TvDisplay*`, `TvPlaylist*` | displays, playlists e TV pública | substituir | Display e Playlist públicos revogáveis | F4 / R4 | entregue / entregue | Ambos usam token opaco, snapshot estático, expiração, RLS, auditoria e outbox; qualquer mudança de Display/Painel revoga playlists derivadas |
| OPS-01 | `/monitoring`; `ServerMetricsCard`, `ServersPage`, `useServerMonitoring` | estado e monitoramento operacional | substituir | métricas/alertas do runtime, sem métricas de host por usuário | F4 / R4 | TBD / TBD | aprovar `ADR_OPERATIONAL_MONITORING_PENDING.md`; SLI/SLO, alertas, retenção e runbook aprovados |
| EXT-01 | `/dashboard` legado, assets de tema, `DesignSystem`, `HomePage`, `Index` | páginas institucionais e design | descontinuar ou substituir após aceite | web de plataforma, sem importar componentes por cópia | F5 / R5 | TBD / TBD | aceite explícito de descontinuação ou critério visual definido |

## Regra de granularidade

Os grupos acima são unidades de release, mas não dispensam inventário técnico.
Antes de iniciar uma linha, o responsável acrescenta no issue/release a lista
de handlers, modelos, páginas e componentes daquele grupo, com hash do
baseline. Componentes `ui/*` são biblioteca genérica; não são migrados como
ativos de negócio. Os componentes de negócio listados na coluna de ativos são
o mínimo que deve ser revisado.

## Checkpoints obrigatórios

| Checkpoint | Evidência exigida |
| --- | --- |
| Descoberta | dono de negócio, evidência de uso e decisão por linha sem `TBD` |
| Design | ADR de autorização/dados públicos/retensão e contrato de API versionado |
| Implementação | migrations, RLS, autorização e testes de tenant para o agregado |
| Carga piloto | manifesto de origem, checkpoint, contagens, checksums e exceções assinadas |
| Delta/corte | freeze registrado, delta reconciliado, smoke tests e rollback ensaiado |

Não se migra o item `EXT-01` por inércia visual; não se migra segredo em
nenhuma linha. Uma decisão de descontinuação precisa do aceite do dono e da
data de retirada do acesso legado.
