'use strict';
// Regras de negócio do estoque, puras (sem I/O): as duas implementações de
// repositório (memória e PostgreSQL) usam as mesmas regras.

const { HttpError } = require('./lib/observability');

const SKU_PATTERN = /^[A-Z0-9-]{3,32}$/;

/** Valida e normaliza os itens (junta SKUs repetidos). */
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new HttpError(400, 'invalid_items', 'items deve ser uma lista com 1 a 50 itens');
  }
  const bySku = new Map();
  for (const item of items) {
    const sku = item?.sku;
    const quantity = item?.quantity;
    if (typeof sku !== 'string' || !SKU_PATTERN.test(sku)) {
      throw new HttpError(400, 'invalid_sku', `SKU inválido: ${JSON.stringify(sku)}`);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      throw new HttpError(400, 'invalid_quantity', `Quantidade inválida para ${sku}`);
    }
    bySku.set(sku, (bySku.get(sku) || 0) + quantity);
  }
  return [...bySku].map(([sku, quantity]) => ({ sku, quantity })).sort((a, b) => a.sku.localeCompare(b.sku));
}

/**
 * Verifica a disponibilidade e monta as linhas da reserva.
 * @param {Map<string, {sku,name,priceCents,stock,reserved}>} products produtos já travados para update
 */
function planReservation(products, items) {
  const missing = items.filter((i) => !products.has(i.sku)).map((i) => i.sku);
  if (missing.length) {
    throw new HttpError(404, 'product_not_found', 'Produto(s) não encontrado(s)', { skus: missing });
  }
  const insufficient = items
    .map((i) => ({ ...i, available: products.get(i.sku).stock - products.get(i.sku).reserved }))
    .filter((i) => i.available < i.quantity)
    .map(({ sku, quantity, available }) => ({ sku, requested: quantity, available }));
  if (insufficient.length) {
    throw new HttpError(409, 'insufficient_stock', 'Estoque insuficiente', { items: insufficient });
  }
  const lines = items.map(({ sku, quantity }) => {
    const p = products.get(sku);
    return { sku, name: p.name, quantity, unitPriceCents: p.priceCents, subtotalCents: p.priceCents * quantity };
  });
  return { lines, totalCents: lines.reduce((sum, l) => sum + l.subtotalCents, 0) };
}

const SEED_PRODUCTS = [
  { sku: 'NOTE-001', name: 'Notebook Veloz 14"', priceCents: 459900, stock: 50 },
  { sku: 'MOUSE-001', name: 'Mouse sem fio', priceCents: 8990, stock: 500 },
  { sku: 'TECL-001', name: 'Teclado mecânico', priceCents: 34990, stock: 200 },
  { sku: 'MON-001', name: 'Monitor 27" 4K', priceCents: 219900, stock: 30 },
  { sku: 'FONE-001', name: 'Headset USB-C', priceCents: 29990, stock: 150 },
];

module.exports = { normalizeItems, planReservation, SEED_PRODUCTS };
