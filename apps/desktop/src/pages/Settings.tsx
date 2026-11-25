import { useState, type FormEvent } from "react";
import { OnboardingDialog } from "../components/Onboarding";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBackup,
  createEntity,
  exportAllJson,
  exportIcs,
  exportableTables,
  exportTableCsv,
  exportTableJson,
  updateEntity,
  createUser,
  detectCloudFolder,
  isTempFolder,
  getSetting,
  listEntities,
  listUsers,
  setPin,
  setSetting,
  foodSettings,
  MEAL_LABELS,
  MEALS,
  type Meal,
  AI_MODULES,
  AI_MODULE_LABELS,
  readAiAccess,
  type AiModule,
} from "@ppm/core";
import { claudeDesktopAdd, mcpInfo, mcpSelftest, openMcpBundle } from "../platform/tauri";
import { errorText, useSession } from "../app/session";
import { pickDirectory, pickFiles } from "../platform/tauri";
import { formatDateTime } from "../lib/format";
import { useToast } from "../layout/Shell";
import { PinFields, validatePin } from "../components/PinFields";
import { EntityForm } from "../components/EntityForm";
import { PageHeader } from "../components/visual";

export function Settings() {
  return (
    <section>
      <PageHeader module="settings" />
      <ArchivePanel />
      <OnboardingPanel />
      <BackupPanel />
      <UsersPanel />
      <PersonsPanel />
      <ExportPanel />
      <CategoriesPanel />
      <FoodPanel />
      <AiAccessPanel />
    </section>
  );
}

function OnboardingPanel() {
  const { archive } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <h2>Opstartsguide</h2>
      <p className="small muted">Spørgsmål om bolig, bil og børn, der giver forslag til opgaver. Opgaver, der allerede findes, oprettes ikke igen.</p>
      <button onClick={() => setOpen(true)} disabled={archive.readOnly}>
        Åbn opstartsguiden
      </button>
      {open && <OnboardingDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function ArchivePanel() {
  const { archive, info } = useSession();
  const cloud = detectCloudFolder(archive.root, info.oneDriveEnv);
  const temp = isTempFolder(archive.root);
  const nested = /[\\/]PPM-arkiv[\\/]?$/i.test(archive.root);
  return (
    <div className="panel">
      <h2>Arkiv</h2>
      {temp && (
        <p className="warning" role="alert">
          Arkivet ligger i en midlertidig mappe ({archive.root}). Den kan blive tømt og kommer sjældent med i backup. Flyt arkivet: tag en backup, og gendan den i en fast mappe, fx under Dokumenter.
        </p>
      )}
      {nested && (
        <p className="small muted">Arkivet ligger i undermappen PPM-arkiv, fordi den valgte mappe ikke var tom, da arkivet blev oprettet.</p>
      )}
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
            <span className="row tight">
              <span className="muted">{p.birth_year ? `f. ${String(p.birth_year)}` : ""}</span>
              <label className="inline small">
                <input
                  type="checkbox"
                  checked={p.health_private_user_id === session.user.id}
                  disabled={session.archive.readOnly || Boolean(p.health_private_user_id && p.health_private_user_id !== session.user.id)}
                  onChange={async (e) => {
                    try {
                      await updateEntity(session.ctx(), "person", String(p.id), { health_private_user_id: e.target.checked ? session.user.id : null });
                      await qc.invalidateQueries({ queryKey: ["person"] });
                      await qc.invalidateQueries({ queryKey: ["persons"] });
                    } catch (err) {
                      toast(errorText(err), "error");
                    }
                  }}
                />
                Helbred kun synligt for mig
              </label>
            </span>
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

function ExportPanel() {
  const session = useSession();
  const toast = useToast();
  const tables = useQuery({ queryKey: ["export", "tables"], queryFn: () => exportableTables(session.archive.db) });
  const [table, setTable] = useState("item");
  const [fullHealth, setFullHealth] = useState(false);

  async function save(name: string, text: string) {
    const path = session.archive.path("eksport", name);
    await session.env.fs.writeText(path, text);
    toast(`Gemt: ${path}`);
  }
  const run = (f: () => Promise<void>) => f().catch((e) => toast(errorText(e), "error"));
  const stamp = session.env.clock.today().replace(/-/g, "");

  return (
    <div className="panel">
      <h2>Eksport</h2>
      <p className="small muted">Filerne gemmes i arkivets mappe <code>eksport</code>. Dine data er aldrig låst til programmet.</p>
      <div className="row">
        <label>
          Tabel
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            {(tables.data ?? []).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <button onClick={() => run(async () => save(`${table}-${stamp}.csv`, await exportTableCsv(session.archive.db, table)))}>CSV</button>
        <button onClick={() => run(async () => save(`${table}-${stamp}.json`, await exportTableJson(session.archive.db, table)))}>JSON</button>
        <button onClick={() => run(async () => save(`ppm-export-${stamp}.json`, await exportAllJson(session.archive.db, session.env.clock.nowIso())))}>
          Alt som JSON
        </button>
      </div>
      <h3>Kalender (ICS)</h3>
      <p className="small muted">
        Opgaver med dato eksporteres som heldagsbegivenheder uden noter og bilag. Helbredsopgaver får titlen "Helbred: påmindelse", medmindre du vælger andet.
      </p>
      <div className="row">
        <label className="inline">
          <input type="checkbox" checked={fullHealth} onChange={(e) => setFullHealth(e.target.checked)} /> Brug fulde titler på helbredsopgaver
        </label>
        <button
          onClick={() =>
            run(async () => save(`ppm-opgaver-${stamp}.ics`, await exportIcs(session.archive.db, { nowIso: session.env.clock.nowIso(), fullHealthTitles: fullHealth })))
          }
        >
          Eksportér ICS
        </button>
      </div>
    </div>
  );
}

function CategoriesPanel() {
  const session = useSession();
  const [ruleKey, setRuleKey] = useState(0);
  const [catKey, setCatKey] = useState(0);
  const rules = useQuery({
    queryKey: ["category_rule", "list"],
    queryFn: () =>
      session.archive.db.select<Record<string, unknown>>(
        "SELECT r.*, c.name AS category_name FROM category_rule r JOIN category c ON c.id = r.category_id ORDER BY r.priority, r.rowid",
      ),
  });
  const cats = useQuery({ queryKey: ["category", "list"], queryFn: () => listEntities(session.archive.db, "category", { orderBy: "name" }) });
  const MATCH: Record<string, string> = { contains: "indeholder", starts_with: "starter med", regex: "regex" };
  return (
    <div className="panel">
      <h2>Kategorier og regler</h2>
      <p className="small">{(cats.data ?? []).map((c) => String(c.name)).join(" · ")}</p>
      <EntityForm key={catKey} type="category" title="Ny kategori" submitLabel="Tilføj" invalidate={[["category"]]} onSaved={() => setCatKey((k) => k + 1)} />
      <h3>Regler for automatisk kategorisering</h3>
      <ul className="plain">
        {(rules.data ?? []).map((r) => (
          <li key={String(r.id)} className="line">
            <span>
              Tekst {MATCH[String(r.match_type)]} "{String(r.pattern)}"
            </span>
            <span>→ {String(r.category_name)}</span>
            <span className="muted small">
              {r.created_from === "learned" ? "lært" : "manuel"} · prioritet {String(r.priority)}
            </span>
          </li>
        ))}
      </ul>
      <EntityForm key={ruleKey} type="category_rule" title="Ny regel" submitLabel="Tilføj" defaults={{ priority: 100 }} invalidate={[["category_rule"]]} onSaved={() => setRuleKey((k) => k + 1)} />
    </div>
  );
}

/** Meal plan settings (spec 04 "Uge"): which meals have slots and the default number of servings. */
function FoodPanel() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["setting", "food"], queryFn: () => foodSettings(session.archive.db) });
  const [servings, setServings] = useState<string | null>(null);
  const save = async (key: string, value: unknown) => {
    try {
      await setSetting(session.ctx(), key, value);
      await qc.invalidateQueries({ queryKey: ["setting"] });
      await qc.invalidateQueries({ queryKey: ["meal_plan_entry"] });
      toast("Gemt");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  if (!q.data) return null;
  const meals = q.data.meals;
  const toggle = (m: Meal, on: boolean) => {
    const next = MEALS.filter((x) => (x === m ? on : meals.includes(x)));
    void save("food.meals", next.length ? next : ["dinner"]);
  };
  return (
    <div className="panel">
      <h2>Madplan</h2>
      <fieldset>
        <legend>Måltider i ugeplanen</legend>
        {MEALS.map((m) => (
          <label key={m} className="inline">
            <input type="checkbox" checked={meals.includes(m)} disabled={session.archive.readOnly} onChange={(e) => toggle(m, e.target.checked)} /> {MEAL_LABELS[m]}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <label>
          Husstandens størrelse (standard antal portioner)
          <input
            className="short"
            inputMode="numeric"
            value={servings ?? String(q.data.defaultServings)}
            onChange={(e) => setServings(e.target.value)}
          />
        </label>
        <button
          disabled={session.archive.readOnly || servings === null || !(Number(servings) >= 1)}
          onClick={() => void save("food.default_servings", Math.round(Number(servings))).then(() => setServings(null))}
        >
          Gem
        </button>
      </div>
    </div>
  );
}

/** Date the packaged channels were last checked against the providers' documentation (spec 06). */
const CHANNELS_VERIFIED = "25.11.2026";
const MARKETPLACE_REPO = "sorenfroststaal/preventative-private-maintenance";

function CopyBlock({ label, text }: { label: string; text: string }) {
  const toast = useToast();
  return (
    <div className="copy-block">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <span className="small">{label}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast("Kopieret");
            } catch {
              window.prompt("Kopiér teksten:", text);
            }
          }}
        >
          Kopiér
        </button>
      </div>
      <pre className="mailtext">{text}</pre>
    </div>
  );
}

/** AI-adgang (spec 04 Indstillinger, 06): modules shared with AI, the user AI acts as, channels and the access log. */
function AiAccessPanel() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const access = useQuery({ queryKey: ["setting", "ai"], queryFn: () => readAiAccess(session.archive.db) });
  const users = useQuery({ queryKey: ["app_user", "public"], queryFn: () => listUsers(session.archive.db) });
  const info = useQuery({ queryKey: ["mcp-info"], queryFn: () => mcpInfo().catch(() => ({ binaryPath: null, bundlePath: null })) });
  const log = useQuery({
    queryKey: ["ai_access_log"],
    queryFn: () =>
      session.archive.db.select<{ id: string; at: string; client_name: string | null; tool: string; denied_reason: string | null; returned_refs: string }>(
        "SELECT id, at, client_name, tool, denied_reason, returned_refs FROM ai_access_log ORDER BY at DESC LIMIT 30",
      ),
  });
  const save = async (key: string, value: unknown) => {
    try {
      await setSetting(session.ctx(), key, value);
      await qc.invalidateQueries({ queryKey: ["setting"] });
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const ro = session.archive.readOnly;
  const a = access.data;
  const [mcpbPath, setMcpbPath] = useState<string | null>(null);
  const [claudeResult, setClaudeResult] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const desktopConfig = JSON.stringify({ mcpServers: { ppm: { command: info.data?.binaryPath ?? "ppm-mcp" } } }, null, 2);
  return (
    <div className="panel">
      <h2>AI-adgang</h2>
      <p className="small muted">
        AI-klienter forbinder sig til arkivet lokalt med <code>ppm-mcp</code>. Der sendes intet over nettet af programmet selv. AI kan kun læse de moduler, du deler, og kan kun foreslå ændringer, som du godkender i AI-indbakken. Alle kald logges.
      </p>
      {a && (
        <>
          <fieldset>
            <legend>Moduler, AI må læse</legend>
            {AI_MODULES.map((m) => (
              <label key={m} className="inline">
                <input type="checkbox" checked={a.modules[m]} disabled={ro} onChange={(e) => void save("ai.modules", { ...a.modules, [m]: e.target.checked } as Record<AiModule, boolean>)} />{" "}
                {AI_MODULE_LABELS[m]}
                {m === "health" && <span className="small muted"> – følsomme oplysninger, slået fra som standard</span>}
              </label>
            ))}
          </fieldset>
          <label>
            AI agerer som
            <select value={a.asUserId ?? ""} disabled={ro} onChange={(e) => void save("ai.as_user_id", e.target.value || null)}>
              <option value="">Ingen bestemt bruger (private helbredsdata skjules)</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <h3>Forbind en AI-klient</h3>
      <p className="small muted">
        Formaterne er senest kontrolleret mod udbydernes dokumentation {CHANNELS_VERIFIED}. {info.data?.binaryPath ? <>Binæren ligger i <code>{info.data.binaryPath}</code> og er lagt i din PATH ved installationen.</> : "Binæren følger med installationen af appen."}
      </p>
      <h4>Claude Desktop</h4>
      <div className="row">
        <button
          className="primary"
          disabled={!info.data?.binaryPath || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await claudeDesktopAdd();
              setClaudeResult(
                `PPM er tilføjet i ${r.written.join(" og ")}.${r.backups.length ? " Den tidligere fil er gemt som claude_desktop_config.json.ppm-backup." : ""}${r.claudeNotFound ? " Claude Desktop ser ikke ud til at være installeret endnu – filen er lavet, så PPM er klar, når det bliver det." : ""} Luk Claude Desktop helt (også ikonet ved uret), og start det igen.`,
              );
            } catch (e) {
              setClaudeResult(null);
              toast(errorText(e), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          Tilføj PPM til Claude Desktop
        </button>
        <button
          disabled={!info.data?.binaryPath || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await mcpSelftest();
              setTestResult({ ok: true, text: `Forbindelsen virker: serveren "${r.server}" svarer med ${r.tools} værktøjer.` });
            } catch (e) {
              setTestResult({ ok: false, text: `Forbindelsen virker ikke: ${errorText(e)}` });
            } finally {
              setBusy(false);
            }
          }}
        >
          Test forbindelsen
        </button>
        {!info.data?.binaryPath && <span className="small muted">Kun i den installerede app.</span>}
      </div>
      {claudeResult && (
        <p className="small" role="status">
          {claudeResult}
        </p>
      )}
      {testResult && (
        <p className={`small ${testResult.ok ? "" : "error"}`} role="status">
          {testResult.text}
        </p>
      )}
      <p className="small muted">
        Spørg derefter Claude fx: "Hvad står der på mit overblik i PPM?" Claude beder om lov første gang, et værktøj bruges.
      </p>
      <details className="small">
        <summary>Andre måder: udvidelse (.mcpb) eller manuel konfiguration</summary>
        <div className="row" style={{ margin: "0.5rem 0" }}>
          <button
            disabled={!info.data?.bundlePath}
            onClick={async () => {
              try {
                setMcpbPath(await openMcpBundle());
              } catch (e) {
                toast(errorText(e), "error");
              }
            }}
          >
            Lav ppm.mcpb til Claude Desktop
          </button>
        </div>
        {mcpbPath && (
          <p role="status">
            Filen ligger i <code>{mcpbPath}</code> og er vist i Stifinder. Træk den ind i Claude Desktop under indstillingerne for udvidelser.
          </p>
        )}
        <CopyBlock label="Konfiguration til claude_desktop_config.json (Claude Desktop → Indstillinger → Developer → Edit Config):" text={desktopConfig} />
      </details>
      <h4>Claude Code</h4>
      <CopyBlock label="Kør i Claude Code:" text={`/plugin marketplace add ${MARKETPLACE_REPO}\n/plugin install ppm@ppm`} />
      <h4>Codex og ChatGPT desktop</h4>
      <CopyBlock label="Kør i en terminal:" text="codex mcp add ppm -- ppm-mcp" />
      <p className="small muted">Kommandoen kunne ikke kontrolleres mod OpenAIs dokumentation {CHANNELS_VERIFIED} og er ikke afprøvet.</p>
      <h4>Lokal AI</h4>
      <p className="small muted">
        En MCP-kompatibel klient med en lokal model (fx via Ollama) kan starte <code>ppm-mcp</code> over stdio. Projektet garanterer ikke en bestemt klient.
      </p>

      <h3>Log over AI-adgang</h3>
      {log.data?.length === 0 ? (
        <p className="muted small">Ingen kald endnu.</p>
      ) : (
        <table className="list compact">
          <thead>
            <tr>
              <th>Tidspunkt</th>
              <th>Klient</th>
              <th>Værktøj</th>
              <th className="num">Poster</th>
              <th>Afvist</th>
            </tr>
          </thead>
          <tbody>
            {(log.data ?? []).map((l) => (
              <tr key={l.id}>
                <td>{formatDateTime(l.at)}</td>
                <td>{l.client_name ?? "–"}</td>
                <td>
                  <code>{l.tool}</code>
                </td>
                <td className="num">{(JSON.parse(l.returned_refs) as unknown[]).length}</td>
                <td className="small">{l.denied_reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
