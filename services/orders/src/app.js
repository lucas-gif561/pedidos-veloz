'use strict';

const express = require('express');
const { HttpError } = require('./lib/observability');
const { createOrderService } = require('./order-service');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER = /^[A-Za-z0-9_-]{1,64}$/;
const METHODS = new Set(['credit_card', 'pix', 'boleto']);

// Pedido criado: 201. Sem estoque: 409. Pagamento recusado: 402.
const STATUS_CODE = { CONFIRMED: 201, REJECTED: 409, PAYMENT_DECLINED: 402 };

function validateOrder(body) {
  const { customerId, items, paymentMethod = 'credit_card' } = body ?? {};
  if (typeof customerId !== 'string' || !CUSTOMER.test(customerId)) {
    throw new HttpError(400, 'invalid_customer', 'customerId inválido');
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new HttpError(400, 'invalid_items', 'items deve ser uma lista com 1 a 50 itens');
  }
  for (const item of items) {
    if (typeof item?.sku !== 'string' || !Number.isInteger(item?.quantity) || item.quantity < 1) {
      throw new HttpError(400, 'invalid_items', 'Cada item precisa de sku (texto) e quantity (inteiro >= 1)');
    }
  }
  if (!METHODS.has(paymentMethod)) {
    throw new HttpError(400, 'invalid_method', `paymentMethod deve ser um de: ${[...METHODS].join(', ')}`);
  }
  return { customerId, items: items.map(({ sku, quantity }) => ({ sku, quantity })), paymentMethod };
}

function createApp({ repo, inventory, payments, obs }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(obs.httpMiddleware);
  obs.mountOps(app, { readiness: () => repo.ping() });

  const metrics = {
    ordersTotal: new obs.prom.Counter({
      name: 'orders_total',
      help: 'Pedidos finalizados por status',
      labelNames: ['status'],
      registers: [obs.registry],
    }),
    sagaDuration: new obs.prom.Histogram({
      name: 'orders_saga_duration_seconds',
      help: 'Tempo total para processar um pedido (reserva, pagamento e confirmação)',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [obs.registry],
    }),
  };
  const service = createOrderService({ repo, inventory, payments, logger: obs.logger, metrics });

  app.post('/orders', async (req, res) => {
    const { order, details } = await service.placeOrder(validateOrder(req.body));
    res.status(STATUS_CODE[order.status] ?? 200).json({ ...order, ...(details && { details }) });
  });

  app.get('/orders', async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
    res.json({ items: await repo.list({ limit, customerId }) });
  });

  app.get('/orders/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) throw new HttpError(400, 'invalid_id', 'id deve ser um UUID');
    const order = await repo.get(req.params.id);
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido não encontrado');
    res.json(order);
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Rota não encontrada')));
  app.use(obs.errorHandler);
  return app;
}

module.exports = { createApp };
