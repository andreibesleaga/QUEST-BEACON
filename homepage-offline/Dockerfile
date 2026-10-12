# BEACON — always-on front service. No build step, no dependencies: copy and run.
# Same pinned base image as the deployment (infra/Dockerfile).
FROM node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc
WORKDIR /app
COPY package.json server.mjs index.html ./
COPY offline-assets ./offline-assets
ENV NODE_ENV=production
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1
CMD ["node", "server.mjs"]
