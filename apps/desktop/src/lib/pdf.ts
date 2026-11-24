import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Text layer of a PDF, used by core during import (spec 05 step 3). */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return parts.join("\n");
  } finally {
    await doc.destroy();
  }
}

/** Renders the first pages of a PDF as canvases into a container. */
export async function renderPdf(bytes: Uint8Array, container: HTMLElement, maxPages = 5): Promise<number> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  container.replaceChildren();
  const n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.3 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.className = "pdf-page";
    container.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  }
  const total = doc.numPages;
  await doc.destroy();
  return total;
}
