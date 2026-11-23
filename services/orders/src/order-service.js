'use strict';
// Criação de pedido como uma saga orquestrada: cada passo tem uma compensação.
//
//   1. grava o pedido como PENDING
//   2. reserva estoque       -> falha de negócio: REJECTED
//   3. cobra o pagamento     -> recusado: libera a reserva e fica PAYMENT_DECLINED
//   4. confirma a reserva (baixa definitiva) e fica CONFIRMED
//
// Se uma dependência estiver fora do ar, o pedido fica FAILED e as reservas
// feitas até ali são liberadas. Não existe transação distribuída: a
// consistência é eventual, garantida por compensação e idempotência (orderId).

const { randomUUID } = require('node:crypto');
const { HttpError } = require('./lib/observability');

function createOrderService({ repo, inventory, payments, logger, metrics }) {
  async function finish(order, patch) {
    const updated = await repo.update(order.id, patch);
    metrics.ordersTotal.inc({ status: updated.status });
    logger.info({ orderId: order.id, status: updated.status, reason: updated.failureReason }, 'order_finished');
    return updated;
  }

  async function compensate(orderId) {
    try {
      await inventory.release(orderId);
    } catch (err) {
      // A reserva fica órfã. Um job de reconciliação (fora do MVP) resolveria isso.
      logger.error({ orderId, err: err.message }, 'compensation_failed');
    }
  }

  async function placeOrder({ customerId, items, paymentMethod }) {
    const endTimer = metrics.sagaDuration.startTimer();
    let order = await repo.create({ id: randomUUID(), customerId, items, status: 'PENDING' });
    try {
      let reservation;
      try {
        reservation = await inventory.reserve(order.id, items);
      } catch (err) {
        // 4xx do estoque = recusa de negócio (sem estoque, SKU inexistente/inválido).
        if (err.status >= 400 && err.status < 500) {
          order = await finish(order, { status: 'REJECTED', failureReason: err.code });
          return { order, details: err.details };
        }
        await finish(order, { status: 'FAILED', failureReason: 'inventory_unavailable' });
        throw new HttpError(503, 'inventory_unavailable', 'Estoque indisponível, tente novamente', { orderId: order.id });
      }

      let payment;
      try {
        payment = await payments.charge({ orderId: order.id, amountCents: reservation.totalCents, method: paymentMethod });
      } catch {
        await compensate(order.id);
        await finish(order, { status: 'FAILED', failureReason: 'payment_unavailable', totalCents: reservation.totalCents });
        throw new HttpError(503, 'payment_unavailable', 'Pagamento indisponível, tente novamente', { orderId: order.id });
      }

      if (payment.status !== 'APPROVED') {
        await compensate(order.id);
        order = await finish(order, {
          status: 'PAYMENT_DECLINED',
          failureReason: payment.reason,
          totalCents: reservation.totalCents,
          paymentId: payment.id,
        });
        return { order };
      }

      // A confirmação é idempotente, e o cliente HTTP já tenta de novo em falha transitória.
      await inventory.confirm(order.id);
      order = await finish(order, {
        status: 'CONFIRMED',
        totalCents: reservation.totalCents,
        paymentId: payment.id,
        lines: reservation.lines,
      });
      return { order };
    } finally {
      endTimer();
    }
  }

  return { placeOrder };
}

module.exports = { createOrderService };
