// Copia os módulos comuns de /shared para services/*/src/lib.
// Cada serviço continua com sua própria imagem e deploy, sem dependência de
// build entre eles. Em uma empresa, isso seria um pacote npm interno versionado.
//
//   node scripts/sync-shared.mjs          copia os arquivos
//   node scripts/sync-shared.mjs --check  falha se alguma cópia estiver desatualizada (usado no CI)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

// Arquivos que cada serviço recebe.
const FILES_BY_SERVICE = {
  gateway: ['observability.js', 'telemetry.js', 'lifecycle.js', 'http-client.js'],
  orders: ['observability.js', 'telemetry.js', 'lifecycle.js', 'http-client.js'],
  inventory: ['observability.js', 'telemetry.js', 'lifecycle.js'],
  payments: ['observability.js', 'telemetry.js', 'lifecycle.js'],
};

const HEADER = '// ARQUIVO GERADO: não edite aqui. Fonte em /shared (npm run sync-shared).\n';
let outdated = 0;

for (const service of readdirSync(join(root, 'services'))) {
  const files = FILES_BY_SERVICE[service];
  if (!files) continue;
  const libDir = join(root, 'services', service, 'src', 'lib');
  mkdirSync(libDir, { recursive: true });
  for (const file of files) {
    const expected = HEADER + readFileSync(join(root, 'shared', file), 'utf8');
    const target = join(libDir, file);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === expected) continue;
    if (check) {
      console.error(`desatualizado: services/${service}/src/lib/${file}`);
      outdated += 1;
    } else {
      writeFileSync(target, expected);
      console.log(`atualizado: services/${service}/src/lib/${file}`);
    }
  }
}

if (check && outdated) {
  console.error('\nRode `npm run sync-shared` e faça commit dos arquivos.');
  process.exit(1);
}
