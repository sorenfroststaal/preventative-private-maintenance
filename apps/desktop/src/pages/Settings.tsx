import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBackup,
  createEntity,
  createUser,
  detectCloudFolder,
  getSetting,
  listEntities,
  listUsers,
  setPin,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { pickDirectory, pickFiles } from "../platform/tauri";
import { formatDateTime } from "../lib/format";
import { useToast } from "../layout/Shell";
import { PinFields, validatePin } from "../components/PinFields";

export function Settings() {
  return (
    <section>
      <h1>Indstillinger</h1>
      <ArchivePanel />
      <BackupPanel />
      <UsersPanel />
      <PersonsPanel />
      <p className="small muted">AI-adgang, importprofiler, kategorier og skabeloner kommer i fase 2 og 3.</p>
    </section>
  );
}

function ArchivePanel() {
  const { archive, info } = useSession();
  const cloud = detectCloudFolder(archive.root, info.oneDriveEnv);
  return (
    <div className="panel">
      <h2>Arkiv</h2>
      <dl className="kv">
        <dt>Placering</dt>
        <dd>{archive.root}</dd>
        <dt>Databaseversion</dt>
        <dd>{archive.manifest.schemaVersion}</dd>
        <dt>Programversion</dt>
        <dd>{info.appVersion}</dd>
      </dl>
      {cloud && (
        <p className="warning">
          Arkivet ligger i en {cloud}-mappe og synkroniseres derfor til skyen. Flyt det til en lokal mappe, hvis data
          ikke må forlade computeren.
        </p>
      )}
      <p className="small muted">
        Arkivet er ikke krypteret. Alle med adgang til din Windows-bruger kan læse det. Brug BitLocker.
      </p>
    </div>
  );
}

function BackupPanel() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const last = useQuery({
    queryKey: ["setting", "backup.last_at"],
    queryFn: async () => (await getSetting<string>(session.archive.db, "backup.last_at")) ?? null,
  });

  async function backup() {
    const dir = await pickDirectory("Vælg hvor backuppen skal gemmes");
    if (!dir) return;
    setBusy(true);
    try {
      const r = await createBackup(session.env, session.archive, session.ctx(), dir);
      toast(`Backup gemt: ${r.path}`);
      await qc.invalidateQueries({ queryKey: ["setting"] });
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    const [zip] = await pickFiles("Vælg backupfil", { filterName: "PPM-backup", extensions: ["zip"] });
    if (!zip) return;
    const ok = window.confirm(
      "Arkivet erstattes af indholdet i backuppen. Det nuværende arkiv flyttes til en mappe ved siden af (…old-…). Fortsæt?",
    );
    if (!ok) return;
    setBusy(true);
    await session.restoreFrom(zip);
  }

  return (
    <div className="panel">
      <h2>Backup og gendannelse</h2>
      <p>
        Sidste backup: <strong>{last.data ? formatDateTime(last.data) : "aldrig"}</strong>
      </p>
      <div className="row">
        <button className="primary" onClick={backup} disabled={busy}>
          Tag backup…
        </button>
        <button onClick={restore} disabled={busy || session.archive.readOnly}>
          Gendan fra backup…
        </button>
      </div>
      <p className="small muted">
        Backuppen er én zip-fil med database, bilag og kontrolsummer. Gem den gerne på en ekstern disk.
      </p>
    </div>
  );
}

function UsersPanel() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ["users"], queryFn: () => listUsers(session.archive.db) });
  const [name, setName] = useState("");
  const [pin, setPinValue] = useState("");
  const [pin2, setPin2] = useState("");
  const [myPin, setMyPin] = useState("");
  const [myPin2, setMyPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isAdmin = session.user.is_admin === 1;

  const add = useMutation({
    mutationFn: async () => {
      const pe = validatePin(pin, pin2);
      if (pe) throw new Error(pe);
      await createUser(session.ctx(), { name: name.trim(), pin: pin || null });
    },
    onSuccess: async () => {
      setName("");
      setPinValue("");
      setPin2("");
      setError(null);
      toast("Brugeren er oprettet");
      await qc.invalidateQueries({ queryKey: ["users"] });
      await qc.invalidateQueries({ queryKey: ["persons"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  const changePin = useMutation({
    mutationFn: async () => {
      const pe = validatePin(myPin, myPin2);
      if (pe) throw new Error(pe);
      await setPin(session.ctx(), session.user.id, myPin || null);
    },
    onSuccess: () => {
      setMyPin("");
      setMyPin2("");
      toast("PIN er gemt");
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });

  return (
    <div className="panel">
      <h2>Brugere</h2>
      <ul className="plain">
        {(users.data ?? []).map((u) => (
          <li key={u.id} className="line">
            <span>{u.name}</span>
            <span className="muted">{u.is_admin ? "Administrator" : "Bruger"}</span>
            <span className="muted">{u.has_pin ? "Med PIN" : "Uden PIN"}</span>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          changePin.mutate();
        }}
      >
        <h3>Min PIN</h3>
        <PinFields pin={myPin} pin2={myPin2} onPin={setMyPin} onPin2={setMyPin2} />
        <button type="submit">{myPin ? "Gem PIN" : "Fjern PIN"}</button>
      </form>
      {isAdmin && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <h3>Ny bruger</h3>
          <label>
            Navn
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <PinFields pin={pin} pin2={pin2} onPin={setPinValue} onPin2={setPin2} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={!name.trim() || session.archive.readOnly}>
            Opret bruger
          </button>
        </form>
      )}
    </div>
  );
}

function PersonsPanel() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const persons = useQuery({ queryKey: ["persons"], queryFn: () => listEntities(session.archive.db, "person", { orderBy: "name" }) });
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [birthYear, setBirthYear] = useState("");

  const add = useMutation({
    mutationFn: () =>
      createEntity(session.ctx(), "person", {
        name,
        relation: relation || null,
        birth_year: birthYear ? Number(birthYear) : null,
      }),
    onSuccess: async () => {
      setName("");
      setRelation("");
      setBirthYear("");
      await qc.invalidateQueries({ queryKey: ["persons"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });

  return (
    <div className="panel">
      <h2>Personer i husstanden</h2>
      <p className="small muted">
        Personer kan fx være børn. De har ikke eget login, men helbred og opgaver kan knyttes til dem. Et fødselsår
        er nok – fuld fødselsdato er ikke nødvendig.
      </p>
      <ul className="plain">
        {(persons.data ?? []).map((p) => (
          <li key={String(p.id)} className="line">
            <span>{String(p.name)}</span>
            <span className="muted">{String(p.relation ?? "")}</span>
            <span className="muted">{p.birth_year ? `f. ${String(p.birth_year)}` : ""}</span>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <label>
          Navn
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Relation
          <input value={relation} placeholder="fx barn" onChange={(e) => setRelation(e.target.value)} />
        </label>
        <label>
          Fødselsår
          <input type="number" className="short" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
        </label>
        <button type="submit" disabled={!name.trim() || session.archive.readOnly}>
          Tilføj person
        </button>
      </form>
    </div>
  );
}
