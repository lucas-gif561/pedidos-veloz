'use strict';
const telemetry = require('./lib/telemetry'); // primeiro: instrumenta http/express/pg

const { createObservability } = require('./lib/observability');
const { startServer } = require('./lib/lifecycle');
const { createApp } = require('./app');

async function main() {
  const obs = createObservability('inventory');
  let repo;
  if (process.env.STORAGE === 'memory') {
    repo = require('./repo/memory').createMemoryRepo();
    obs.logger.warn('usando armazenamento em memória (apenas para desenvolvimento)');
  } else {
    repo = require('./repo/postgres').createPostgresRepo({ logger: obs.logger });
    if (process.env.MIGRATE_ON_START !== 'false') await repo.migrate();
  }

  startServer(createApp({ repo, obs }), {
    obs,
    onShutdown: async () => {
      await repo.close();
      await telemetry.shutdown();
    },
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', service: 'inventory', msg: 'startup_failed', err: err.message }));
  process.exit(1);
});
