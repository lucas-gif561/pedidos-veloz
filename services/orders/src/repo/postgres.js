'use strict';
// Conexão pelas variáveis padrão do libpq (PGHOST, PGUSER, PGPASSWORD, PGDATABASE...).

const { Pool } = require('pg');

const MIGRATION_LOCK_ID = 7_310_002;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY,
  customer_id     TEXT        NOT NULL,
  status          TEXT        NOT NULL,
  items           JSONB       NOT NULL,
  lines           JSONB,
  total_cents     INTEGER,
  payment_id      TEXT,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at DESC);`;

const COLUMNS = {
  status: 'status',
  totalCents: 'total_cents',
  paymentId: 'payment_id',
  failureReason: 'failure_reason',
  lines: 'lines',
};

const toOrder = (r) => ({
  id: r.id,
  customerId: r.customer_id,
  status: r.status,
  items: r.items,
  lines: r.lines,
  totalCents: r.total_cents,
  paymentId: r.payment_id,
  failureReason: r.failure_reason,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

function createPostgresRepo({ logger, poolSize = Number(process.env.PG_POOL_SIZE || 10) } = {}) {
  const pool = new Pool({ max: poolSize, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
  pool.on('error', (err) => logger?.error({ err }, 'pg_pool_error'));

  return {
    async migrate() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
        await client.query(SCHEMA);
        await client.query('COMMIT');
        logger?.info('migrations_applied');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async ping() {
      await pool.query('SELECT 1');
    },

    async create({ id, customerId, items, status }) {
      const { rows } = await pool.query(
        'INSERT INTO orders (id, customer_id, items, status) VALUES ($1, $2, $3, $4) RETURNING *',
        [id, customerId, JSON.stringify(items), status],
      );
      return toOrder(rows[0]);
    },

    async update(id, patch) {
      const sets = [];
      const values = [id];
      for (const [key, column] of Object.entries(COLUMNS)) {
        if (patch[key] === undefined) continue;
        values.push(key === 'lines' ? JSON.stringify(patch[key]) : patch[key]);
        sets.push(`${column} = $${values.length}`);
      }
      const { rows } = await pool.query(
        `UPDATE orders SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
        values,
      );
      return toOrder(rows[0]);
    },

    async get(id) {
      const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
      return rows[0] ? toOrder(rows[0]) : null;
    },

    async list({ limit = 20, customerId } = {}) {
      const { rows } = customerId
        ? await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2', [customerId, limit])
        : await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT $1', [limit]);
      return rows.map(toOrder);
    },

    async close() {
      await pool.end();
    },
  };
}

module.exports = { createPostgresRepo };
