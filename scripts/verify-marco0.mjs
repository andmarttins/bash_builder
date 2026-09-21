import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = globalThis.process.cwd();
const migrationDirectory = join(root, 'docs', 'migration');
const pilotsDirectory = join(root, globalThis.process.env.MIGRATION_PILOTS_DIRECTORY ?? join('docs', 'migration', 'pilots'));
const requireActive = globalThis.process.argv.includes('--require-active');
const requiredApprovalRoles = ['BUSINESS', 'SECURITY', 'PRIVACY', 'OPERATIONS'];

const failures = [];
const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { failures.push(`${path}: JSON inválido (${error instanceof Error ? error.message : 'erro desconhecido'})`); return undefined; }
};
const nonBlank = (value) => typeof value === 'string' && value.trim().length > 0;
const reference = (value) => nonBlank(value) && !/\b(TBD|TODO)\b/i.test(value);
const sha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const fail = (pilot, message) => failures.push(`${pilot}: ${message}`);

const baseline = await readJson(join(migrationDirectory, 'legacy-baseline.json'));
if (baseline) {
  if (baseline.schemaVersion !== 1) failures.push('legacy-baseline.json: schemaVersion deve ser 1.');
  if (!nonBlank(baseline.legacyRepository) || !/^[a-f0-9]{40}$/i.test(baseline.baselineCommit) || !/^[a-f0-9]{40}$/i.test(baseline.baselineTree)) failures.push('legacy-baseline.json: referência de baseline incompleta.');
  if (!Number.isInteger(baseline.trackedFileCount) || baseline.trackedFileCount < 1) failures.push('legacy-baseline.json: trackedFileCount inválido.');
  if (!Array.isArray(baseline.assetGroups) || baseline.assetGroups.length === 0) failures.push('legacy-baseline.json: assetGroups é obrigatório.');
}

const pilotFiles = (await readdir(pilotsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort();
const pilots = [];
for (const file of pilotFiles) {
  const pilot = await readJson(join(pilotsDirectory, file));
  if (pilot) pilots.push({ file, pilot });
}

const activePilots = pilots.filter(({ pilot }) => pilot.status === 'ACTIVE');
if (activePilots.length > 1) failures.push('pilots: somente uma carta pode estar ACTIVE.');
for (const { file, pilot } of activePilots) {
  if (pilot.schemaVersion !== 1 || !nonBlank(pilot.id)) fail(file, 'id e schemaVersion 1 são obrigatórios.');
  if (!baseline || pilot.baseline?.commit !== baseline.baselineCommit || pilot.baseline?.repository !== baseline.legacyRepository) fail(file, 'baseline deve corresponder a legacy-baseline.json.');
  if (!Array.isArray(pilot.scope?.assetGroups) || pilot.scope.assetGroups.length === 0) fail(file, 'scope.assetGroups é obrigatório.');
  if (!Array.isArray(pilot.scope?.dependencies) || pilot.scope.dependencies.length === 0 || pilot.scope.dependencies.some((item) => !nonBlank(item?.id) || item.status !== 'APPROVED')) fail(file, 'todas as dependências transitivas devem estar APPROVED.');
  for (const role of ['businessOwner', 'securityOwner', 'privacyOwner', 'cutoverOperator']) if (!reference(pilot.ownership?.[role])) fail(file, `ownership.${role} deve referenciar responsável externo.`);
  const approvedRoles = new Set((Array.isArray(pilot.approvals) ? pilot.approvals : []).filter((item) => reference(item?.approvalId) && nonBlank(item?.approvedAt) && sha256(item?.evidenceSha256)).map((item) => item.role));
  for (const role of requiredApprovalRoles) if (!approvedRoles.has(role)) fail(file, `aprovação válida ausente para ${role}.`);
  for (const key of ['identityReadiness', 'tenantMapping', 'exceptionRegister', 'reconciliationPlan', 'accessPolicy', 'cutoverRunbook']) if (!reference(pilot.references?.[key])) fail(file, `references.${key} é obrigatório e não pode conter TBD.`);
  if (!Number.isInteger(pilot.cutover?.rpoMinutes) || pilot.cutover.rpoMinutes < 0 || !Number.isInteger(pilot.cutover?.rtoMinutes) || pilot.cutover.rtoMinutes < 1 || !reference(pilot.cutover?.incidentChannel) || !reference(pilot.cutover?.returnCriteria)) fail(file, 'cutover deve declarar RPO/RTO, canal de incidente e retorno.');
  if (/\b(TBD|TODO)\b/i.test(JSON.stringify(pilot))) fail(file, 'uma carta ACTIVE não pode conter TBD/TODO.');
}

if (requireActive && activePilots.length !== 1) failures.push('Gate Marco 0 fechado: uma única carta ACTIVE é obrigatória antes de extração, carga ou corte.');
if (failures.length > 0) {
  globalThis.console.error('Falha na governança do Marco 0:');
  for (const failure of failures) globalThis.console.error(`- ${failure}`);
  globalThis.process.exitCode = 1;
} else if (activePilots.length === 0) {
  globalThis.console.log('Nenhum piloto ACTIVE: metadados validados; Gate Marco 0 permanece fechado para carga.');
} else {
  globalThis.console.log(`Carta Marco 0 validada: ${activePilots[0].file}`);
}
