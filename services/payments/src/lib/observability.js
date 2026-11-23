// ARQUIVO GERADO: não edite aqui. Fonte em /shared (npm run sync-shared).
'use strict';
// Logs estruturados (JSON em stdout), métricas Prometheus, health checks e
// tratamento de erros, iguais em todos os serviços.
// Fonte única em /shared: rode `npm run sync-shared` depois de editar.

const pino = require('pino');
const prom = require('prom-client');
const { trace } = require('@opentelemetry/api');

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function currentTraceId() {
  const span = trace.getActiveSpan();
  return span ? span.spanContext().traceId : undefined;
}

const QUIET_PATHS = new Set(['/healthz/live', '/healthz/ready', '/metrics']);

function createObservability(serviceName, { logLevel = process.env.LOG_LEVEL || 'info' } = {}) {
  const state = { shuttingDown: false };

  // 12-Factor (XI): logs são um fluxo de eventos em stdout; a plataforma coleta.
  const logger = pino({
    level: logLevel,
    base: { service: serviceName, version: process.env.SERVICE_VERSION || 'dev' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    // Correlaciona log <-> trace: todo log emitido dentro de um span leva o trace_id.
    mixin() {
      const traceId = currentTraceId();
      return traceId ? { trace_id: traceId } : {};
    },
  });

  const registry = new prom.Registry();
  registry.setDefaultLabels({ service: serviceName });
  prom.collectDefaultMetrics({ register: registry });

  const httpDuration = new prom.Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'Duração das requisições HTTP recebidas',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  function httpMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    const traceId = currentTraceId();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      // Usa o padrão da rota (/orders/:id), não a URL real, para não explodir a cardinalidade.
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      httpDuration.observe({ method: req.method, route, status_code: String(res.statusCode) }, seconds);
      if (!QUIET_PATHS.has(req.path)) {
        logger.info(
          {
            method: req.method,
            route,
            path: req.originalUrl,
            status: res.statusCode,
            duration_ms: Math.round(seconds * 1000),
            ...(traceId && { trace_id: traceId }),
          },
          'http_request',
        );
      }
    });
    next();
  }

  function mountOps(app, { readiness = async () => {} } = {}) {
    // Liveness: o processo está vivo? Não checa dependências, para que uma queda
    // do banco não faça o Kubernetes reiniciar todos os pods em cascata.
    app.get('/healthz/live', (_req, res) => res.json({ status: 'ok' }));

    // Readiness: pode receber tráfego? Checa dependências e o estado de shutdown.
    app.get('/healthz/ready', async (_req, res) => {
      if (state.shuttingDown) return res.status(503).json({ status: 'shutting_down' });
      try {
        await readiness();
        return res.json({ status: 'ready' });
      } catch (err) {
        logger.warn({ err: err.message }, 'readiness_failed');
        return res.status(503).json({ status: 'not_ready' });
      }
    });

    app.get('/metrics', async (_req, res) => {
      res.set('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    });
  }

  // Express identifica o error handler pelos 4 parâmetros: _next é obrigatório.
  function errorHandler(err, req, res, _next) {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'O corpo da requisição não é um JSON válido' });
    }
    if (err instanceof HttpError) {
      return res
        .status(err.status)
        .json({ error: err.code, message: err.message, ...(err.details && { details: err.details }) });
    }
    logger.error({ err, path: req.originalUrl }, 'unhandled_error');
    return res.status(500).json({ error: 'internal_error', message: 'Erro interno' });
  }

  return { logger, registry, prom, state, httpMiddleware, mountOps, errorHandler };
}

module.exports = { createObservability, HttpError };
