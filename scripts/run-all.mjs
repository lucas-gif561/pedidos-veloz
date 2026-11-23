// Roda `npm install` ou `npm test` em todos os serviços (multiplataforma).
//   node scripts/run-all.mjs install | test
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] === 'install' ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund'] : ['test'];
const services = ['gateway', 'orders', 'inventory', 'payments'];

let failed = [];
for (const service of services) {
  console.log(`\n=== ${service}: npm ${command[0]}`);
  const result = spawnSync('npm', command, { cwd: join(root, 'services', service), stdio: 'inherit', shell: true });
  if (result.status !== 0) failed.push(service);
}
if (failed.length) {
  console.error(`\nFalhou em: ${failed.join(', ')}`);
  process.exit(1);
}
