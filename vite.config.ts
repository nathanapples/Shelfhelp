import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import tailwindConfig from "./tailwind.config.js";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  root: "web",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  css: { postcss: { plugins: [tailwindcss(tailwindConfig), autoprefixer()] } },
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://localhost:5075" } },
});
