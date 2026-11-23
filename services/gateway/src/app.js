'use strict';
// API Gateway: único ponto de entrada HTTP. Roteia /api/* para os serviços
// internos, aplica limites (tamanho do corpo, timeout) e esconde a topologia
// interna do cliente. O tracing começa aqui, e o `traceparent` segue
// automaticamente para os serviços seguintes.

const express = require('express');
const { HttpError } = require('./lib/observability');
const { request } = require('./lib/http-client');

function createApp({ obs, upstreams }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(obs.httpMiddleware);
  // Readiness do gateway NÃO depende dos serviços internos: se Pedidos cair,
  // a vitrine (GET /api/products) continua no ar. Falhas viram 503 por rota.
  obs.mountOps(app);

  app.use((_req, res, next) => {
    res.set({ 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
    next();
  });

  // Encaminha a requisição e devolve o status e o corpo do serviço interno.
  const forward = (target, buildPath, { timeoutMs = 3000, retries = 0 } = {}) => async (req, res) => {
    const query = new URLSearchParams(req.query).toString();
    const url = `${upstreams[target]}${buildPath(req)}${query ? `?${query}` : ''}`;
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const { status, body } = await request(url, {
      method: req.method,
      body: hasBody ? req.body ?? {} : undefined,
      timeoutMs,
      retries,
      target,
    });
    res.status(status).json(body);
  };

  const enc = encodeURIComponent;

  // Leituras são idempotentes: podem tentar de novo.
  app.get('/api/products', forward('inventory', () => '/products', { retries: 1 }));
  app.get('/api/products/:sku', forward('inventory', (r) => `/products/${enc(r.params.sku)}`, { retries: 1 }));
  app.get('/api/orders', forward('orders', () => '/orders', { retries: 1 }));
  app.get('/api/orders/:id', forward('orders', (r) => `/orders/${enc(r.params.id)}`, { retries: 1 }));
  // Criação de pedido: sem retry no gateway (não é idempotente para o cliente), timeout maior (saga).
  app.post('/api/orders', forward('orders', () => '/orders', { timeoutMs: 15000 }));

  app.get('/', (_req, res) =>
    res.json({
      name: 'Pedidos Veloz API',
      version: process.env.SERVICE_VERSION || 'dev',
      endpoints: ['GET /api/products', 'GET /api/products/:sku', 'POST /api/orders', 'GET /api/orders', 'GET /api/orders/:id'],
    }),
  );

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Rota não encontrada')));
  app.use(obs.errorHandler);
  return app;
}

module.exports = { createApp };
