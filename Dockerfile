#
# Dockerfile for schema.gov.it MCP Server — multi-stage build.
#
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
RUN mkdir -p logs && chown node:node logs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1
USER node
ENTRYPOINT ["node", "dist/index.js"]
