'use strict';
// Clientes dos serviços de Estoque e Pagamentos. As URLs vêm do ambiente
// (Service DNS no Kubernetes, nome do serviço no Compose).

const { requestOk } = require('./lib/http-client');

function createInventoryClient(baseUrl = process.env.INVENTORY_URL || 'http://localhost:8082') {
  const opts = { target: 'inventory', timeoutMs: 2000, retries: 2 }; // operações idempotentes por orderId
  return {
    reserve: (orderId, items) =>
      requestOk(`${baseUrl}/reservations`, { ...opts, method: 'POST', body: { orderId, items } }),
    confirm: (orderId) => requestOk(`${baseUrl}/reservations/${orderId}/confirm`, { ...opts, method: 'POST' }),
    release: (orderId) => requestOk(`${baseUrl}/reservations/${orderId}/release`, { ...opts, method: 'POST' }),
  };
}

function createPaymentsClient(baseUrl = process.env.PAYMENTS_URL || 'http://localhost:8083') {
  return {
    // Retry é seguro porque o provedor deduplica por orderId.
    charge: (payment) =>
      requestOk(`${baseUrl}/payments`, { target: 'payments', timeoutMs: 5000, retries: 1, method: 'POST', body: payment }),
  };
}

module.exports = { createInventoryClient, createPaymentsClient };
