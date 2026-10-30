import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  for (const p of ["../../package.json", "../../../package.json"]) {
    try {
      return JSON.parse(readFileSync(path.resolve(here, p), "utf8")).version ?? "0.0.0";
    } catch {
      /* try next */
    }
  }
  return "0.0.0";
}

export const config = {
  port: Number(process.env.PORT ?? 5075),
  host: process.env.HOST ?? "0.0.0.0",
  configDir: process.env.CONFIG_DIR ?? "/config",
  /** Optional login for the web UI. */
  appPassword: process.env.APP_PASSWORD ?? "",
  /** "Can't sign in?" on the sign-in page writes a one-time admin link to the container log. Off unless LOG_RECOVERY_LINK=true. */
  logRecoveryLink: /^(1|true|yes|on)$/i.test(process.env.LOG_RECOVERY_LINK ?? ""),
  /** Built frontend, served as static files. */
  webDir: process.env.WEB_DIR ?? path.resolve(here, "../../web"),
  version: readVersion(),
};
