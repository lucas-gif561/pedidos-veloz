'use strict';
const telemetry = require('./lib/telemetry'); // primeiro: instrumenta http/express/pg/fetch

const { createObservability } = require('./lib/observability');
const { startServer } = require('./lib/lifecycle');
const { createApp } = require('./app');
const { createInventoryClient, createPaymentsClient } = require('./clients');

async function main() {
  const obs = createObservability('orders');
  let repo;
  if (process.env.STORAGE === 'memory') {
    repo = require('./repo/memory').createMemoryRepo();
    obs.logger.warn('usando armazenamento em memória (apenas para desenvolvimento)');
  } else {
    repo = require('./repo/postgres').createPostgresRepo({ logger: obs.logger });
    if (process.env.MIGRATE_ON_START !== 'false') await repo.migrate();
  }

  const app = createApp({ repo, inventory: createInventoryClient(), payments: createPaymentsClient(), obs });
  startServer(app, {
    obs,
    onShutdown: async () => {
      await repo.close();
      await telemetry.shutdown();
    },
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', service: 'orders', msg: 'startup_failed', err: err.message }));
  process.exit(1);
});
