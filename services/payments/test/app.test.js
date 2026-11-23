'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createObservability } = require('../src/lib/observability');

let server;

async function start({ random = () => 0.99, ...config } = {}) {
  const app = createApp({
    obs: createObservability('payments', { logLevel: 'silent' }),
    config: { latencyMs: 0, jitterMs: 0, failureRate: 0.05, maxAmountCents: 100_000, ...config },
    random,
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (body) =>
    fetch(`${base}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
afterEach(() => server?.close());

test('aprova pagamento dentro do limite', async () => {
  const pay = await start();
  const res = await pay({ orderId: 'o-1', amountCents: 5000, method: 'pix' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'APPROVED');
  assert.equal(body.method, 'pix');
});

test('recusa acima do limite por transação', async () => {
  const pay = await start();
  const body = await (await pay({ orderId: 'o-1', amountCents: 100_001 })).json();
  assert.equal(body.status, 'DECLINED');
  assert.equal(body.reason, 'limit_exceeded');
});

test('recusa aleatória conforme a taxa configurada', async () => {
  const pay = await start({ random: () => 0.01 });
  const body = await (await pay({ orderId: 'o-1', amountCents: 100 })).json();
  assert.equal(body.reason, 'issuer_declined');
});

test('é idempotente por orderId', async () => {
  const pay = await start();
  const first = await (await pay({ orderId: 'o-1', amountCents: 100 })).json();
  const again = await pay({ orderId: 'o-1', amountCents: 100 });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, first.id);
});

test('valida a entrada', async () => {
  const pay = await start();
  assert.equal((await pay({ orderId: 'o-1', amountCents: -1 })).status, 400);
  assert.equal((await pay({ orderId: 'o-1', amountCents: 10, method: 'cheque' })).status, 400);
  assert.equal((await pay({ amountCents: 10 })).status, 400);
});
