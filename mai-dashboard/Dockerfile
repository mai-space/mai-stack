FROM node:26-alpine AS base
WORKDIR /app
RUN apk add --no-cache curl

FROM base AS deps
COPY package.json ./
RUN npm install

FROM deps AS frontend-builder
COPY src/ src/
COPY index.html vite.config.ts tsconfig.frontend.json ./
RUN npm run build:frontend

FROM deps AS server-builder
COPY server/ server/
COPY tsconfig.json ./
RUN npm run build:server

FROM node:26-alpine AS runtime
RUN apk add --no-cache curl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=frontend-builder /app/dist ./dist
COPY --from=server-builder /app/dist-server ./dist-server
EXPOSE 3461
CMD ["node", "dist-server/index.js"]
