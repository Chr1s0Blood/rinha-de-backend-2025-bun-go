FROM oven/bun:alpine AS base

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun build src/index.ts --outdir dist --target bun

EXPOSE 9999

CMD ["bun", "run", "start"]
