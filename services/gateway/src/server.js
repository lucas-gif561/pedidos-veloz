'use strict';
const telemetry = require('./lib/telemetry'); // primeiro: instrumenta http/express/fetch

const { createObservability } = require('./lib/observability');
const { startServer } = require('./lib/lifecycle');
const { createApp } = require('./app');

const obs = createObservability('gateway');
const upstreams = {
  orders: process.env.ORDERS_URL || 'http://localhost:8081',
  inventory: process.env.INVENTORY_URL || 'http://localhost:8082',
};
startServer(createApp({ obs, upstreams }), { obs, onShutdown: () => telemetry.shutdown() });
