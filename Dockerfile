FROM oven/bun:1.4.2-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
USER bun

# Bun runs TypeScript directly; SIGTERM is handled by Nest shutdown hooks (graceful drain).
CMD ["bun", "src/main.ts"]
