'use strict';

function createMemoryRepo() {
  const orders = new Map();
  const now = () => new Date().toISOString();
  const empty = { totalCents: null, paymentId: null, failureReason: null, lines: null };

  return {
    async ping() {},
    async create(order) {
      const row = { ...empty, ...order, createdAt: now(), updatedAt: now() };
      orders.set(row.id, row);
      return { ...row };
    },
    async update(id, patch) {
      const row = { ...orders.get(id), ...patch, updatedAt: now() };
      orders.set(id, row);
      return { ...row };
    },
    async get(id) {
      const row = orders.get(id);
      return row ? { ...row } : null;
    },
    async list({ limit = 20, customerId } = {}) {
      return [...orders.values()]
        .filter((o) => !customerId || o.customerId === customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
    async close() {},
  };
}

module.exports = { createMemoryRepo };
