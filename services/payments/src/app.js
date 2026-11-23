'use strict';
// Simula a integração com um provedor de pagamento externo (sandbox).
// Latência, taxa de recusa e limite por transação são configuráveis por
// variável de ambiente, para provocar falhas em testes de resiliência.

const { randomUUID } = require('node:crypto');
const express = require('express');
const { HttpError } = require('./lib/observability');

const METHODS = new Set(['credit_card', 'pix', 'boleto']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadConfig(env = process.env) {
  return {
    latencyMs: Number(env.PAYMENT_LATENCY_MS ?? 150),
    jitterMs: Number(env.PAYMENT_JITTER_MS ?? 100),
    failureRate: Number(env.PAYMENT_FAILURE_RATE ?? 0.05),
    maxAmountCents: Number(env.PAYMENT_MAX_AMOUNT_CENTS ?? 2_000_000),
  };
}

function createApp({ obs, config = loadConfig(), random = Math.random }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(obs.httpMiddleware);
  obs.mountOps(app);

  const paymentsTotal = new obs.prom.Counter({
    name: 'payments_total',
    help: 'Pagamentos processados por status e método',
    labelNames: ['status', 'method'],
    registers: [obs.registry],
  });

  // Chave de idempotência = orderId. Um provedor real guarda isso do lado dele;
  // aqui fica em memória com limite de tamanho, o que basta para o mock.
  const processed = new Map();
  const MAX_ENTRIES = 10_000;

  app.post('/payments', async (req, res) => {
    const { orderId, amountCents, method = 'credit_card' } = req.body ?? {};
    if (typeof orderId !== 'string' || !orderId || orderId.length > 64) {
      throw new HttpError(400, 'invalid_order_id', 'orderId inválido');
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new HttpError(400, 'invalid_amount', 'amountCents deve ser um inteiro positivo');
    }
    if (!METHODS.has(method)) {
      throw new HttpError(400, 'invalid_method', `Método deve ser um de: ${[...METHODS].join(', ')}`);
    }

    if (processed.has(orderId)) return res.status(200).json(processed.get(orderId));

    await sleep(config.latencyMs + random() * config.jitterMs);

    let status = 'APPROVED';
    let reason = null;
    if (amountCents > config.maxAmountCents) {
      status = 'DECLINED';
      reason = 'limit_exceeded';
    } else if (random() < config.failureRate) {
      status = 'DECLINED';
      reason = 'issuer_declined';
    }

    const payment = {
      id: randomUUID(),
      orderId,
      amountCents,
      method,
      status,
      reason,
      provider: 'veloz-pay-sandbox',
      processedAt: new Date().toISOString(),
    };
    if (processed.size >= MAX_ENTRIES) processed.delete(processed.keys().next().value);
    processed.set(orderId, payment);
    paymentsTotal.inc({ status, method });
    obs.logger.info({ orderId, status, reason, amountCents }, 'payment_processed');
    return res.status(201).json(payment);
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Rota não encontrada')));
  app.use(obs.errorHandler);
  return app;
}

module.exports = { createApp, loadConfig };
