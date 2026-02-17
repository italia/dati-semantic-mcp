#
# Dockerfile for schema.gov.it MCP Server.
# TODO: not for production use.
#
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

# Expose the MCP server port.
EXPOSE 3000
USER node
ENTRYPOINT ["node", "dist/index.js"]
