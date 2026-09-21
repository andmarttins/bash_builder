import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const migrationsDirectory = join(globalThis.process.cwd(), 'prisma', 'migrations');
const failClosedMigration = '20260921173000_fail_closed_internal_queue_privileges';
const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;

const migrationNames = (await readdir(migrationsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name >= failClosedMigration)
  .map((entry) => entry.name)
  .sort();

const missingAcl = [];
for (const migrationName of migrationNames) {
  const sql = await readFile(join(migrationsDirectory, migrationName, 'migration.sql'), 'utf8');
  for (const match of sql.matchAll(tablePattern)) {
    const table = match[1];
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const revokeRuntime = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+"?${escaped}"?\\s+FROM\\s+app_runtime`, 'i');
    if (!revokeRuntime.test(sql)) missingAcl.push(`${migrationName}: ${table}`);
  }
}

if (missingAcl.length > 0) {
  globalThis.console.error('Every table created after the fail-closed migration must explicitly revoke app_runtime access:');
  for (const entry of missingAcl) globalThis.console.error(`- ${entry}`);
  globalThis.process.exitCode = 1;
} else {
  globalThis.console.log(`Verified explicit app_runtime ACLs in ${migrationNames.length} fail-closed migration(s).`);
}
