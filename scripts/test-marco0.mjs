import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = globalThis.process.cwd();
const workspace = await mkdtemp(join(tmpdir(), 'builder-marco0-'));
const pilots = join(workspace, 'pilots');
const assets = join(workspace, 'assets');
await cp(join(root, 'scripts', 'fixtures', 'marco0-valid'), pilots, { recursive: true });
await cp(join(root, 'scripts', 'fixtures', 'marco0-valid-assets'), assets, { recursive: true });

const run = () => {
  try {
    execFileSync('node', ['scripts/verify-marco0.mjs', '--require-active'], {
      cwd: root,
      env: { ...globalThis.process.env, MIGRATION_PILOTS_DIRECTORY: pilots, MIGRATION_ASSETS_DIRECTORY: assets },
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

try {
  if (run() !== 0) throw new Error('A fixture válida deveria passar.');
  await mutatePilot((pilot) => { pilot.scope.assetGroups = ['UNKNOWN-99']; });
  if (run() === 0) throw new Error('ID de ativo fora do baseline deveria falhar.');
  await mutatePilot((pilot) => { pilot.scope.assetGroups = ['FOR-01']; pilot.baseline.tree = '0000000000000000000000000000000000000000'; });
  if (run() === 0) throw new Error('Tree divergente deveria falhar.');
  await mutatePilot((pilot) => { pilot.baseline.tree = '90ce153c920deb0414afadee1ef6af2fe10ca282'; pilot.references.identityReadiness.contentSha256 = 'invalid'; });
  if (run() === 0) throw new Error('Referência sem hash deveria falhar.');
  await mutatePilot((pilot) => { pilot.references.identityReadiness.contentSha256 = '5555555555555555555555555555555555555555555555555555555555555555'; pilot.ownership.businessOwner = 'external://people/TODO'; });
  if (run() === 0) throw new Error('Campo TBD/TODO deveria falhar.');
  await cp(join(pilots, 'synthetic-pilot.json'), join(pilots, 'second-active.json'));
  if (run() === 0) throw new Error('Duas cartas ACTIVE deveriam falhar.');
  globalThis.console.log('Casos negativos do Gate Marco 0 validados.');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
