import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import tailwindConfig from "./tailwind.config.js";

export default defineConfig({
  root: "web",
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss(tailwindConfig), autoprefixer()] } },
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://localhost:5075" } },
});
