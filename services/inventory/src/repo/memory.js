'use strict';
// Repositório em memória: usado nos testes e para rodar o serviço sem banco.

const { HttpError } = require('../lib/observability');
const { planReservation, SEED_PRODUCTS } = require('../domain');

function createMemoryRepo(seed = SEED_PRODUCTS) {
  const products = new Map(seed.map((p) => [p.sku, { reserved: 0, ...p }]));
  const reservations = new Map();

  const view = (p) => ({ sku: p.sku, name: p.name, priceCents: p.priceCents, available: p.stock - p.reserved });

  function getReservation(orderId) {
    const r = reservations.get(orderId);
    if (!r) throw new HttpError(404, 'reservation_not_found', `Reserva do pedido ${orderId} não encontrada`);
    return r;
  }

  return {
    async ping() {},
    async listProducts() {
      return [...products.values()].map(view);
    },
    async getProduct(sku) {
      const p = products.get(sku);
      return p ? view(p) : null;
    },
    async reserve(orderId, items) {
      if (reservations.has(orderId)) return reservations.get(orderId); // idempotente
      const plan = planReservation(products, items);
      for (const line of plan.lines) products.get(line.sku).reserved += line.quantity;
      const reservation = { orderId, status: 'RESERVED', ...plan };
      reservations.set(orderId, reservation);
      return reservation;
    },
    async confirm(orderId) {
      const r = getReservation(orderId);
      if (r.status === 'CONFIRMED') return r;
      if (r.status !== 'RESERVED') throw new HttpError(409, 'invalid_state', `Reserva está ${r.status}`);
      for (const line of r.lines) {
        const p = products.get(line.sku);
        p.stock -= line.quantity;
        p.reserved -= line.quantity;
      }
      r.status = 'CONFIRMED';
      return r;
    },
    async release(orderId) {
      const r = getReservation(orderId);
      if (r.status === 'RELEASED') return r;
      if (r.status !== 'RESERVED') throw new HttpError(409, 'invalid_state', `Reserva está ${r.status}`);
      for (const line of r.lines) products.get(line.sku).reserved -= line.quantity;
      r.status = 'RELEASED';
      return r;
    },
    async close() {},
  };
}

module.exports = { createMemoryRepo };
