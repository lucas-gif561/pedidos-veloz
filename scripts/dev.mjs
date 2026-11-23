// Sobe os 4 serviços SEM Docker, com armazenamento em memória e sem tracing.
// Útil para desenvolver a lógica rapidamente. Para o ambiente completo
// (Postgres, Jaeger, Prometheus, Grafana), use `docker compose up --build`.
//
//   npm run dev     -> gateway em http://localhost:8080
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const common = { OTEL_SDK_DISABLED: 'true', STORAGE: 'memory', LOG_LEVEL: process.env.LOG_LEVEL || 'info' };
const services = {
  inventory: { PORT: '8082' },
  payments: { PORT: '8083' },
  orders: { PORT: '8081', INVENTORY_URL: 'http://localhost:8082', PAYMENTS_URL: 'http://localhost:8083' },
  gateway: { PORT: '8080', ORDERS_URL: 'http://localhost:8081', INVENTORY_URL: 'http://localhost:8082' },
};

const children = Object.entries(services).map(([name, env]) => {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: join(root, 'services', name),
    env: { ...process.env, ...common, ...env },
    stdio: 'inherit',
  });
  child.on('exit', (code) => code && console.error(`${name} saiu com código ${code}`));
  return child;
});

const stop = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
