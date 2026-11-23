'use strict';
// Tracing distribuído com OpenTelemetry. Precisa ser carregado ANTES de
// express/http/pg para que a instrumentação automática funcione.
// Configurado só por variáveis de ambiente (12-Factor III):
//   OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SDK_DISABLED
// Fonte única em /shared: rode `npm run sync-shared` depois de editar.

const INSTRUMENTATIONS = [
  ['@opentelemetry/instrumentation-http', 'HttpInstrumentation', {
    // Probes e scrapes não viram spans (seriam só ruído).
    ignoreIncomingRequestHook: (req) => /^\/(healthz|metrics)/.test(req.url || ''),
  }],
  ['@opentelemetry/instrumentation-express', 'ExpressInstrumentation', {}],
  ['@opentelemetry/instrumentation-undici', 'UndiciInstrumentation', {}], // fetch()
  ['@opentelemetry/instrumentation-pg', 'PgInstrumentation', {}],
];

let sdk;

if (process.env.OTEL_SDK_DISABLED !== 'true') {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

  // Cada serviço instala só as instrumentações de que precisa.
  const instrumentations = [];
  for (const [pkg, className, options] of INSTRUMENTATIONS) {
    try {
      instrumentations.push(new (require(pkg)[className])(options));
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }

  sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter(), instrumentations });
  sdk.start();
}

module.exports = {
  async shutdown() {
    if (sdk) await sdk.shutdown();
  },
};
