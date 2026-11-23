// Teste de carga com k6 (https://k6.io) para simular o pico da campanha e
// ver o HPA escalando.
//
//   k6 run scripts/load-test.js
//   k6 run -e BASE_URL=http://localhost:8080 scripts/load-test.js
//
// Em outro terminal:  kubectl -n pedidos-veloz get hpa -w
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const SKUS = ['MOUSE-001', 'TECL-001', 'FONE-001'];

export const options = {
  stages: [
    { duration: '1m', target: 20 },   // aquecimento
    { duration: '3m', target: 150 },  // pico da campanha
    { duration: '1m', target: 0 },    // fim
  ],
  // SLOs do MVP: o teste falha se forem violados.
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{name:browse}': ['p(95)<300'],
    'http_req_duration{name:checkout}': ['p(95)<1500'],
  },
};

export default function () {
  // 80% navegação, 20% compra: proporção típica de e-commerce.
  const browse = http.get(`${BASE_URL}/api/products`, { tags: { name: 'browse' } });
  check(browse, { 'catálogo 200': (r) => r.status === 200 });

  if (Math.random() < 0.2) {
    const res = http.post(
      `${BASE_URL}/api/orders`,
      JSON.stringify({
        customerId: `load-${__VU}`,
        items: [{ sku: SKUS[Math.floor(Math.random() * SKUS.length)], quantity: 1 }],
        paymentMethod: 'pix',
      }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'checkout' } },
    );
    // 402 (recusa simulada) e 409 (estoque acabou) são respostas de negócio válidas.
    check(res, { 'pedido processado': (r) => [201, 402, 409].includes(r.status) });
  }
  sleep(1);
}
