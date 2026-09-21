# Governança da migração

Este diretório guarda somente metadados auditáveis da migração. Nunca inclua
dados pessoais, valores de segredo, extratos, mapeamentos `legacy_id` reais,
tokens, URLs assinadas ou conteúdo de arquivos.

## Artefatos versionados

- `legacy-baseline.json`: repositório, commit, árvore e inventário técnico do
  legado revisado.
- `legacy-inventory.json` e `legacy-path-manifest.txt`: manifesto ordenado de
  paths, hash e proveniência reproduzível do checkout do baseline. A CI valida
  cada path, a ordem, a contagem e o hash; uma alteração exige revisão no diff.
- `templates/`: formatos sem dados reais para carta de piloto, decisão por
  ativo, identidade, RACI/ADR, de-para, exceção, reconciliação e corte.
- `pilots/`: uma carta JSON por piloto. Somente uma pode estar `ACTIVE`.
- `assets/`: decisões aprovadas por grupo legado. Uma carta `ACTIVE` só pode
  incluir IDs do baseline que possuam decisão `APPROVED` de migração ou
  substituição e uma referência imutável (`decisionId` + hash) neste diretório.

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

Antes de executar carga, o operador confere no repositório externo controlado
que cada URI, hash, aprovação e responsável da carta correspondem ao artefato
imutável exibido. `external://` é apenas um identificador auditável: não é uma
prova automaticamente resolvida pela CI. Decisões `DECOMMISSION` exigem aceite
e data de retirada em fluxo separado e nunca liberam capacidade de piloto.

O repositório legado é privado e não recebe credenciais na CI deste projeto;
por isso, a CI verifica o manifesto integral versionado e sua proveniência. O
validador executável é a especificação canônica. A validação também pode
confirmar um checkout local autorizado do legado com
`LEGACY_BASELINE_CHECKOUT=<diretório>`; ela compara commit, tree, contagem e
hash do manifesto de paths ao baseline versionado.

`scripts/fixtures/marco0-valid/` é uma carta totalmente sintética usada para
testar o validador. Ela não representa piloto ou aprovação real.
