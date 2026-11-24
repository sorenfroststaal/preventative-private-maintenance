/** pdf.js text extraction for Node (MCP, tests, seed). */
export async function nodePdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const parts: string[] = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
  } finally {
    await doc.destroy();
  }
  return parts.join("\n");
}
