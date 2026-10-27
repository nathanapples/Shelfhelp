# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    CONFIG_DIR=/config \
    PORT=5075 \
    WEB_DIR=/app/dist/web
RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
VOLUME /config
EXPOSE 5075
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5075)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/server/index.js"]
