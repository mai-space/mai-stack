FROM node:26-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install --omit=dev

FROM base AS build
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npx tsc --project tsconfig.json

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
