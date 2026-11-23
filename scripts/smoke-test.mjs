// Smoke test ponta a ponta contra o API Gateway.
// Roda em qualquer SO com Node 20+ (Windows/Linux/macOS).
//
//   node scripts/smoke-test.mjs                         # http://localhost:8080
//   BASE_URL=http://localhost:8080 node scripts/smoke-test.mjs
//   node scripts/smoke-test.mjs --read-only             # só leituras (produção)

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const readOnly = process.argv.includes('--read-only');

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FALHOU  ${name}: ${err.message}`);
  }
}
function expect(cond, message) {
  if (!cond) throw new Error(message);
}
async function call(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log(`Smoke test em ${BASE_URL}`);

let products = [];
await step('GET /api/products lista o catálogo', async () => {
  const { status, body } = await call('GET', '/api/products');
  expect(status === 200, `status ${status}`);
  products = body.items;
  expect(products.length > 0, 'catálogo vazio');
});

if (!readOnly) {
  let orderId;
  await step('POST /api/orders cria um pedido', async () => {
    // Mouse barato + cartão: aprovado, a não ser pela taxa de recusa simulada.
    const { status, body } = await call('POST', '/api/orders', {
      customerId: 'smoke-test',
      items: [{ sku: 'MOUSE-001', quantity: 1 }],
      paymentMethod: 'pix',
    });
    expect([201, 402].includes(status), `status ${status}: ${JSON.stringify(body)}`);
    expect(body.id, 'pedido sem id');
    orderId = body.id;
    console.log(`        pedido ${orderId}: ${body.status}`);
  });

  await step('GET /api/orders/:id consulta o pedido', async () => {
    const { status, body } = await call('GET', `/api/orders/${orderId}`);
    expect(status === 200, `status ${status}`);
    expect(['CONFIRMED', 'PAYMENT_DECLINED'].includes(body.status), `status do pedido ${body.status}`);
  });

  await step('pedido acima do estoque é rejeitado com 409', async () => {
    const { status, body } = await call('POST', '/api/orders', {
      customerId: 'smoke-test',
      items: [{ sku: 'MON-001', quantity: 999 }],
    });
    expect(status === 409, `status ${status}`);
    expect(body.status === 'REJECTED', `status do pedido ${body.status}`);
  });

  await step('entrada inválida retorna 400', async () => {
    const { status } = await call('POST', '/api/orders', { items: [] });
    expect(status === 400, `status ${status}`);
  });
}

if (failures) {
  console.error(`\n${failures} verificação(ões) falharam`);
  process.exit(1);
}
console.log('\nTudo certo.');
