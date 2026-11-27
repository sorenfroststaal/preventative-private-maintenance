import { closeExpiredDeadlines } from "@ppm/core";
import { onReportedError } from "../app/queryClient";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useMobileAutostart } from "../components/MobilePanel";
import { mobileStatus } from "../platform/tauri";
import { NavLink, Route, Routes } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSetting, importDocument, ocrPendingDocuments, pendingDraftGroupCount, scanInbox, type InboxState } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { Overview } from "../pages/Overview";
import { Tasks } from "../pages/Tasks";
import { Calendar } from "../pages/Calendar";
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
import { Lists } from "../pages/Lists";
import { MODULES } from "../lib/modules";
import { ModuleIcon } from "../components/visual";
import { Search, Smartphone } from "lucide-react";

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
const OCR_POLL_MS = 4000;

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
  // Failed loads and unhandled failed saves from anywhere in the app (review D1).
  useEffect(() => onReportedError((text) => toast(text, "error")), [toast]);
  // While any load has failed, a banner stays on the page so an empty list is not taken for "nothing there".
  const [failedLoads, setFailedLoads] = useState(0);
  useEffect(() => {
    const cache = qc.getQueryCache();
    const count = () => setFailedLoads(cache.getAll().filter((q) => q.state.status === "error" && q.getObserversCount() > 0).length);
    count();
    return cache.subscribe(count);
  }, [qc]);

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

  // Local OCR (phase 4.3): images without text are read in the background, one at a time, so
  // import never waits for it.
  useEffect(() => {
    if (!session.env.ocr || session.archive.readOnly) return;
    let running = false;
    let stopped = false;
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const n = await ocrPendingDocuments(session.env, session.archive, session.ctx(), { limit: 1 });
        if (n > 0) await qc.invalidateQueries({ queryKey: ["documents"] });
      } catch {
        // Try again on the next tick.
      } finally {
        running = false;
      }
    };
    const id = setInterval(tick, OCR_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [qc, session]);

  useMobileAutostart();
  // Expired complaint-period and warranty tasks end by themselves (on open and every hour).
  useEffect(() => {
    if (session.archive.readOnly) return;
    const run = () =>
      closeExpiredDeadlines(session.ctx())
        .then((n) => (n ? qc.invalidateQueries() : undefined))
        .catch(() => undefined);
    void run();
    const t = setInterval(run, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [session, qc]);
  const mobileOn = useQuery({ queryKey: ["mobile", "status"], queryFn: mobileStatus, refetchInterval: 30_000 });

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
              {mobileOn.data && Array.isArray(mobileOn.data.addresses) && (
                <NavLink to="/indstillinger#mobil" className="mobile-on small" title="Mobiladgang kører: telefoner på samme netværk kan forbinde med kode eller nøgle">
                  <Smartphone size={14} aria-hidden="true" /> Mobiladgang er slået til
                </NavLink>
              )}
              <div className="small">{session.user.name}</div>
              <button className="link" onClick={session.logout}>
                Skift bruger
              </button>
            </div>
          </nav>
          <main className="content">
            {failedLoads > 0 && (
              <div className="warning load-error" role="alert">
                Noget kunne ikke hentes, så det, du ser, kan være ufuldstændigt.{" "}
                <button className="link" onClick={() => qc.refetchQueries({ predicate: (q) => q.state.status === "error" })}>
                  Prøv igen
                </button>
              </div>
            )}
            {session.archive.readOnly && (
              <div className="warning" role="alert">
                Arkivet er lavet med en nyere version af programmet og er åbnet skrivebeskyttet.
              </div>
            )}
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/opgaver" element={<Tasks />} />
              <Route path="/kalender" element={<Calendar />} />
              <Route path="/bolig" element={<Home />} />
              <Route path="/arbejdsordrer" element={<WorkOrders />} />
              <Route path="/bil" element={<Vehicles />} />
              <Route path="/okonomi" element={<Finance />} />
              <Route path="/madplan" element={<Food />} />
              <Route path="/forsikring" element={<Insurance />} />
              <Route path="/helbred" element={<Health />} />
              <Route path="/dokumenter" element={<Documents onImport={importFiles} />} />
              <Route path="/lister" element={<Lists />} />
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
