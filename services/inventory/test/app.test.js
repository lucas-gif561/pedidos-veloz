'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryRepo } = require('../src/repo/memory');
const { createObservability } = require('../src/lib/observability');

const seed = [
  { sku: 'AAA-1', name: 'A', priceCents: 1000, stock: 10 },
  { sku: 'BBB-1', name: 'B', priceCents: 250, stock: 2 },
];

let server;
let base;

beforeEach(async () => {
  const app = createApp({ repo: createMemoryRepo(seed), obs: createObservability('inventory', { logLevel: 'silent' }) });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('lista produtos com disponibilidade', async () => {
  const res = await fetch(`${base}/products`);
  assert.equal(res.status, 200);
  const { items } = await res.json();
  assert.deepEqual(items.map((p) => [p.sku, p.available]), [['AAA-1', 10], ['BBB-1', 2]]);
});

test('reserva calcula total e reduz a disponibilidade', async () => {
  const res = await post('/reservations', { orderId: 'o-1', items: [{ sku: 'AAA-1', quantity: 2 }, { sku: 'BBB-1', quantity: 1 }] });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.totalCents, 2250);
  assert.equal(body.status, 'RESERVED');
  const product = await (await fetch(`${base}/products/AAA-1`)).json();
  assert.equal(product.available, 8);
});

test('reserva é idempotente por orderId', async () => {
  await post('/reservations', { orderId: 'o-1', items: [{ sku: 'AAA-1', quantity: 3 }] });
  await post('/reservations', { orderId: 'o-1', items: [{ sku: 'AAA-1', quantity: 3 }] });
  const product = await (await fetch(`${base}/products/AAA-1`)).json();
  assert.equal(product.available, 7);
});

test('SKUs repetidos são somados', async () => {
  const res = await post('/reservations', { orderId: 'o-1', items: [{ sku: 'BBB-1', quantity: 1 }, { sku: 'BBB-1', quantity: 1 }] });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).lines[0].quantity, 2);
});

test('estoque insuficiente retorna 409 com detalhes', async () => {
  const res = await post('/reservations', { orderId: 'o-1', items: [{ sku: 'BBB-1', quantity: 3 }] });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'insufficient_stock');
  assert.deepEqual(body.details.items, [{ sku: 'BBB-1', requested: 3, available: 2 }]);
});

test('produto inexistente retorna 404', async () => {
  const res = await post('/reservations', { orderId: 'o-1', items: [{ sku: 'ZZZ-9', quantity: 1 }] });
  assert.equal(res.status, 404);
});

test('confirmação baixa o estoque e a liberação devolve', async () => {
  await post('/reservations', { orderId: 'o-1', items: [{ sku: 'AAA-1', quantity: 4 }] });
  await post('/reservations', { orderId: 'o-2', items: [{ sku: 'AAA-1', quantity: 1 }] });
  assert.equal((await post('/reservations/o-1/confirm')).status, 200);
  assert.equal((await post('/reservations/o-2/release')).status, 200);
  const product = await (await fetch(`${base}/products/AAA-1`)).json();
  assert.equal(product.available, 6);
  // reserva confirmada não pode ser liberada
  assert.equal((await post('/reservations/o-1/release')).status, 409);
});

test('valida o corpo da requisição', async () => {
  assert.equal((await post('/reservations', { orderId: 'o-1', items: [] })).status, 400);
  assert.equal((await post('/reservations', { orderId: 'o-1', items: [{ sku: 'AAA-1', quantity: 0 }] })).status, 400);
  assert.equal((await post('/reservations', { items: [{ sku: 'AAA-1', quantity: 1 }] })).status, 400);
  const bad = await fetch(`${base}/reservations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
});

test('expõe health checks e métricas', async () => {
  assert.equal((await fetch(`${base}/healthz/live`)).status, 200);
  assert.equal((await fetch(`${base}/healthz/ready`)).status, 200);
  const metrics = await (await fetch(`${base}/metrics`)).text();
  assert.match(metrics, /http_server_request_duration_seconds/);
});
