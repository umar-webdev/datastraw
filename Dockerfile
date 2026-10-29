FROM oven/bun:1.1.21
WORKDIR /app

# Install dependencies first so this layer is cached between code changes.
COPY package.json bun.lockb ./
COPY client/package.json client/
COPY server/package.json server/
RUN bun install --frozen-lockfile

# Build the React app into client/dist; the server serves it from the same origin.
COPY . .
RUN bun run build

ENV NODE_ENV=production
# Render sets PORT; 3000 is the fallback.
EXPOSE 3000
USER bun
# Run the server directly (not through `bun run`) so its JSON logs are unprefixed and SIGTERM reaches it.
CMD ["bun", "server/src/index.ts"]
