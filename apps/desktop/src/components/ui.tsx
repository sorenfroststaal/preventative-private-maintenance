import { useEffect, useRef, useState, type ReactNode } from "react";

/** Tabs; uncontrolled by default, or controlled with `active`/`onChange` (e.g. from the URL). */
export function Tabs({
  tabs,
  initial,
  active: controlled,
  onChange,
}: {
  tabs: { id: string; label: string; content: () => ReactNode }[];
  initial?: string;
  active?: string;
  onChange?(id: string): void;
}) {
  const [own, setOwn] = useState(initial ?? tabs[0]?.id);
  const active = controlled ?? own;
  const setActive = (id: string) => {
    setOwn(id);
    onChange?.(id);
  };
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current?.id}
            className={t.id === current?.id ? "tab active" : "tab"}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current?.content()}</div>
    </div>
  );
}

/** Accessible modal dialog: focus trap entry, Escape closes. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="header-row">
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="Luk">
            Luk
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}

/** Clickable, keyboard-accessible table row. */
export function rowProps(selected: boolean, onSelect: () => void) {
  return {
    className: selected ? "selected" : "",
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
  };
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder?: string }) {
  return (
    <input
      type="search"
      className="searchbox"
      aria-label={placeholder ?? "Søg"}
      placeholder={placeholder ?? "Søg…"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export const includesText = (row: Record<string, unknown>, keys: string[], q: string) =>
  !q || keys.some((k) => String(row[k] ?? "").toLowerCase().includes(q.toLowerCase()));
