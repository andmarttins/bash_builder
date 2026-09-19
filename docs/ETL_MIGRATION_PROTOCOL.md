# Protocolo de ETL, reconciliação e corte por organização

Este protocolo vale para cada linha marcada como `migrar` ou `substituir` no
[ledger](LEGACY_MIGRATION_LEDGER.md). Ele não autoriza acesso à produção: a
fonte, a janela, o operador e o destino são aprovados antes de cada execução.

## Transformação obrigatória

1. **Identidade e tenant.** Criar uma tabela/arquivo de mapeamento imutável
   `legacy_id → target_id` por tipo de entidade e por organização. Atribuição
   de tenant é uma entrada aprovada, nunca derivada de e-mail ou texto livre.
2. **Referências.** Só gravar uma FK depois que o pai estiver no checkpoint
   aprovado. Referência ausente, duplicada ou de tenant divergente entra em
   fila de exceção; não é reatribuída automaticamente.
3. **Usuários compartilhados.** Uma identidade global pode ter memberships
   explícitas. Permissões, grupos e recursos são recriados por organização;
   não se copia uma role global.
4. **JSON e históricos.** Configurações de formulário/dashboard e respostas
   passam por transformador versionado, schema validado e preservam a versão
   de origem. Campo sem destino vira exceção ou metadado aprovado, jamais é
   silenciosamente descartado.
5. **Arquivos.** Migrar por chave opaca, com hash SHA-256, tamanho, MIME
   verificado e vínculo ao agregado. Arquivo sem dono fica `quarantined` e não
   recebe URL pública.
6. **Segredos.** Tokens, senhas, API keys, QR codes e webhooks não entram no
   ETL. Cada integração é reprovisionada, validada e registrada sem segredo.

## Execução idempotente e checkpoints

- Cada lote tem `migration_run_id`, `organization_id`, versão do transformador,
  snapshot/hash de origem, horário de início/fim, operador e estado.
- Chaves de idempotência usam `organization_id + tipo + legacy_id`; reexecutar
  o mesmo lote atualiza somente registros equivalentes e não duplica anexos ou
  eventos.
- Os estados são `planned`, `extracting`, `loaded`, `reconciling`, `approved`,
  `failed` e `rolled_back`. `approved` é imutável; correção abre novo run.
- Todo erro tem código, ativo de origem, motivo, severidade e destino da
  exceção. Erro não é mascarado por contador agregado.

## Aceite quantitativo por tenant e domínio

| Medida | Regra de aceite |
| --- | --- |
| Registros canônicos | contagem destino = origem filtrada para o tenant; diferença somente em exceção aprovada |
| Relações obrigatórias | 100% das FKs válidas; 0 referência cruzada de tenant |
| Arquivos | contagem e soma de bytes iguais; SHA-256 igual em 100% dos arquivos `ready` |
| Valores calculados | HHT, indicadores e totais: diferença zero, salvo tolerância declarada e assinada antes da carga |
| JSON transformado | 100% validado pelo schema da versão; campos descartados constam na exceção aprovada |
| Segurança | teste automatizado A→B→A passa em pool reutilizado; sem segredo ou URL assinada em log |
| Reexecução | repetir lote não altera contagens, hashes nem cria eventos duplicados |

## Piloto, freeze, delta e rollback

1. Executar piloto de uma organização representativa em cópia isolada e
   aprovar a reconciliação por domínio.
2. Para o corte, registrar início do freeze do legado, extrair delta desde o
   último checkpoint e repetir a reconciliação.
3. Rodar smoke tests de login, permissão, fluxo privado/público, arquivo e
   integração que esteja no corte.
4. Se o gate falhar, voltar o tráfego ao legado. Não há rollback destrutivo de
   dados novos: o run recebe `failed` ou `rolled_back`, preservando evidências.
5. Após aceite, manter o legado em leitura pelo período de retenção aprovado e
   registrar a decisão de revogação de cada link e integração.
