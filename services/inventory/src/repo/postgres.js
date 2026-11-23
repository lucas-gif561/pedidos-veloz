'use strict';
// Repositório PostgreSQL. A conexão vem das variáveis padrão do libpq
// (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE), e nada fica no código.
// Concorrência: SELECT ... FOR UPDATE trava as linhas de produto durante a
// reserva, então dois pedidos simultâneos não vendem a mesma unidade.

const { Pool } = require('pg');
const { HttpError } = require('../lib/observability');
const { planReservation, SEED_PRODUCTS } = require('../domain');

const MIGRATION_LOCK_ID = 7_310_001; // advisory lock: só uma réplica migra por vez

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  sku          TEXT PRIMARY KEY,
  name         TEXT    NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  stock        INTEGER NOT NULL CHECK (stock >= 0),
  reserved     INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= stock)
);
CREATE TABLE IF NOT EXISTS reservations (
  order_id     TEXT PRIMARY KEY,
  status       TEXT    NOT NULL,
  lines        JSONB   NOT NULL,
  total_cents  INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

const toReservation = (row) => ({
  orderId: row.order_id,
  status: row.status,
  lines: row.lines,
  totalCents: row.total_cents,
});

function createPostgresRepo({ logger, poolSize = Number(process.env.PG_POOL_SIZE || 10) } = {}) {
  const pool = new Pool({ max: poolSize, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
  pool.on('error', (err) => logger?.error({ err }, 'pg_pool_error'));

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function lockReservation(client, orderId) {
    const { rows } = await client.query('SELECT * FROM reservations WHERE order_id = $1 FOR UPDATE', [orderId]);
    if (!rows.length) throw new HttpError(404, 'reservation_not_found', `Reserva do pedido ${orderId} não encontrada`);
    return toReservation(rows[0]);
  }

  async function setStatus(client, orderId, status) {
    await client.query('UPDATE reservations SET status = $2, updated_at = now() WHERE order_id = $1', [orderId, status]);
  }

  return {
    async migrate() {
      await tx(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
        await client.query(SCHEMA);
        for (const p of SEED_PRODUCTS) {
          await client.query(
            'INSERT INTO products (sku, name, price_cents, stock) VALUES ($1, $2, $3, $4) ON CONFLICT (sku) DO NOTHING',
            [p.sku, p.name, p.priceCents, p.stock],
          );
        }
      });
      logger?.info('migrations_applied');
    },

    async ping() {
      await pool.query('SELECT 1');
    },

    async listProducts() {
      const { rows } = await pool.query(
        'SELECT sku, name, price_cents, stock - reserved AS available FROM products ORDER BY sku',
      );
      return rows.map((r) => ({ sku: r.sku, name: r.name, priceCents: r.price_cents, available: r.available }));
    },

    async getProduct(sku) {
      const { rows } = await pool.query(
        'SELECT sku, name, price_cents, stock - reserved AS available FROM products WHERE sku = $1',
        [sku],
      );
      const r = rows[0];
      return r ? { sku: r.sku, name: r.name, priceCents: r.price_cents, available: r.available } : null;
    },

    async reserve(orderId, items) {
      return tx(async (client) => {
        const existing = await client.query('SELECT * FROM reservations WHERE order_id = $1', [orderId]);
        if (existing.rowCount) return toReservation(existing.rows[0]); // idempotente

        // ORDER BY sku: todas as transações travam na mesma ordem (evita deadlock).
        const { rows } = await client.query(
          'SELECT sku, name, price_cents, stock, reserved FROM products WHERE sku = ANY($1) ORDER BY sku FOR UPDATE',
          [items.map((i) => i.sku)],
        );
        const products = new Map(
          rows.map((r) => [r.sku, { sku: r.sku, name: r.name, priceCents: r.price_cents, stock: r.stock, reserved: r.reserved }]),
        );
        const plan = planReservation(products, items);
        for (const line of plan.lines) {
          await client.query('UPDATE products SET reserved = reserved + $2 WHERE sku = $1', [line.sku, line.quantity]);
        }
        await client.query(
          "INSERT INTO reservations (order_id, status, lines, total_cents) VALUES ($1, 'RESERVED', $2, $3)",
          [orderId, JSON.stringify(plan.lines), plan.totalCents],
        );
        return { orderId, status: 'RESERVED', ...plan };
      });
    },

    async confirm(orderId) {
      return tx(async (client) => {
        const r = await lockReservation(client, orderId);
        if (r.status === 'CONFIRMED') return r;
        if (r.status !== 'RESERVED') throw new HttpError(409, 'invalid_state', `Reserva está ${r.status}`);
        for (const line of r.lines) {
          await client.query(
            'UPDATE products SET stock = stock - $2, reserved = reserved - $2 WHERE sku = $1',
            [line.sku, line.quantity],
          );
        }
        await setStatus(client, orderId, 'CONFIRMED');
        return { ...r, status: 'CONFIRMED' };
      });
    },

    async release(orderId) {
      return tx(async (client) => {
        const r = await lockReservation(client, orderId);
        if (r.status === 'RELEASED') return r;
        if (r.status !== 'RESERVED') throw new HttpError(409, 'invalid_state', `Reserva está ${r.status}`);
        for (const line of r.lines) {
          await client.query('UPDATE products SET reserved = reserved - $2 WHERE sku = $1', [line.sku, line.quantity]);
        }
        await setStatus(client, orderId, 'RELEASED');
        return { ...r, status: 'RELEASED' };
      });
    },

    async close() {
      await pool.end();
    },
  };
}

module.exports = { createPostgresRepo };
