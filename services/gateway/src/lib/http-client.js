// ARQUIVO GERADO: não edite aqui. Fonte em /shared (npm run sync-shared).
'use strict';
// Cliente HTTP entre serviços: timeout, retry com backoff exponencial e
// erros padronizados. Os spans do OpenTelemetry e o header `traceparent`
// são propagados automaticamente pela instrumentação do fetch (undici).
// Fonte única em /shared: rode `npm run sync-shared` depois de editar.

const { HttpError } = require('./observability');

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Faz a chamada e devolve { status, body } para qualquer resposta HTTP.
 * Lança HttpError 503/504 só se o serviço não responder.
 * Só use retries > 0 em operações idempotentes.
 */
async function request(url, { method = 'GET', body, timeoutMs = 3000, retries = 0, target = 'upstream' } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        await sleep(100 * 2 ** attempt);
        continue;
      }
      return { status: response.status, body: await parseBody(response) };
    } catch (err) {
      if (attempt < retries) {
        await sleep(100 * 2 ** attempt);
        continue;
      }
      const timedOut = err.name === 'TimeoutError';
      throw new HttpError(
        timedOut ? 504 : 503,
        timedOut ? 'upstream_timeout' : 'upstream_unavailable',
        `Serviço ${target} ${timedOut ? 'não respondeu a tempo' : 'indisponível'}`,
      );
    }
  }
}

/** Igual a request(), mas lança HttpError quando a resposta não é 2xx. */
async function requestOk(url, options = {}) {
  const { status, body } = await request(url, options);
  if (status < 200 || status >= 300) {
    throw new HttpError(
      status,
      body?.error || 'upstream_error',
      body?.message || `Erro em ${options.target || 'upstream'}`,
      body?.details,
    );
  }
  return body;
}

module.exports = { request, requestOk };
