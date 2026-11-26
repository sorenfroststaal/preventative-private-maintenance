import qrcode from "qrcode-generator";

/** QR code as SVG squares (no network, no innerHTML). The text is also shown for typing it in. */
export function QrCode({ text, size = 168, label }: { text: string; size?: number; label: string }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const cells: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n + quiet * 2} ${n + quiet * 2}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={cells.join("")} fill="#111" />
    </svg>
  );
}
