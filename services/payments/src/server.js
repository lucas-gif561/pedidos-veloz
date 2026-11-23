'use strict';
const telemetry = require('./lib/telemetry'); // primeiro: instrumenta http/express

const { createObservability } = require('./lib/observability');
const { startServer } = require('./lib/lifecycle');
const { createApp } = require('./app');

const obs = createObservability('payments');
startServer(createApp({ obs }), { obs, onShutdown: () => telemetry.shutdown() });
