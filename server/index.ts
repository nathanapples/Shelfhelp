import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import { existsSync } from "node:fs";
import { config } from "./lib/config.js";
import { sessionSecret } from "./lib/settings.js";
import { routes } from "./routes.js";
import { reschedule } from "./lib/scheduler.js";
import { startRequestWatcher } from "./lib/requests.js";
import { linkLibrary } from "./lib/linking.js";
import { resolveOwner, splitOwnerKey } from "./lib/users.js";
import { syncAll } from "./lib/sync.js";
import { backfillHistory, syncReading } from "./lib/reading.js";

splitOwnerKey();

const app = Fastify({ logger: false, bodyLimit: 1_000_000, trustProxy: true });

await app.register(fastifyCookie, { secret: sessionSecret() });
await app.register(routes);

if (existsSync(config.webDir)) {
  await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
  // Single-page app: unknown non-API paths get index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

await app.listen({ port: config.port, host: config.host });
console.log(`Shelfhelp ${config.version} listening on http://${config.host}:${config.port} (config in ${config.configDir})`);

backfillHistory();
resolveOwner().catch(() => {});
reschedule();
startRequestWatcher();
// A first sync shortly after start, so lists catch up after a restart.
setTimeout(() => {
  syncAll("startup")
    .catch(() => {})
    .finally(() =>
      syncReading("startup")
        .catch(() => {})
        .finally(() => linkLibrary("startup")),
    );
}, 15_000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
