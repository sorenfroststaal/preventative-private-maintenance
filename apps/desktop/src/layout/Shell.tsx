import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSetting, importDocument, pendingDraftGroupCount, scanInbox, type InboxState } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { Overview } from "../pages/Overview";
import { Tasks } from "../pages/Tasks";
import { Documents } from "../pages/Documents";
import { Settings } from "../pages/Settings";
import { AiInbox } from "../pages/AiInbox";
import { Home } from "../pages/Home";
import { WorkOrders } from "../pages/WorkOrders";
import { Vehicles } from "../pages/Vehicles";
import { Finance } from "../pages/Finance";
import { Insurance } from "../pages/Insurance";
import { Health } from "../pages/Health";
import { SearchDialog } from "../components/SearchDialog";
import { Food } from "../pages/Food";
import { MODULES } from "../lib/modules";
import { ModuleIcon } from "../components/visual";
import { Search } from "lucide-react";

const NAV = MODULES;

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

const ToastContext = createContext<(text: string, kind?: Toast["kind"]) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

const InboxContext = createContext<{ unsupported: string[] }>({ unsupported: [] });
export const useInbox = () => useContext(InboxContext);

export const INBOX_POLL_MS = 2000;

export function Shell() {
  const session = useSession();
  const qc = useQueryClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [searching, setSearching] = useState(false);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const nextId = useRef(1);
  const inboxState = useRef<InboxState>(new Map());

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4500);
  }, []);

  /** Imports files dropped anywhere in the window (spec 04 "træk og slip overalt"). */
  const importFiles = useCallback(
    async (paths: string[]) => {
      if (session.archive.readOnly) return toast("Arkivet er skrivebeskyttet.", "error");
      for (const p of paths) {
        try {
          const r = await importDocument(session.env, session.archive, session.ctx(), p, { source: "drop" });
          toast(r.duplicate ? `Findes allerede: ${r.document.title ?? r.document.filename}` : `Importeret: ${r.document.filename} – find den i importkøen under Dokumenter`);
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

  // Watched inbox (spec 05): scan at start and every 2 s while the app runs.
  const inboxEnabled = useQuery({
    queryKey: ["setting", "import.inbox_enabled"],
    queryFn: async () => (await getSetting<boolean>(session.archive.db, "import.inbox_enabled")) ?? true,
  });
  useEffect(() => {
    if (!inboxEnabled.data || session.archive.readOnly) return;
    let running = false;
    let stopped = false;
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const r = await scanInbox(session.env, session.archive, session.ctx(), inboxState.current);
        setUnsupported((prev) => (prev.join("|") === r.unsupported.join("|") ? prev : r.unsupported));
        for (const i of r.imported) toast(i.duplicate ? `Indbakke: ${i.name} fandtes allerede` : `Indbakke: ${i.name} er importeret`);
        for (const f of r.failed) toast(`Indbakke: ${f.name}: ${f.error}`, "error");
        if (r.imported.length) await qc.invalidateQueries({ queryKey: ["documents"] });
      } catch {
        // The folder may be temporarily unavailable; try again next tick.
      } finally {
        running = false;
      }
    };
    void tick();
    const id = setInterval(tick, INBOX_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [inboxEnabled.data, qc, session, toast]);

  // Ctrl+K / Cmd+K opens global search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const aiPending = useQuery({
    queryKey: ["ai_draft", "pending-count"],
    queryFn: () => pendingDraftGroupCount(session.archive.db),
    refetchInterval: 5000,
  });

  return (
    <ToastContext.Provider value={toast}>
      <InboxContext.Provider value={{ unsupported }}>
        <div className="shell">
          <nav className="sidebar" aria-label="Hovedmenu">
            <div className="brand">PPM</div>
            <button className="search-button" onClick={() => setSearching(true)}>
              <span className="with-icon">
                <Search size={16} aria-hidden="true" /> Søg…
              </span>
              <kbd>Ctrl+K</kbd>
            </button>
            <ul>
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to} end={n.to === "/"}>
                    <ModuleIcon id={n.id} />
                    {n.label}
                    {n.id === "ai" && aiPending.data ? (
                      <span className="badge" aria-label={`${aiPending.data} forslag venter`}>
                        {aiPending.data}
                      </span>
                    ) : null}
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
              <Route path="/bolig" element={<Home />} />
              <Route path="/arbejdsordrer" element={<WorkOrders />} />
              <Route path="/bil" element={<Vehicles />} />
              <Route path="/okonomi" element={<Finance />} />
              <Route path="/madplan" element={<Food />} />
              <Route path="/forsikring" element={<Insurance />} />
              <Route path="/helbred" element={<Health />} />
              <Route path="/dokumenter" element={<Documents onImport={importFiles} />} />
              <Route path="/indstillinger" element={<Settings />} />
              <Route path="/ai" element={<AiInbox />} />
            </Routes>
          </main>
          <div className="toasts" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`toast ${t.kind}`}>
                {t.text}
              </div>
            ))}
          </div>
          {searching && <SearchDialog onClose={() => setSearching(false)} />}
        </div>
      </InboxContext.Provider>
    </ToastContext.Provider>
  );
}
