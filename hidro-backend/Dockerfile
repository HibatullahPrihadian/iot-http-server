# Stage 1: Build (butuh toolchain untuk kompilasi native better-sqlite3)
FROM node:20.18-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Runtime (tanpa toolchain)
FROM node:20.18-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/data /app/data/uploads
EXPOSE 5000
CMD ["node", "server.js"]
