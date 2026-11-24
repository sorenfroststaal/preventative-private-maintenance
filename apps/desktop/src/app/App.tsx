import { useCallback, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import {
  ArchiveError,
  createArchive,
  listUsers,
  openArchive,
  removeStaleLock,
  restoreBackup,
  RestoreError,
  type Archive,
  type Env,
  type PublicUser,
} from "@ppm/core";
import { createTauriEnv, loadAppInfo, readConfig, writeConfig, type AppInfo, type AppConfig } from "../platform/tauri";
import { buildCtx, errorText, SessionContext, type Session } from "./session";
import { Welcome } from "../screens/Welcome";
import { FirstUser } from "../screens/FirstUser";
import { Login } from "../screens/Login";
import { Shell } from "../layout/Shell";

type State =
  | { step: "loading" }
  | { step: "fatal"; message: string }
  | { step: "welcome"; error?: string }
  | { step: "stale_lock"; path: string; message: string }
  | { step: "locked"; path: string; message: string }
  | { step: "first_user"; archive: Archive }
  | { step: "login"; archive: Archive; users: PublicUser[] }
  | { step: "ready"; archive: Archive; user: PublicUser };

export function App() {
  const [env, setEnv] = useState<Env | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [config, setConfig] = useState<AppConfig>({});
  const [state, setState] = useState<State>({ step: "loading" });
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), []);

  const afterOpen = useCallback(async (archive: Archive) => {
    const users = await listUsers(archive.db);
    if (users.length === 0) setState({ step: "first_user", archive });
    else setState({ step: "login", archive, users });
  }, []);

  const open = useCallback(
    async (e: Env, i: AppInfo, cfg: AppConfig, path: string, create: boolean) => {
      try {
        const archive = create
          ? await createArchive(e, path, { appVersion: i.appVersion })
          : await openArchive(e, path, { appVersion: i.appVersion });
        const next = { ...cfg, archivePath: path };
        await writeConfig(next);
        setConfig(next);
        queryClient.clear();
        await afterOpen(archive);
      } catch (err) {
        if (err instanceof ArchiveError && err.code === "stale_lock") {
          setState({ step: "stale_lock", path, message: err.message });
        } else if (err instanceof ArchiveError && err.code === "locked") {
          setState({ step: "locked", path, message: err.message });
        } else {
          setState({ step: "welcome", error: errorText(err) });
        }
      }
    },
    [afterOpen, queryClient],
  );

  useEffect(() => {
    (async () => {
      try {
        const i = await loadAppInfo();
        const e = createTauriEnv(i);
        const cfg = await readConfig();
        setInfo(i);
        setEnv(e);
        setConfig(cfg);
        if (cfg.archivePath && (await e.fs.exists(cfg.archivePath).catch(() => false))) {
          await open(e, i, cfg, cfg.archivePath, false);
        } else {
          setState({ step: "welcome" });
        }
      } catch (err) {
        setState({ step: "fatal", message: errorText(err) });
      }
    })();
  }, [open]);

  const login = useCallback(
    async (archive: Archive, user: PublicUser) => {
      const next = { ...config, lastUserId: user.id };
      await writeConfig(next).catch(() => undefined);
      setConfig(next);
      setState({ step: "ready", archive, user });
    },
    [config],
  );

  if (state.step === "loading") return <div className="center muted">Indlæser…</div>;
  if (state.step === "fatal") {
    return (
      <div className="center">
        <div className="card narrow">
          <h1>Programmet kunne ikke starte</h1>
          <p className="error">{state.message}</p>
        </div>
      </div>
    );
  }
  if (!env || !info) return null;

  switch (state.step) {
    case "welcome":
      return (
        <Welcome
          env={env}
          info={info}
          error={state.error}
          onCreate={(p) => open(env, info, config, p, true)}
          onOpen={(p) => open(env, info, config, p, false)}
        />
      );
    case "stale_lock":
    case "locked":
      return (
        <div className="center">
          <div className="card narrow">
            <h1>Arkivet er låst</h1>
            <p>{state.message}</p>
            <p className="muted small">{state.path}</p>
            <div className="row">
              {state.step === "stale_lock" && (
                <button
                  className="primary"
                  onClick={async () => {
                    if (await removeStaleLock(env, state.path)) await open(env, info, config, state.path, false);
                    else setState({ step: "locked", path: state.path, message: "Låsen tilhører et program, der stadig kører." });
                  }}
                >
                  Fjern låsen og åbn
                </button>
              )}
              <button onClick={() => open(env, info, config, state.path, false)}>Prøv igen</button>
              <button onClick={() => setState({ step: "welcome" })}>Vælg et andet arkiv</button>
            </div>
          </div>
        </div>
      );
    case "first_user":
      return <FirstUser env={env} archive={state.archive} onDone={(u) => login(state.archive, u)} />;
    case "login":
      return (
        <Login
          archive={state.archive}
          users={state.users}
          lastUserId={config.lastUserId ?? null}
          onLogin={(u) => login(state.archive, u)}
          onSwitchArchive={async () => {
            await state.archive.close();
            setState({ step: "welcome" });
          }}
        />
      );
    case "ready": {
      const { archive, user } = state;
      const session: Session = {
        env,
        info,
        archive,
        user,
        ctx: () => buildCtx(env, archive, user),
        logout: () => void afterOpen(archive),
        closeArchive: async () => {
          await archive.close();
          queryClient.clear();
          setState({ step: "welcome" });
        },
        restoreFrom: async (zipPath) => {
          const root = archive.root;
          await archive.close();
          queryClient.clear();
          setState({ step: "loading" });
          try {
            const r = await restoreBackup(env, zipPath, root);
            window.alert(
              r.previousMovedTo
                ? `Backuppen er gendannet. Det tidligere arkiv ligger i ${r.previousMovedTo}.`
                : "Backuppen er gendannet.",
            );
          } catch (err) {
            const files = err instanceof RestoreError && err.failedFiles.length ? `\n${err.failedFiles.join("\n")}` : "";
            window.alert(`Gendannelsen blev afbrudt. Arkivet er uændret.\n${errorText(err)}${files}`);
          }
          await open(env, info, config, root, false);
        },
      };
      return (
        <SessionContext.Provider value={session}>
          <QueryClientProvider client={queryClient}>
            <HashRouter>
              <Shell />
            </HashRouter>
          </QueryClientProvider>
        </SessionContext.Provider>
      );
    }
  }
}
