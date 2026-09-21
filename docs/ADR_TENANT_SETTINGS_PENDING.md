# ADR pendente — configurações tipadas por tenant

## Contexto

O legado tinha `SystemSetting` global com chave e texto livres, além de
`DropdownList` de tipo livre. O inventário do baseline `a4a0e063` identifica
as seguintes configurações de aparência: título, descrição, favicon, logotipo,
imagem de compartilhamento e cores para temas claro e escuro. Ele também
aceitava listas arbitrárias como coordenação, gerência, empresa, site e turno.

Esse modelo não pode ser copiado: configurações globais não têm tenant, URLs
de imagem públicas contornam o armazenamento privado e chaves livres tornam
impossível validar retenção, autorização e compatibilidade de consumidor.

## Decisão aguardada

O dono de negócio deve aprovar, por tenant piloto, quais grupos abaixo serão
mantidos e quem pode alterá-los:

1. identidade visual privada: título, descrição, logo/favicons e paleta;
2. catálogos operacionais além de `event_classification`;
3. configurações de HHT (período, empresas e exceções de atraso);
4. comportamentos de quadro BASH (colunas, ordenação e políticas locais).

Para cada chave aprovada, a decisão deve informar schema, valor padrão,
consumidores, visibilidade (privada, autenticada ou pública), retenção,
capability de leitura/escrita, dono e estratégia de rollback.

## Guardrails para a implementação

- `TenantSetting` somente recebe chaves registradas em código e schemas Zod;
  não haverá endpoint genérico de chave/JSON livre.
- Valores que referenciam arquivos usarão `FileAsset` privado e download
  autorizado; URLs externas/públicas não serão persistidas como configuração.
- Toda escrita terá versão otimista, RLS, auditoria e outbox. Valores sensíveis
  continuam exclusivamente no ambiente/cofre, nunca em `TenantSetting`.
- O catálogo `event_classification` já entregue é o único catálogo operacional
  aprovado até que esta ADR seja decidida.

## Fora de escopo até aprovação

Não haverá migração de `SystemSetting`, `DropdownList`, identidade visual ou
listas legadas. Linhas legadas não serão interpretadas como aprovação implícita
nem serão expostas em endpoints públicos.
