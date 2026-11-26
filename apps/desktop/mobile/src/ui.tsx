import { type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

export const MONTHS = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
export const fmtDate = (iso: string | null | undefined) => (iso ? `${+iso.slice(8, 10)}. ${MONTHS[+iso.slice(5, 7) - 1]}${iso.slice(0, 4) !== new Date().toISOString().slice(0, 4) ? ` ${iso.slice(0, 4)}` : ""}` : "");
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "1.234,50" → 123450 øre; "" → null; undefined when it cannot be read. */
export function parseKr(text: string): number | null | undefined {
  const t = text.trim().replace(/\s|kr\.?/gi, "");
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}
export const formatKr = (minor: number | null | undefined) =>
  minor == null ? "" : (minor / 100).toLocaleString("da-DK", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const kr = (minor: number | null | undefined) => (minor == null ? "" : `${formatKr(minor)} kr.`);

export function Header({ title, children, onBack, backLabel = "Tilbage" }: { title: string; children?: ReactNode; onBack?(): void; backLabel?: string }) {
  return (
    <header className={`header${onBack ? " detail" : ""}`}>
      {onBack && (
        <div className="header-row">
          <button className="back" onClick={onBack} aria-label={backLabel}>
            <ChevronLeft size={26} aria-hidden="true" /> {backLabel}
          </button>
          {children}
        </div>
      )}
      <div className="header-row">
        <h1>{title}</h1>
        {!onBack && children}
      </div>
    </header>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
