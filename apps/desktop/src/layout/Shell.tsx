import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { importDocument } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { Overview } from "../pages/Overview";
import { Tasks } from "../pages/Tasks";
import { Documents } from "../pages/Documents";
import { Settings } from "../pages/Settings";
import { Placeholder } from "../pages/Placeholder";

const NAV = [
  { to: "/", label: "Overblik", end: true },
  { to: "/opgaver", label: "Opgaver" },
  { to: "/bolig", label: "Bolig og inventar" },
  { to: "/arbejdsordrer", label: "Arbejdsordrer" },
  { to: "/bil", label: "Bil" },
  { to: "/okonomi", label: "Økonomi" },
  { to: "/forsikring", label: "Forsikring" },
  { to: "/helbred", label: "Helbred" },
  { to: "/dokumenter", label: "Dokumenter" },
  { to: "/ai", label: "AI-indbakke" },
  { to: "/indstillinger", label: "Indstillinger" },
] as const;

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

const ToastContext = createContext<(text: string, kind?: Toast["kind"]) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function Shell() {
  const session = useSession();
  const qc = useQueryClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);

  /** Imports files dropped anywhere in the window (spec 04 "træk og slip overalt"). */
  const importFiles = useCallback(
    async (paths: string[]) => {
      if (session.archive.readOnly) return toast("Arkivet er skrivebeskyttet.", "error");
      for (const p of paths) {
        try {
          const r = await importDocument(session.env, session.archive, session.ctx(), p, { source: "drop" });
          toast(r.duplicate ? `Findes allerede: ${r.document.title ?? r.document.filename}` : `Importeret: ${r.document.filename}`);
        } catch (e) {
          toast(`${session.env.fs.basename(p)}: ${errorText(e)}`, "error");
        }
      }
      await qc.invalidateQueries({ queryKey: ["documents"] });
    },
    [qc, session, toast],
  );

  useEffect(() => {
    const un = listen<string[]>("ppm://files-dropped", (e) => void importFiles(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, [importFiles]);

  return (
    <ToastContext.Provider value={toast}>
      <div className="shell">
        <nav className="sidebar" aria-label="Hovedmenu">
          <div className="brand">PPM</div>
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={"end" in n ? n.end : false}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="sidebar-footer">
            <div className="small">{session.user.name}</div>
            <button className="link" onClick={session.logout}>
              Skift bruger
            </button>
          </div>
        </nav>
        <main className="content">
          {session.archive.readOnly && (
            <div className="warning" role="alert">
              Arkivet er lavet med en nyere version af programmet og er åbnet skrivebeskyttet.
            </div>
          )}
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/opgaver" element={<Tasks />} />
            <Route path="/dokumenter" element={<Documents onImport={importFiles} />} />
            <Route path="/indstillinger" element={<Settings />} />
            <Route path="/bolig" element={<Placeholder title="Bolig og inventar" />} />
            <Route path="/arbejdsordrer" element={<Placeholder title="Arbejdsordrer" />} />
            <Route path="/bil" element={<Placeholder title="Bil" />} />
            <Route path="/okonomi" element={<Placeholder title="Økonomi" />} />
            <Route path="/forsikring" element={<Placeholder title="Forsikring" />} />
            <Route path="/helbred" element={<Placeholder title="Helbred" />} />
            <Route path="/ai" element={<Placeholder title="AI-indbakke" phase={3} />} />
          </Routes>
        </main>
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
