FROM oven/bun:1.1.21 AS base
WORKDIR /app

# Install dependencies first so this layer is cached between code changes.
COPY package.json bun.lock* bun.lockb* ./
COPY client/package.json client/
COPY server/package.json server/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "start"]
