import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The iPhone web app, served by `ppm-mcp serve` from the Tauri resources (resources/mobile).
export default defineConfig({
  root: resolve(__dirname, "mobile"),
  base: "/",
  plugins: [react()],
  build: { outDir: resolve(__dirname, "src-tauri/resources/mobile"), emptyOutDir: true, target: "safari16", sourcemap: false },
});
