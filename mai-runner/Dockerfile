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
# git/bash: worktree + gate command execution. docker-cli: only needed if ddev runs inside
# this container — see M-6.md RISK 1. Do NOT mount /var/run/docker.sock into this image
# unproxied; front it with a socket proxy (e.g. tecnativa/docker-socket-proxy) or run
# mai-runner directly on the host instead of in this container.
RUN apk add --no-cache curl git openssh-client bash docker-cli
# ddev itself is not packaged for alpine; operators enabling runtime.type: ddev must either
# extend this image with ddev's official install script (https://ddev.com/get-started/) or
# bind-mount a host-installed ddev binary into the container.
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3463
CMD ["node", "dist/index.js"]
