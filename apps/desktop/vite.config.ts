import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Local OCR (phase 4.3): copies the tesseract.js worker, the LSTM-only cores and the Danish
 * language data into public/ocr, so the app never fetches them from the network.
 */
function ocrAssets(): Plugin {
  const copy = () => {
    const out = join(__dirname, "public", "ocr");
    mkdirSync(out, { recursive: true });
    const tjs = dirname(require.resolve("tesseract.js/package.json"));
    const core = dirname(createRequire(join(tjs, "package.json")).resolve("tesseract.js-core/package.json"));
    const dan = dirname(require.resolve("@tesseract.js-data/dan/package.json"));
    const files: [string, string][] = [
      [join(tjs, "dist", "worker.min.js"), "worker.min.js"],
      ...["", "simd-", "relaxedsimd-"].map((v): [string, string] => [join(core, `tesseract-core-${v}lstm.wasm.js`), `tesseract-core-${v}lstm.wasm.js`]),
      [join(dan, "4.0.0_best_int", "dan.traineddata.gz"), "dan.traineddata.gz"],
    ];
    for (const [src, name] of files) {
      const dest = join(out, name);
      if (!existsSync(dest) || statSync(dest).size !== statSync(src).size) copyFileSync(src, dest);
    }
  };
  return { name: "ppm-ocr-assets", buildStart: copy, configureServer: copy };
}

// Tauri expects a fixed dev port and no browser auto-open.
export default defineConfig({
  plugins: [react(), ocrAssets()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", sourcemap: false },
});
