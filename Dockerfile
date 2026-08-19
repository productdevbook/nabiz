# One image, one process. The build stage carries the toolchain; what runs
# is the built site bundled into a single file, the runner beside it, and
# the schema — no node_modules, nothing to install at boot.
FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:server \
 && mkdir -p bundle/server \
 && bun build dist/server/entry.mjs --target=bun --outfile bundle/server/entry.mjs

FROM oven/bun:1.3.14-alpine
WORKDIR /app

COPY --from=build /app/bundle/server/entry.mjs ./dist/server/entry.mjs
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/schema.sql ./schema.sql

# A named volume takes the ownership this directory has when it is first
# mounted, so the database is writable by the user that will open it.
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data

ENV NABIZ_DB=/data/nabiz.db \
    PORT=8080 \
    HOST=0.0.0.0
EXPOSE 8080
USER bun

# The one endpoint with no database behind it: alive is alive.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["bun", "src/server/index.ts"]
