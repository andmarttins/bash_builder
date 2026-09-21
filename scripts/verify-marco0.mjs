import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = globalThis.process.cwd();
const migrationDirectory = join(root, 'docs', 'migration');
const pilotsDirectory = resolve(root, globalThis.process.env.MIGRATION_PILOTS_DIRECTORY ?? join('docs', 'migration', 'pilots'));
const assetsDirectory = resolve(root, globalThis.process.env.MIGRATION_ASSETS_DIRECTORY ?? join('docs', 'migration', 'assets'));
const requireActive = globalThis.process.argv.includes('--require-active');
const requiredApprovalRoles = ['BUSINESS', 'SECURITY', 'PRIVACY', 'OPERATIONS'];
const classifications = new Set(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
const failures = [];

const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { failures.push(`${path}: JSON inválido (${error instanceof Error ? error.message : 'erro desconhecido'})`); return undefined; }
};
const files = async (directory) => (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort();
const nonBlank = (value) => typeof value === 'string' && value.trim().length > 0;
const sha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const reference = (value) => nonBlank(value) && /^external:\/\//.test(value) && !/\b(TBD|TODO)\b/i.test(value);
const fail = (scope, message) => failures.push(`${scope}: ${message}`);
const validTimestamp = (value) => {
  const match = nonBlank(value) && /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.exec(value);
  if (!match) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(match[1]);
};
const validOwner = (value) => reference(value) && /^external:\/\/people\/[a-z0-9._-]+$/i.test(value);
const validApproval = (value) => reference(value?.approvalId) && validTimestamp(value?.approvedAt) && sha256(value?.evidenceSha256);
const validReference = (value) => reference(value?.externalLocation) && sha256(value?.contentSha256) && classifications.has(value?.classification) && nonBlank(value?.retention) && validApproval(value?.approval);

const baseline = await readJson(join(migrationDirectory, 'legacy-baseline.json'));
const inventory = await readJson(join(migrationDirectory, 'legacy-inventory.json'));
if (baseline) {
  if (baseline.schemaVersion !== 1) fail('legacy-baseline.json', 'schemaVersion deve ser 1.');
  if (!nonBlank(baseline.legacyRepository) || !/^[a-f0-9]{40}$/i.test(baseline.baselineCommit) || !/^[a-f0-9]{40}$/i.test(baseline.baselineTree)) fail('legacy-baseline.json', 'referência de baseline incompleta.');
  if (!Number.isInteger(baseline.trackedFileCount) || baseline.trackedFileCount < 1) fail('legacy-baseline.json', 'trackedFileCount inválido.');
  if (!Array.isArray(baseline.assetGroups) || baseline.assetGroups.length === 0 || new Set(baseline.assetGroups).size !== baseline.assetGroups.length) fail('legacy-baseline.json', 'assetGroups deve ser não vazio e sem duplicatas.');
}
if (!inventory || inventory.schemaVersion !== 1 || !baseline || inventory.baselineCommit !== baseline.baselineCommit || inventory.baselineTree !== baseline.baselineTree || inventory.trackedFileCount !== baseline.trackedFileCount || !nonBlank(inventory.pathManifestFile) || !sha256(inventory.pathManifestSha256) || !nonBlank(inventory.capturedBy)) fail('legacy-inventory.json', 'inventário deve referenciar integralmente o baseline e seu manifesto.');
if (inventory?.pathManifestFile) {
  try {
    const manifestPaths = (await readFile(join(migrationDirectory, inventory.pathManifestFile), 'utf8')).trim().split(/\r?\n/).filter(Boolean);
    const manifestHash = createHash('sha256').update(`${manifestPaths.join('\n')}\n`).digest('hex');
    if (manifestPaths.length !== inventory.trackedFileCount || new Set(manifestPaths).size !== manifestPaths.length || manifestPaths.some((path) => path !== path.trim()) || manifestHash !== inventory.pathManifestSha256) fail('legacy-path-manifest.txt', 'manifesto versionado não corresponde ao hash, à contagem ou à ordenação declarados.');
  } catch (error) { fail('legacy-path-manifest.txt', `não foi possível verificar (${error instanceof Error ? error.message : 'erro desconhecido'}).`); }
}

const assetDecisions = new Map();
for (const file of await files(assetsDirectory)) {
  const asset = await readJson(join(assetsDirectory, file));
  if (!asset) continue;
  if (!nonBlank(asset.assetGroup) || assetDecisions.has(asset.assetGroup)) { fail(`assets/${file}`, 'assetGroup é obrigatório e único.'); continue; }
  assetDecisions.set(asset.assetGroup, asset);
  if (asset.schemaVersion !== 1 || !['MIGRATE', 'SUBSTITUTE', 'DECOMMISSION'].includes(asset.decision) || asset.status !== 'APPROVED' || !reference(asset.decisionId) || !sha256(asset.decisionSha256)) fail(`assets/${file}`, 'schemaVersion, decisão, decisionId/hash imutáveis e status APPROVED são obrigatórios.');
  if (!validOwner(asset.businessOwner) || !validReference(asset.evidence) || !classifications.has(asset.classification) || !nonBlank(asset.retention) || !validApproval(asset.approval) || !validReference(asset.reconciliation)) fail(`assets/${file}`, 'owner, evidência, classificação, retenção, aprovação e reconciliação estruturados são obrigatórios.');
}

const pilots = [];
for (const file of await files(pilotsDirectory)) {
  const pilot = await readJson(join(pilotsDirectory, file));
  if (pilot) pilots.push({ file, pilot });
}
const activePilots = pilots.filter(({ pilot }) => pilot.status === 'ACTIVE');
if (activePilots.length > 1) fail('pilots', 'somente uma carta pode estar ACTIVE.');
for (const { file, pilot } of activePilots) {
  if (pilot.schemaVersion !== 1 || !nonBlank(pilot.id)) fail(file, 'id e schemaVersion 1 são obrigatórios.');
  if (!baseline || pilot.baseline?.commit !== baseline.baselineCommit || pilot.baseline?.tree !== baseline.baselineTree || pilot.baseline?.repository !== baseline.legacyRepository) fail(file, 'baseline repository, commit e tree devem corresponder ao registro canônico.');
  if (!reference(pilot.pilot?.tenantReference) || !classifications.has(pilot.pilot?.classification) || !nonBlank(pilot.pilot?.retention) || !validReference(pilot.pilot?.volumes)) fail(file, 'tenant, classificação, retenção e volumes estruturados são obrigatórios.');
  const scopedAssets = pilot.scope?.assetGroups;
  if (!Array.isArray(scopedAssets) || scopedAssets.length === 0 || new Set(scopedAssets).size !== scopedAssets.length || scopedAssets.some((id) => !baseline?.assetGroups.includes(id))) fail(file, 'scope.assetGroups deve conter IDs únicos do baseline.');
  if (!Array.isArray(pilot.scope?.capabilities) || pilot.scope.capabilities.length === 0 || pilot.scope.capabilities.some((item) => !nonBlank(item))) fail(file, 'scope.capabilities é obrigatório.');
  const dependencies = pilot.scope?.dependencies;
  if (!Array.isArray(dependencies) || dependencies.length === 0 || dependencies.some((item) => !nonBlank(item?.id) || !['ASSET', 'READINESS'].includes(item?.kind) || !validReference(item?.evidence) || (item.kind === 'ASSET' && !baseline?.assetGroups.includes(item.assetGroup)))) fail(file, 'dependências devem ter tipo, ID e evidência estruturada; ASSET deve pertencer ao baseline.');
  const assetIds = new Set([...(Array.isArray(scopedAssets) ? scopedAssets : []), ...(Array.isArray(dependencies) ? dependencies.filter((item) => item.kind === 'ASSET').map((item) => item.assetGroup) : [])]);
  const decisionReferences = pilot.scope?.assetDecisionReferences;
  if (!Array.isArray(decisionReferences) || decisionReferences.length !== assetIds.size || new Set(decisionReferences.map((item) => item?.assetGroup)).size !== decisionReferences.length) fail(file, 'scope.assetDecisionReferences deve vincular cada ativo a uma decisão imutável.');
  for (const id of assetIds) {
    const decision = assetDecisions.get(id);
    const decisionReference = Array.isArray(decisionReferences) ? decisionReferences.find((item) => item?.assetGroup === id) : undefined;
    if (!decision) fail(file, `decisão APPROVED ausente para ${id}.`);
    else if (!['MIGRATE', 'SUBSTITUTE'].includes(decision.decision)) fail(file, `${id} deve ter decisão MIGRATE ou SUBSTITUTE para compor um piloto ACTIVE.`);
    if (!decisionReference || decisionReference.decisionId !== decision?.decisionId || decisionReference.decisionSha256 !== decision?.decisionSha256) fail(file, `referência imutável da decisão ausente ou divergente para ${id}.`);
  }
  for (const role of ['businessOwner', 'securityOwner', 'privacyOwner', 'cutoverOperator']) if (!validOwner(pilot.ownership?.[role])) fail(file, `ownership.${role} deve referenciar uma pessoa externa identificável.`);
  const approvedRoles = new Set((Array.isArray(pilot.approvals) ? pilot.approvals : []).filter((item) => validApproval(item)).map((item) => item.role));
  for (const role of requiredApprovalRoles) if (!approvedRoles.has(role)) fail(file, `aprovação válida ausente para ${role}.`);
  for (const key of ['identityReadiness', 'tenantMapping', 'exceptionRegister', 'reconciliationPlan', 'accessPolicy', 'cutoverRunbook']) if (!validReference(pilot.references?.[key])) fail(file, `references.${key} deve ser estruturada e aprovada.`);
  if (!Number.isInteger(pilot.cutover?.rpoMinutes) || pilot.cutover.rpoMinutes < 0 || !Number.isInteger(pilot.cutover?.rtoMinutes) || pilot.cutover.rtoMinutes < 1 || !validReference(pilot.cutover?.incidentChannel) || !validReference(pilot.cutover?.returnCriteria)) fail(file, 'cutover deve declarar RPO/RTO e referências estruturadas.');
  if (/\b(TBD|TODO)\b/i.test(JSON.stringify(pilot))) fail(file, 'uma carta ACTIVE não pode conter TBD/TODO.');
}

const checkout = globalThis.process.env.LEGACY_BASELINE_CHECKOUT;
if (checkout && baseline && inventory) {
  try {
    const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    const paths = execFileSync('git', ['-C', checkout, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
    const manifest = createHash('sha256').update(`${paths.join('\n')}\n`).digest('hex');
    if (commit !== baseline.baselineCommit || tree !== baseline.baselineTree || paths.length !== baseline.trackedFileCount || manifest !== inventory.pathManifestSha256) fail('legacy checkout', 'não reproduz o commit, tree ou manifesto do baseline.');
  } catch (error) { fail('legacy checkout', `não foi possível verificar (${error instanceof Error ? error.message : 'erro desconhecido'}).`); }
}

if (requireActive && activePilots.length !== 1) fail('Gate Marco 0', 'uma única carta ACTIVE é obrigatória antes de extração, carga ou corte.');
if (failures.length > 0) {
  globalThis.console.error('Falha na governança do Marco 0:');
  for (const failure of failures) globalThis.console.error(`- ${failure}`);
  globalThis.process.exitCode = 1;
} else if (activePilots.length === 0) {
  globalThis.console.log('Nenhum piloto ACTIVE: metadados validados; Gate Marco 0 permanece fechado para carga.');
} else {
  globalThis.console.log(`Carta Marco 0 validada: ${activePilots[0].file}`);
}
