'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createApp } = require('../src/app');
const { createObservability } = require('../src/lib/observability');

const servers = [];
async function listen(app) {
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${server.address().port}`;
}

let base;
let lastOrderBody;

before(async () => {
  // Serviços internos falsos.
  const orders = express().use(express.json());
  orders.post('/orders', (req, res) => {
    lastOrderBody = req.body;
    res.status(201).json({ id: 'abc', status: 'CONFIRMED' });
  });
  orders.get('/orders', (req, res) => res.json({ items: [], query: req.query }));

  const inventory = express();
  inventory.get('/products', (_req, res) => res.json({ items: [{ sku: 'NOTE-001' }] }));
  inventory.get('/products/:sku', (req, res) => res.status(404).json({ error: 'product_not_found', sku: req.params.sku }));

  base = await listen(
    createApp({
      obs: createObservability('gateway', { logLevel: 'silent' }),
      upstreams: {
        orders: await listen(orders),
        inventory: await listen(inventory),
      },
    }),
  );
});
after(() => servers.forEach((s) => s.close()));

test('encaminha GET /api/products para o estoque', async () => {
  const res = await fetch(`${base}/api/products`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { items: [{ sku: 'NOTE-001' }] });
});

test('preserva status de erro do serviço interno', async () => {
  const res = await fetch(`${base}/api/products/XYZ-1`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).sku, 'XYZ-1');
});

test('encaminha POST /api/orders com o corpo', async () => {
  const payload = { customerId: 'c1', items: [{ sku: 'NOTE-001', quantity: 1 }] };
  const res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(lastOrderBody, payload);
});

test('repassa a query string', async () => {
  const body = await (await fetch(`${base}/api/orders?customerId=c1&limit=5`)).json();
  assert.deepEqual(body.query, { customerId: 'c1', limit: '5' });
});

test('serviço interno fora do ar vira 503', async () => {
  const app = createApp({
    obs: createObservability('gateway', { logLevel: 'silent' }),
    upstreams: { orders: 'http://127.0.0.1:1', inventory: 'http://127.0.0.1:1' },
  });
  const url = await listen(app);
  const res = await fetch(`${url}/api/products`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'upstream_unavailable');
});

test('rota desconhecida retorna 404', async () => {
  assert.equal((await fetch(`${base}/api/nada`)).status, 404);
});
