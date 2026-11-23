'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryRepo } = require('../src/repo/memory');
const { createObservability, HttpError } = require('../src/lib/observability');

// Dublês dos serviços de Estoque e Pagamentos, que registram as chamadas.
function fakeInventory({ reserveError } = {}) {
  const calls = [];
  return {
    calls,
    async reserve(orderId, items) {
      calls.push(['reserve', orderId]);
      if (reserveError) throw reserveError;
      return { orderId, status: 'RESERVED', totalCents: items.length * 1000, lines: [] };
    },
    async confirm(orderId) {
      calls.push(['confirm', orderId]);
    },
    async release(orderId) {
      calls.push(['release', orderId]);
    },
  };
}
function fakePayments({ status = 'APPROVED', reason = null, error } = {}) {
  return {
    async charge({ orderId }) {
      if (error) throw error;
      return { id: 'pay-1', orderId, status, reason };
    },
  };
}

let server;
async function start({ inventory = fakeInventory(), payments = fakePayments() } = {}) {
  const app = createApp({
    repo: createMemoryRepo(),
    inventory,
    payments,
    obs: createObservability('orders', { logLevel: 'silent' }),
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    order: (body) =>
      fetch(`${base}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  };
}
afterEach(() => server?.close());

const validOrder = { customerId: 'cliente-1', items: [{ sku: 'NOTE-001', quantity: 1 }] };

test('pedido feliz: reserva, cobra, confirma e retorna 201', async () => {
  const inventory = fakeInventory();
  const { base, order } = await start({ inventory });
  const res = await order(validOrder);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'CONFIRMED');
  assert.equal(body.totalCents, 1000);
  assert.deepEqual(inventory.calls.map(([op]) => op), ['reserve', 'confirm']);

  const fetched = await (await fetch(`${base}/orders/${body.id}`)).json();
  assert.equal(fetched.status, 'CONFIRMED');
});

test('sem estoque: pedido REJECTED com 409', async () => {
  const inventory = fakeInventory({
    reserveError: new HttpError(409, 'insufficient_stock', 'Estoque insuficiente', { items: [] }),
  });
  const { order } = await start({ inventory });
  const res = await order(validOrder);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).status, 'REJECTED');
});

test('pagamento recusado: libera a reserva (compensação) e retorna 402', async () => {
  const inventory = fakeInventory();
  const { order } = await start({ inventory, payments: fakePayments({ status: 'DECLINED', reason: 'issuer_declined' }) });
  const res = await order(validOrder);
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.status, 'PAYMENT_DECLINED');
  assert.equal(body.failureReason, 'issuer_declined');
  assert.deepEqual(inventory.calls.map(([op]) => op), ['reserve', 'release']);
});

test('pagamento fora do ar: libera a reserva e retorna 503', async () => {
  const inventory = fakeInventory();
  const { base, order } = await start({
    inventory,
    payments: fakePayments({ error: new HttpError(503, 'upstream_unavailable', 'fora') }),
  });
  const res = await order(validOrder);
  assert.equal(res.status, 503);
  const { details } = await res.json();
  assert.deepEqual(inventory.calls.map(([op]) => op), ['reserve', 'release']);
  const saved = await (await fetch(`${base}/orders/${details.orderId}`)).json();
  assert.equal(saved.status, 'FAILED');
});

test('estoque fora do ar: retorna 503 sem cobrar', async () => {
  let charged = false;
  const { order } = await start({
    inventory: fakeInventory({ reserveError: new HttpError(503, 'upstream_unavailable', 'fora') }),
    payments: { charge: async () => { charged = true; } },
  });
  assert.equal((await order(validOrder)).status, 503);
  assert.equal(charged, false);
});

test('valida a entrada', async () => {
  const { base, order } = await start();
  assert.equal((await order({ items: validOrder.items })).status, 400);
  assert.equal((await order({ customerId: 'c', items: [] })).status, 400);
  assert.equal((await order({ ...validOrder, paymentMethod: 'cheque' })).status, 400);
  assert.equal((await fetch(`${base}/orders/nao-e-uuid`)).status, 400);
  assert.equal((await fetch(`${base}/orders/00000000-0000-4000-8000-000000000000`)).status, 404);
});

test('lista pedidos mais recentes primeiro', async () => {
  const { base, order } = await start();
  await order(validOrder);
  await order({ ...validOrder, customerId: 'cliente-2' });
  const { items } = await (await fetch(`${base}/orders?customerId=cliente-2`)).json();
  assert.equal(items.length, 1);
  assert.equal(items[0].customerId, 'cliente-2');
});
