import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = globalThis.process.cwd();
const workspace = await mkdtemp(join(tmpdir(), 'builder-marco0-'));
const pilots = join(workspace, 'pilots');
const assets = join(workspace, 'assets');
const migration = join(workspace, 'migration');
const reset = async () => {
  await rm(pilots, { recursive: true, force: true });
  await rm(assets, { recursive: true, force: true });
  await rm(migration, { recursive: true, force: true });
  await cp(join(root, 'scripts', 'fixtures', 'marco0-valid'), pilots, { recursive: true });
  await cp(join(root, 'scripts', 'fixtures', 'marco0-valid-assets'), assets, { recursive: true });
  await cp(join(root, 'docs', 'migration'), migration, { recursive: true });
};
await reset();

const run = (extraEnv = {}, strictCheckout = false) => {
  try {
    execFileSync('node', ['scripts/verify-marco0.mjs', '--require-active', ...(strictCheckout ? ['--require-legacy-checkout'] : [])], {
      cwd: root,
      env: { ...globalThis.process.env, MIGRATION_PILOTS_DIRECTORY: pilots, MIGRATION_ASSETS_DIRECTORY: assets, ...extraEnv },
      stdio: 'pipe'
    });
    return 0;
  } catch (error) { return typeof error === 'object' && error !== null && 'status' in error ? error.status : 1; }
};
const mutatePilot = async (mutate) => {
  const path = join(pilots, 'synthetic-pilot.json');
  const pilot = JSON.parse(await readFile(path, 'utf8'));
  mutate(pilot);
  await writeFile(path, `${JSON.stringify(pilot, null, 2)}\n`);
};
const mutateAsset = async (mutate) => {
  const path = join(assets, 'FOR-01.json');
  const asset = JSON.parse(await readFile(path, 'utf8'));
  mutate(asset);
  await writeFile(path, `${JSON.stringify(asset, null, 2)}\n`);
};
const mutateManifest = async (mutate) => {
  const path = join(migration, 'legacy-path-manifest.txt');
  const paths = (await readFile(path, 'utf8')).trim().split(/\r?\n/);
  mutate(paths);
  await writeFile(path, `${paths.join('\n')}\n`);
};
const mutateInventory = async (mutate) => {
  const path = join(migration, 'legacy-inventory.json');
  const inventory = JSON.parse(await readFile(path, 'utf8'));
  mutate(inventory);
  await writeFile(path, `${JSON.stringify(inventory, null, 2)}\n`);
};
const mustReject = async (message, mutate, extraEnv = {}) => {
  await reset();
  await mutate();
  if (run(extraEnv) === 0) throw new Error(message);
};

try {
  if (run() !== 0) throw new Error('A fixture válida deveria passar.');
  await mustReject('ID de ativo fora do baseline deveria falhar.', () => mutatePilot((pilot) => { pilot.scope.assetGroups = ['UNKNOWN-99']; }));
  await mustReject('Tree divergente deveria falhar.', () => mutatePilot((pilot) => { pilot.baseline.tree = '0000000000000000000000000000000000000000'; }));
  await mustReject('Referência de carta sem hash deveria falhar.', () => mutatePilot((pilot) => { pilot.references.identityReadiness.contentSha256 = 'invalid'; }));
  await mustReject('Campo TBD/TODO deveria falhar.', () => mutatePilot((pilot) => { pilot.ownership.businessOwner = 'external://people/TODO'; }));
  await mustReject('Duas cartas ACTIVE deveriam falhar.', async () => { await cp(join(pilots, 'synthetic-pilot.json'), join(pilots, 'second-active.json')); });
  await mustReject('Decisão de ativo ausente deveria falhar.', async () => { await rm(join(assets, 'FOR-01.json')); });
  await mustReject('Decisão não aprovada deveria falhar.', () => mutateAsset((asset) => { asset.status = 'DRAFT'; }));
  await mustReject('Evidência de decisão sem hash deveria falhar.', () => mutateAsset((asset) => { asset.evidence.contentSha256 = 'invalid'; }));
  await mustReject('Reconciliação de decisão sem hash deveria falhar.', () => mutateAsset((asset) => { asset.reconciliation.contentSha256 = 'invalid'; }));
  await mustReject('Drift em decisão sem atualizar o hash deveria falhar.', () => mutateAsset((asset) => { asset.evidence.retention = 'RETENTION-ALTERED'; }));
  await mustReject('Dependência ASSET fora do baseline deveria falhar.', () => mutatePilot((pilot) => { pilot.scope.dependencies.push({ ...pilot.scope.dependencies[0], id: 'unknown-asset', kind: 'ASSET', assetGroup: 'UNKNOWN-99' }); }));
  await mustReject('DECOMMISSION não deveria liberar ativo em piloto.', () => mutateAsset((asset) => { asset.decision = 'DECOMMISSION'; }));
  await mustReject('Referência de decisão divergente deveria falhar.', () => mutatePilot((pilot) => { pilot.scope.assetDecisionReferences[0].decisionSha256 = '0000000000000000000000000000000000000000000000000000000000000000'; }));
  await mustReject('Campos obrigatórios de piloto deveriam falhar.', () => mutatePilot((pilot) => { delete pilot.pilot.tenantReference; pilot.scope.capabilities = []; delete pilot.pilot.volumes; }));
  await mustReject('Data de aprovação inválida deveria falhar.', () => mutateAsset((asset) => { asset.approval.approvedAt = 'not-a-date'; }));
  await mustReject('Manifesto reordenado deveria falhar.', () => mutateManifest((paths) => { [paths[0], paths[1]] = [paths[1], paths[0]]; }), { NODE_ENV: 'test', MIGRATION_DIRECTORY: migration });
  await mustReject('Manifesto com duplicata deveria falhar.', () => mutateManifest((paths) => { paths[1] = paths[0]; }), { NODE_ENV: 'test', MIGRATION_DIRECTORY: migration });
  await mustReject('Manifesto com path inválido deveria falhar.', () => mutateManifest((paths) => { paths[0] = '../outside'; }), { NODE_ENV: 'test', MIGRATION_DIRECTORY: migration });
  await mustReject('Nome alternativo de manifesto deveria falhar.', () => mutateInventory((inventory) => { inventory.pathManifestFile = 'other.txt'; }), { NODE_ENV: 'test', MIGRATION_DIRECTORY: migration });
  await reset();
  if (run({ LEGACY_BASELINE_CHECKOUT: root }) === 0) throw new Error('Checkout legado divergente deveria falhar.');
  await reset();
  if (run({}, true) === 0) throw new Error('Gate estrito sem checkout legado autorizado deveria falhar.');
  globalThis.console.log('Casos negativos do Gate Marco 0 validados.');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
