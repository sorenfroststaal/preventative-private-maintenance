import { createWorker, OEM, type Worker } from "tesseract.js";

/**
 * Local OCR (phase 4.3). The worker, the LSTM-only cores and the Danish language data are bundled
 * under /ocr by vite.config.ts; nothing is fetched from the network and nothing is cached in IndexedDB.
 */
let worker: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  worker ??= createWorker("dan", OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    gzip: true,
    cacheMethod: "none",
    workerBlobURL: false,
  }).catch((e: unknown) => {
    worker = null;
    throw e;
  });
  return worker;
}

export async function ocrText(bytes: Uint8Array, mime: string): Promise<string> {
  const w = await getWorker();
  const r = await w.recognize(new Blob([bytes.slice()], { type: mime }));
  return r.data.text;
}
