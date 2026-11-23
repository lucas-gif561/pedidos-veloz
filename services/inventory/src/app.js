'use strict';

const express = require('express');
const { HttpError } = require('./lib/observability');
const { normalizeItems } = require('./domain');

const ORDER_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function parseOrderId(value) {
  if (typeof value !== 'string' || !ORDER_ID_PATTERN.test(value)) {
    throw new HttpError(400, 'invalid_order_id', 'orderId inválido');
  }
  return value;
}

function createApp({ repo, obs }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(obs.httpMiddleware);
  obs.mountOps(app, { readiness: () => repo.ping() });

  const reservationsTotal = new obs.prom.Counter({
    name: 'inventory_reservations_total',
    help: 'Reservas de estoque por resultado',
    labelNames: ['result'],
    registers: [obs.registry],
  });

  app.get('/products', async (_req, res) => {
    res.json({ items: await repo.listProducts() });
  });

  app.get('/products/:sku', async (req, res) => {
    const product = await repo.getProduct(req.params.sku);
    if (!product) throw new HttpError(404, 'product_not_found', `Produto ${req.params.sku} não encontrado`);
    res.json(product);
  });

  app.post('/reservations', async (req, res) => {
    const orderId = parseOrderId(req.body?.orderId);
    const items = normalizeItems(req.body?.items);
    try {
      const reservation = await repo.reserve(orderId, items);
      reservationsTotal.inc({ result: 'reserved' });
      res.status(201).json(reservation);
    } catch (err) {
      reservationsTotal.inc({ result: err.code || 'error' });
      throw err;
    }
  });

  app.post('/reservations/:orderId/confirm', async (req, res) => {
    res.json(await repo.confirm(parseOrderId(req.params.orderId)));
  });

  app.post('/reservations/:orderId/release', async (req, res) => {
    res.json(await repo.release(parseOrderId(req.params.orderId)));
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Rota não encontrada')));
  app.use(obs.errorHandler);
  return app;
}

module.exports = { createApp };
