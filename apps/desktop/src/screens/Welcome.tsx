import { useState } from "react";
import { detectCloudFolder, isTempFolder, type Env } from "@ppm/core";
import { pickDirectory, type AppInfo } from "../platform/tauri";
import { errorText } from "../app/session";

interface Props {
  env: Env;
  info: AppInfo;
  error?: string;
  onCreate(path: string): Promise<void>;
  onOpen(path: string): Promise<void>;
}

export function Welcome({ env, info, error, onCreate, onOpen }: Props) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ path: string; cloud: string } | null>(null);

  async function create() {
    setLocalError(null);
    const picked = await pickDirectory("Vælg en mappe til det nye arkiv");
    if (!picked) return;
    // A non-empty folder gets a dedicated sub-folder instead of being refused.
    let target = picked;
    if ((await env.fs.listDir(picked)).length > 0) target = env.fs.join(picked, "PPM-arkiv");
    const cloud = detectCloudFolder(target, info.oneDriveEnv) ?? (isTempFolder(target) ? "en midlertidig mappe (tmp/temp), som kan blive tømt" : null);
    if (cloud) setPending({ path: target, cloud });
    else await run(() => onCreate(target));
  }

  async function openExisting() {
    setLocalError(null);
    const picked = await pickDirectory("Vælg mappen med dit arkiv");
    if (picked) await run(() => onOpen(picked));
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setLocalError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card narrow">
        <h1>Velkommen</h1>
        <p>
          Programmet samler hjemmets dokumentation, vedligehold og frister i et <strong>lokalt arkiv</strong> på
          din computer. Der er ingen konto og ingen sky.
        </p>
        {(error || localError) && <p className="error" role="alert">{localError ?? error}</p>}

        {pending ? (
          <div className="warning" role="alert">
            <p>
              Mappen ser ud til at ligge i <strong>{pending.cloud}</strong>. Så bliver arkivet – også eventuelle
              helbredsoplysninger – synkroniseret til skyen.
            </p>
            <p className="small muted">{pending.path}</p>
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => run(() => onCreate(pending.path))}>
                Opret alligevel
              </button>
              <button onClick={() => setPending(null)}>Vælg en anden mappe</button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <button className="primary big" disabled={busy} onClick={create}>
              Opret nyt arkiv
            </button>
            <button className="big" disabled={busy} onClick={openExisting}>
              Åbn eksisterende arkiv
            </button>
          </div>
        )}
        <p className="small muted">
          Arkivet krypteres ikke i denne version. Brug diskkryptering (BitLocker) for at beskytte dine data.
        </p>
      </div>
    </div>
  );
}
