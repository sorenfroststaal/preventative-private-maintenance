import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { createPairingCode, getSetting, listMobileDevices, mayAutostartMobile, networkKeys, revokeMobileDevice, setSetting } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { mobileAddresses, mobileStart, mobileStatus, mobileStop } from "../platform/tauri";
import { QrCode } from "./QrCode";
import { formatDateTime } from "../lib/format";

/** Indstillinger → Mobil (iPhone): local network access for the iPhone web app. */
export function MobilePanel() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ["mobile", "status"], queryFn: mobileStatus, refetchInterval: 10_000 });
  const skipped = useQuery<{ networks: string[] } | null>({ queryKey: ["mobile", "skipped"], queryFn: () => null, staleTime: Infinity, enabled: false });
  const devices = useQuery({ queryKey: ["mobile", "devices"], queryFn: () => listMobileDevices(session.archive.db), refetchInterval: 10_000 });
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!pairing) return;
    const remaining = () => Math.max(0, Math.round((Date.parse(pairing.expiresAt) - Date.parse(session.env.clock.nowIso())) / 1000));
    const t = setInterval(() => setLeft(remaining()), 1000);
    setLeft(remaining());
    return () => clearInterval(t);
  }, [pairing, session.env.clock]);
  const start = useMutation({
    mutationFn: async () => {
      const s = await mobileStart();
      await setSetting(session.ctx(), "mobile.enabled", true);
      // Remember this network: mobile access only starts by itself here (review E2).
      const nets = networkKeys(s.addresses ?? []);
      if (nets.length) {
        const known = (await getSetting<string[]>(session.archive.db, "mobile.networks")) ?? [];
        await setSetting(session.ctx(), "mobile.networks", [...new Set([...known, ...nets])]);
      }
      return s;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mobile"] }),
    onError: (e) => toast(errorText(e), "error"),
  });
  const stop = useMutation({
    mutationFn: async () => {
      await mobileStop();
      await setSetting(session.ctx(), "mobile.enabled", false);
    },
    onSuccess: () => {
      setPairing(null);
      return qc.invalidateQueries({ queryKey: ["mobile"] });
    },
  });
  const pair = useMutation({ mutationFn: () => createPairingCode(session.ctx()), onSuccess: setPairing, onError: (e) => toast(errorText(e), "error") });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeMobileDevice(session.ctx(), id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mobile", "devices"] }),
  });
  const s = status.data && Array.isArray(status.data.addresses) ? status.data : null;
  const ip = s?.addresses[0];
  const ro = session.archive.readOnly;
  return (
    <div className="panel" id="mobil">
      <h2>
        <Smartphone size={18} aria-hidden="true" /> Mobil (iPhone)
      </h2>
      <p className="small muted">
        Brug PPM på iPhone, når telefonen er på samme wifi som denne computer. Telefonen taler direkte med computeren; intet sendes til internettet eller en sky. Helbredsdata vises ikke på telefonen.
      </p>
      {!s && skipped.data && (
        <p className="warning" role="status">
          Mobiladgang blev ikke startet automatisk, fordi computeren er på et andet netværk end der, hvor du slog den til. Slå den til her, hvis du stoler på netværket.
        </p>
      )}
      {!s ? (
        <button className="primary" onClick={() => start.mutate()} disabled={ro || start.isPending}>
          {start.isPending ? "Starter …" : "Slå mobiladgang til"}
        </button>
      ) : (
        <>
          <p>
            Mobiladgang er slået til på{" "}
            {s.addresses.length ? (
              s.addresses.map((a) => (
                <code key={a} className="pill-code">
                  https://{a}:{s.httpsPort}
                </code>
              ))
            ) : (
              <b>(ingen netværksadresse fundet – er computeren på wifi?)</b>
            )}{" "}
            <button className="link" onClick={() => stop.mutate()} disabled={stop.isPending}>
              Slå fra
            </button>
          </p>
          {s.caRenewed && (
            <p className="warning" role="alert">
              Computerens certifikat er fornyet (det er nu begrænset til det lokale netværk). Installér det igen på telefonen med trin 1 nedenfor, og fjern det gamle under <b>Generelt → VPN og enhedsadministration</b>. Telefonen behøver ikke at blive parret igen.
            </p>
          )}
          <p className="small muted">
            Første gang spørger Windows måske, om <b>ppm-mcp</b> må modtage forbindelser. Vælg <b>Private netværk</b> (ikke offentlige), så telefonen kan nå computeren.
          </p>
          {ip && (
            <div className="mobile-steps">
              <div className="mobile-step">
                <h3>1. Installér certifikatet (én gang)</h3>
                <QrCode text={`http://${ip}:${s.httpPort}/`} label={`QR-kode til vejledning og certifikat: http://${ip}:${s.httpPort}/`} />
                <ol className="small">
                  <li>Scan koden med iPhones kamera, og åbn linket i Safari.</li>
                  <li>
                    Tryk <b>Hent certifikatet</b> → <b>Tillad</b>. Åbn <b>Indstillinger → Profil hentet → Installer</b> (eller <b>Generelt → VPN og enhedsadministration</b>).
                  </li>
                  <li>
                    <b>Indstillinger → Generelt → Om → Indst. til certifikatgodkendelse</b>: slå <b>PPM lokal CA</b> til.
                  </li>
                </ol>
                <p className="small muted">
                  Fingeraftryk: <code className="fp">{s.caFingerprint}</code>
                </p>
              </div>
              <div className="mobile-step">
                <h3>2. Læg PPM på hjemmeskærmen</h3>
                <QrCode text={`https://${ip}:${s.httpsPort}/`} label={`QR-kode til PPM: https://${ip}:${s.httpsPort}/`} />
                <p className="small">
                  Scan, åbn i Safari, tryk <b>Del → Føj til hjemmeskærm</b>, og åbn PPM fra ikonet. Parr telefonen i ikonet, ikke i Safari: de husker hver for sig.
                </p>
              </div>
              <div className="mobile-step">
                <h3>3. Parr telefonen</h3>
                {pairing && left > 0 ? (
                  <>
                    <div className="pair-code" aria-label={`Parringskode ${pairing.code.split("").join(" ")}`}>
                      {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
                    </div>
                    <p className="small muted">
                      Skriv koden i PPM på telefonen. Gyldig i {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} min.
                    </p>
                  </>
                ) : (
                  <button onClick={() => pair.mutate()} disabled={ro || pair.isPending}>
                    Parr en telefon
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
      <h3>Parrede telefoner</h3>
      {(devices.data ?? []).length === 0 ? (
        <p className="small muted">Ingen endnu.</p>
      ) : (
        <ul className="plain">
          {(devices.data ?? []).map((d) => (
            <li key={d.id} className="line">
              <span>{d.name}</span>
              <span className="small muted">{d.lastSeenAt ? `sidst set ${formatDateTime(d.lastSeenAt)}` : `parret ${formatDateTime(d.createdAt)}`}</span>
              <button className="link" onClick={() => window.confirm(`Fjern ${d.name}? Telefonen skal parres igen for at få adgang.`) && revoke.mutate(d.id)} disabled={ro}>
                Fjern
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Starts mobile access when the archive opens, if it was on last time and the computer is on a
 * network where the user turned it on (review E2). Otherwise it stays off and the panel says why.
 */
export function useMobileAutostart() {
  const session = useSession();
  const qc = useQueryClient();
  useEffect(() => {
    if (session.archive.readOnly) return;
    void (async () => {
      if (!(await getSetting<boolean>(session.archive.db, "mobile.enabled"))) return;
      const remembered = await getSetting<string[]>(session.archive.db, "mobile.networks");
      const now = await mobileAddresses().catch(() => [] as string[]);
      if (!mayAutostartMobile(remembered, now)) {
        qc.setQueryData(["mobile", "skipped"], { networks: networkKeys(now) });
        return;
      }
      await mobileStart().catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ["mobile"] });
    })();
  }, [session.archive, qc]);
}
