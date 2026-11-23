# syntax=docker/dockerfile:1.7
# Build multi-stage:
#   deps    -> instala só dependências de produção (npm ci, lockfile)
#   test    -> roda os testes dentro da imagem (docker build --target test .)
#   runtime -> imagem final: sem npm, sem código de teste, usuário não-root
#
# Em produção, fixe a imagem base por digest (node:24-alpine@sha256:...) para
# builds reprodutíveis. O Renovate/Dependabot atualiza o digest.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY test ./test
RUN npm test

FROM node:24-alpine AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="pedidos-veloz-gateway" \
      org.opencontainers.image.description="Pedidos Veloz - API Gateway" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="MIT"

# Remove gerenciadores de pacote da imagem final: menos superfície de ataque.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    PORT=8080 \
    SERVICE_VERSION=${VERSION}

WORKDIR /app
# Arquivos pertencem ao root e são só leitura para o processo (uid 1000).
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# UID numérico: o Kubernetes consegue verificar `runAsNonRoot: true`.
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.js"]
