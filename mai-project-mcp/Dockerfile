FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ curl

FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

FROM base AS build
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npx tsc --project tsconfig.json

FROM node:20-alpine AS runtime
RUN apk add --no-cache curl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3456
CMD ["node", "dist/index.js"]
