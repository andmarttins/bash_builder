# Governança da migração

Este diretório guarda somente metadados auditáveis da migração. Nunca inclua
dados pessoais, valores de segredo, extratos, mapeamentos `legacy_id` reais,
tokens, URLs assinadas ou conteúdo de arquivos.

## Artefatos versionados

- `legacy-baseline.json`: repositório, commit, árvore e inventário técnico do
  legado revisado.
- `legacy-inventory.json`: hash do manifesto ordenado de paths e proveniência
  reproduzível do checkout do baseline.
- `templates/`: formatos sem dados reais para carta de piloto, decisão por
  ativo, identidade, RACI/ADR, de-para, exceção, reconciliação e corte.
- `pilots/`: uma carta JSON por piloto. Somente uma pode estar `ACTIVE`.
- `assets/`: decisões aprovadas por grupo legado. Uma carta `ACTIVE` só pode
  incluir IDs do baseline que possuam decisão `APPROVED` neste diretório.

Mapeamentos contendo PII, extratos e evidências assinadas ficam em repositório
externo criptografado com acesso mínimo. A carta referencia somente URI/ID
imutável, hash, classificação e retenção desses artefatos externos.

## Gate do Marco 0

`npm run migration:verify-marco0` valida o baseline e toda carta presente. Se
não houver piloto ativo, o comando passa deliberadamente, mas informa que o
gate para carga permanece fechado. Antes de qualquer extração, carga ou corte,
execute `npm run migration:gate-marco0`; ele exige uma única carta `ACTIVE`
sem campos pendentes, com aprovações, escopo/dependências e referências de
identidade, acesso, exceções e reconciliação.

Uma aprovação humana continua externa, porém a referência, data, papel do
aprovador e hash da evidência precisam constar da carta. O protocolo completo
é [ETL_MIGRATION_PROTOCOL.md](../ETL_MIGRATION_PROTOCOL.md).

Os schemas em `schemas/` documentam o formato canônico. A validação também
pode confirmar um checkout local do legado com
`LEGACY_BASELINE_CHECKOUT=<diretório>`; ela compara commit, tree, contagem e
hash do manifesto de paths ao baseline versionado.

`scripts/fixtures/marco0-valid/` é uma carta totalmente sintética usada para
testar o validador. Ela não representa piloto ou aprovação real.
