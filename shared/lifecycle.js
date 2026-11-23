'use strict';
// Inicialização e desligamento gracioso (12-Factor IX: disposability).
// Ao receber SIGTERM (rolling update, scale down):
//   1. readiness passa a responder 503, e o pod sai dos Endpoints do Service;
//   2. espera SHUTDOWN_DELAY_MS para o kube-proxy/ingress pararem de mandar tráfego;
//   3. para de aceitar conexões, termina as requisições em andamento e fecha recursos.
// Fonte única em /shared: rode `npm run sync-shared` depois de editar.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer(app, { obs, port = Number(process.env.PORT) || 8080, onShutdown = async () => {} }) {
  const { logger, state } = obs;
  const shutdownDelayMs = Number(process.env.SHUTDOWN_DELAY_MS || 0);
  const forceExitMs = Number(process.env.SHUTDOWN_TIMEOUT_MS || 20000);

  const server = app.listen(port, () => logger.info({ port }, 'server_started'));
  // Maior que o idle timeout típico de load balancers (60s), evita 502 esporádico.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info({ signal, shutdownDelayMs }, 'shutdown_started');
    state.shuttingDown = true;
    setTimeout(() => {
      logger.error('shutdown_forced');
      process.exit(1);
    }, forceExitMs).unref();

    await sleep(shutdownDelayMs);
    server.close(async () => {
      try {
        await onShutdown();
      } catch (err) {
        logger.error({ err }, 'shutdown_cleanup_failed');
      }
      logger.info('shutdown_complete');
      process.exit(0);
    });
    server.closeIdleConnections();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

module.exports = { startServer };
