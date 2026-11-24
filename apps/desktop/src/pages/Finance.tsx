import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  budgetVsActual,
  commitBankImport,
  createEntity,
  decodeBankFile,
  detectSparkron,
  getSetting,
  listEntities,
  listTransactions,
  parseCsv,
  parseGeneric,
  parseSparkron,
  previewBankImport,
  PROFILES_KEY,
  recurringSummary,
  setSetting,
  setTransactionCategory,
  suggestPattern,
  ValidationError,
  type GenericProfile,
  type ImportPreview,
  type ParseResult,
  type Row,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { pickFiles } from "../platform/tauri";
import { EntityForm, RefSelect } from "../components/EntityForm";
import { Empty, Modal, SearchBox, Tabs } from "../components/ui";
import { formatDate, formatMoney, MONTH_NAMES } from "../lib/format";
import { optionLabel, PERIODS } from "../lib/entityFields";
import { useToast } from "../layout/Shell";

export function Finance() {
  return (
    <section>
      <h1>Økonomi</h1>
      <Tabs
        tabs={[
          { id: "tx", label: "Posteringer", content: () => <Transactions /> },
          { id: "import", label: "Importér kontoudtog", content: () => <ImportWizard /> },
          { id: "budget", label: "Budget", content: () => <Budget /> },
          { id: "recurring", label: "Faste udgifter", content: () => <Recurring /> },
          { id: "accounts", label: "Konti", content: () => <Accounts /> },
        ]}
      />
    </section>
  );
}

function useCategories() {
  const { archive } = useSession();
  return useQuery({ queryKey: ["category", "all"], queryFn: () => listEntities(archive.db, "category", { orderBy: "name" }) });
}

function Transactions() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [onlyUncat, setOnlyUncat] = useState(false);
  const [month, setMonth] = useState(session.env.clock.today().slice(0, 7));
  const [learn, setLearn] = useState<{ tx: Row; categoryId: string; pattern: string } | null>(null);
  const [linkTx, setLinkTx] = useState<Row | null>(null);
  const cats = useCategories();
  const from = month ? `${month}-01` : undefined;
  const to = month ? `${month}-31` : undefined;
  const list = useQuery({
    queryKey: ["bank_transaction", text, onlyUncat, month],
    queryFn: () => listTransactions(session.archive.db, { text: text || undefined, uncategorized: onlyUncat, from, to }),
  });
  const setCat = useMutation({
    mutationFn: (v: { id: string; categoryId: string | null; learnPattern?: string }) =>
      setTransactionCategory(session.ctx(), v.id, v.categoryId, { learnPattern: v.learnPattern }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bank_transaction"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["budget"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const sum = (list.data ?? []).reduce((a, t) => a + Number(t.amount_minor), 0);

  return (
    <div>
      <div className="row filters">
        <SearchBox value={text} onChange={setText} placeholder="Søg i posteringstekst" />
        <label className="inline-label">
          Måned
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={onlyUncat} onChange={(e) => setOnlyUncat(e.target.checked)} /> Kun uden kategori
        </label>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>Dato</th>
            <th>Tekst</th>
            <th className="num">Beløb</th>
            <th>Kategori</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((t) => (
            <tr key={String(t.id)}>
              <td>{formatDate(t.booking_date as string)}</td>
              <td>{String(t.text)}</td>
              <td className={`num ${Number(t.amount_minor) < 0 ? "" : "positive"}`}>{formatMoney(t.amount_minor as number)}</td>
              <td>
                <select
                  aria-label={`Kategori for ${t.text}`}
                  value={String(t.category_id ?? "")}
                  disabled={session.archive.readOnly}
                  onChange={(e) => {
                    const categoryId = e.target.value || null;
                    if (categoryId) setLearn({ tx: t, categoryId, pattern: suggestPattern(String(t.text)) });
                    else setCat.mutate({ id: String(t.id), categoryId: null });
                  }}
                >
                  <option value="">– ingen –</option>
                  {(cats.data ?? []).map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>
                      {String(c.name)}
                    </option>
                  ))}
                </select>
                {t.category_source === "rule" && <span className="small muted"> (regel)</span>}
              </td>
              <td>
                <button className="link" onClick={() => setLinkTx(t)}>
                  Kobl
                </button>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Ingen posteringer. Importér et kontoudtog.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>I alt ({list.data?.length ?? 0})</td>
            <td className="num">{formatMoney(sum)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
      {learn && (
        <Modal title="Kategori" onClose={() => setLearn(null)}>
          <p>
            Sæt kategori for <strong>{String(learn.tx.text)}</strong>.
          </p>
          <label>
            Brug altid for tekster der indeholder…
            <input value={learn.pattern} onChange={(e) => setLearn({ ...learn, pattern: e.target.value })} />
          </label>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                setCat.mutate({ id: String(learn.tx.id), categoryId: learn.categoryId, learnPattern: learn.pattern });
                setLearn(null);
              }}
              disabled={!learn.pattern.trim()}
            >
              Gem og lav regel
            </button>
            <button
              onClick={() => {
                setCat.mutate({ id: String(learn.tx.id), categoryId: learn.categoryId });
                setLearn(null);
              }}
            >
              Kun denne postering
            </button>
          </div>
        </Modal>
      )}
      {linkTx && <LinkTransaction tx={linkTx} onClose={() => setLinkTx(null)} />}
    </div>
  );
}

const LINK_TARGETS: [string, string, string][] = [
  ["vehicle", "Bil", "name"],
  ["item", "Genstand", "name"],
  ["work_order", "Arbejdsordre", "title"],
  ["policy", "Police", "title"],
  ["recurring_expense", "Fast udgift", "name"],
];

function LinkTransaction({ tx, onClose }: { tx: Row; onClose(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState("vehicle");
  const [id, setId] = useState("");
  const labelCol = LINK_TARGETS.find(([k]) => k === type)![2];
  return (
    <Modal title="Kobl postering" onClose={onClose}>
      <p>
        {formatDate(tx.booking_date as string)} · {String(tx.text)} · {formatMoney(tx.amount_minor as number)}
      </p>
      <div className="row">
        <label>
          Type
          <select value={type} onChange={(e) => (setType(e.target.value), setId(""))}>
            {LINK_TARGETS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Post
          <RefSelect type={type as never} labelCol={labelCol} value={id} onChange={setId} />
        </label>
      </div>
      <button
        className="primary"
        disabled={!id}
        onClick={async () => {
          try {
            await createEntity(session.ctx(), "transaction_link", { transaction_id: String(tx.id), target_type: type as never, target_id: id });
            await qc.invalidateQueries();
            toast("Posteringen er koblet");
            onClose();
          } catch (e) {
            toast(errorText(e), "error");
          }
        }}
      >
        Kobl
      </button>
    </Modal>
  );
}

function ImportWizard() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ["account", "list"], queryFn: () => listEntities(session.archive.db, "account", { orderBy: "name" }) });
  const profiles = useQuery({
    queryKey: ["setting", PROFILES_KEY],
    queryFn: async () => (await getSetting<GenericProfile[]>(session.archive.db, PROFILES_KEY)) ?? [],
  });
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<{ path: string; text: string } | null>(null);
  const [mode, setMode] = useState<"sparkron" | "generic">("sparkron");
  const [generic, setGeneric] = useState<GenericProfile>({ name: "", delimiter: ";", hasHeader: true, dateFormat: "DD-MM-YYYY", columns: { date: 0, text: 1, amount: 2, balance: null } });
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function choose() {
    const [p] = await pickFiles("Vælg kontoudtog (CSV)", { filterName: "CSV", extensions: ["csv", "txt"] });
    if (!p) return;
    const text = decodeBankFile(await session.env.fs.readFile(p));
    setFile({ path: p, text });
    setMode(detectSparkron(text) ? "sparkron" : "generic");
    setParsed(null);
    setPreview(null);
    setErrors([]);
  }

  async function doPreview() {
    if (!file || !accountId) return;
    const result = mode === "sparkron" ? parseSparkron(file.text) : parseGeneric(file.text, generic);
    setParsed(result);
    try {
      setPreview(await previewBankImport(session.archive.db, accountId, result));
      setErrors([]);
    } catch (e) {
      setPreview(null);
      setErrors(e instanceof ValidationError ? e.issues.map((i) => `${i.path}: ${i.message}`) : [errorText(e)]);
    }
  }

  async function commit() {
    if (!file || !parsed || !accountId) return;
    setBusy(true);
    try {
      if (mode === "generic" && generic.name.trim()) {
        const others = (profiles.data ?? []).filter((p) => p.name !== generic.name);
        await setSetting(session.ctx(), PROFILES_KEY, [...others, generic]);
      }
      const r = await commitBankImport(session.env, session.archive, session.ctx(), { accountId, parsed, filePath: file.path });
      toast(`Importeret: ${r.imported} nye, ${r.duplicates} dubletter, ${r.categorized} kategoriseret automatisk`);
      setFile(null);
      setParsed(null);
      setPreview(null);
      await qc.invalidateQueries();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const sampleRows = file ? parseCsv(file.text, generic.delimiter).slice(0, 3) : [];
  const colOptions = Array.from({ length: Math.max(0, ...sampleRows.map((r) => r.length)) }, (_, i) => i);
  const setCol = (k: keyof GenericProfile["columns"], v: string) => setGeneric((g) => ({ ...g, columns: { ...g.columns, [k]: v === "" ? null : Number(v) } }));

  return (
    <div>
      <div className="row">
        <label>
          Konto
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">– vælg konto –</option>
            {(accounts.data ?? []).map((a) => (
              <option key={String(a.id)} value={String(a.id)}>
                {String(a.name)}
              </option>
            ))}
          </select>
        </label>
        <button onClick={choose} disabled={session.archive.readOnly}>
          Vælg CSV-fil…
        </button>
      </div>
      {accounts.data?.length === 0 && <p className="warning">Opret først en konto under fanen Konti.</p>}
      {file && (
        <div className="panel">
          <p className="small muted">{file.path}</p>
          <div className="row">
            <label className="inline">
              <input type="radio" checked={mode === "sparkron"} onChange={() => setMode("sparkron")} /> Sparekassen Kronjylland (Dato, Posteringstekst, Beløb)
            </label>
            <label className="inline">
              <input type="radio" checked={mode === "generic"} onChange={() => setMode("generic")} /> Anden bank (vælg kolonner)
            </label>
          </div>
          {mode === "generic" && (
            <div className="grid2">
              <label>
                Gemte opsætninger
                <select
                  value=""
                  onChange={(e) => {
                    const p = profiles.data?.find((x) => x.name === e.target.value);
                    if (p) setGeneric(p);
                  }}
                >
                  <option value="">– vælg –</option>
                  {(profiles.data ?? []).map((p) => (
                    <option key={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Gem opsætningen som
                <input value={generic.name} onChange={(e) => setGeneric({ ...generic, name: e.target.value })} placeholder="fx Min bank" />
              </label>
              <label>
                Skilletegn
                <select value={generic.delimiter} onChange={(e) => setGeneric({ ...generic, delimiter: e.target.value })}>
                  <option value=";">Semikolon (;)</option>
                  <option value=",">Komma (,)</option>
                  <option value={"\t"}>Tabulator</option>
                </select>
              </label>
              <label>
                Datoformat
                <select value={generic.dateFormat} onChange={(e) => setGeneric({ ...generic, dateFormat: e.target.value as GenericProfile["dateFormat"] })}>
                  <option>DD-MM-YYYY</option>
                  <option>DD.MM.YYYY</option>
                  <option>YYYY-MM-DD</option>
                </select>
              </label>
              <label className="inline">
                <input type="checkbox" checked={generic.hasHeader} onChange={(e) => setGeneric({ ...generic, hasHeader: e.target.checked })} /> Første række er overskrifter
              </label>
              <span />
              {(["date", "text", "amount", "balance"] as const).map((k) => (
                <label key={k}>
                  {{ date: "Dato", text: "Tekst", amount: "Beløb", balance: "Saldo (valgfri)" }[k]}
                  <select value={generic.columns[k] ?? ""} onChange={(e) => setCol(k, e.target.value)}>
                    {k === "balance" && <option value="">Ingen</option>}
                    {colOptions.map((i) => (
                      <option key={i} value={i}>
                        Kolonne {i + 1}: {sampleRows[0]?.[i] ?? ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <button onClick={doPreview} disabled={!accountId}>
            Vis forhåndsvisning
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div className="warning" role="alert">
          <p>Filen kan ikke importeres. Intet er gemt.</p>
          <ul>
            {errors.slice(0, 20).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {preview && (
        <div className="panel">
          <p>
            <strong>{preview.newRows}</strong> nye posteringer, <strong>{preview.duplicates}</strong> dubletter (af {preview.total}).
          </p>
          <table className="list">
            <thead>
              <tr>
                <th>Dato</th>
                <th>Tekst</th>
                <th className="num">Beløb</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((r) => (
                <tr key={r.line} className={r.duplicate ? "muted" : ""}>
                  <td>{formatDate(r.booking_date)}</td>
                  <td>{r.text}</td>
                  <td className="num">{formatMoney(r.amount_minor)}</td>
                  <td>{r.duplicate ? "Dublet" : "Ny"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="primary" onClick={commit} disabled={busy || preview.newRows === 0}>
            Importér {preview.newRows} posteringer
          </button>
        </div>
      )}
    </div>
  );
}

function Budget() {
  const session = useSession();
  const year = Number(session.env.clock.today().slice(0, 4));
  const [selectedYear, setSelectedYear] = useState(year);
  const [adding, setAdding] = useState(false);
  const budgets = useQuery({ queryKey: ["budget", "list"], queryFn: () => listEntities(session.archive.db, "budget", { orderBy: "year", desc: true }) });
  const budget = budgets.data?.find((b) => Number(b.year) === selectedYear) ?? null;
  const rows = useQuery({
    queryKey: ["budget", "vs", budget?.id ?? null],
    queryFn: () => (budget ? budgetVsActual(session.archive.db, String(budget.id)) : Promise.resolve([])),
  });
  const [key, setKey] = useState(0);
  return (
    <div>
      <div className="row">
        <label className="inline-label">
          År
          <input type="number" className="short" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} />
        </label>
        {!budget && (
          <button className="primary" onClick={() => setAdding(true)} disabled={session.archive.readOnly}>
            Opret budget for {selectedYear}
          </button>
        )}
      </div>
      {adding && (
        <Modal title="Nyt budget" onClose={() => setAdding(false)}>
          <EntityForm type="budget" defaults={{ year: selectedYear, name: "Familiebudget" }} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      {budget && (
        <>
          <div className="scroll-x">
            <table className="list budget">
              <thead>
                <tr>
                  <th>Kategori</th>
                  {MONTH_NAMES.map((m) => (
                    <th key={m} className="num">
                      {m.slice(0, 3)}
                    </th>
                  ))}
                  <th className="num">År</th>
                </tr>
              </thead>
              <tbody>
                {(rows.data ?? []).map((r) => (
                  <tr key={r.category_id}>
                    <td>{r.name}</td>
                    {r.budget.map((b, i) => {
                      const a = r.actual[i]!;
                      const over = r.kind === "expense" && b > 0 && a > b;
                      return (
                        <td key={i} className={`num small ${over ? "danger" : ""}`} title={`Budget ${formatMoney(b)} · Faktisk ${formatMoney(a)}`}>
                          {Math.round(a / 100).toLocaleString("da-DK")}
                          <div className="muted">{Math.round(b / 100).toLocaleString("da-DK")}</div>
                        </td>
                      );
                    })}
                    <td className="num">
                      <strong>{formatMoney(r.actual_total)}</strong>
                      <div className="muted small">{formatMoney(r.budget_total)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Øverst faktisk forbrug, nederst budget (hele kroner). Rød = over budget.</p>
          <EntityForm key={key} type="budget_line" fixed={{ budget_id: String(budget.id) }} title="Tilføj budgetlinje" submitLabel="Tilføj" invalidate={[["budget"]]} onSaved={() => setKey((k) => k + 1)} />
        </>
      )}
    </div>
  );
}

function Recurring() {
  const { archive } = useSession();
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const q = useQuery({ queryKey: ["recurring_expense", "summary"], queryFn: () => recurringSummary(archive.db) });
  return (
    <div>
      <button className="primary" onClick={() => setEditing("new")} disabled={archive.readOnly}>
        Ny fast udgift
      </button>
      <table className="list">
        <thead>
          <tr>
            <th>Navn</th>
            <th>Kategori</th>
            <th className="num">Beløb</th>
            <th>Pr.</th>
            <th className="num">Pr. måned</th>
            <th>Binding</th>
          </tr>
        </thead>
        <tbody>
          {(q.data?.items ?? []).map((r) => (
            <tr key={String(r.id)} tabIndex={0} onClick={() => setEditing(r)} onKeyDown={(e) => e.key === "Enter" && setEditing(r)}>
              <td>{String(r.name)}</td>
              <td>{String(r.category_name ?? "–")}</td>
              <td className="num">{formatMoney(r.amount_minor as number)}</td>
              <td>{optionLabel(PERIODS, r.period)}</td>
              <td className="num">{formatMoney(r.monthly_minor)}</td>
              <td>{formatDate(r.binding_until as string)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>I alt pr. måned</td>
            <td className="num">
              <strong>{formatMoney(q.data?.monthly_total_minor ?? 0)}</strong>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
      {q.data?.items.length === 0 && <Empty>Ingen faste udgifter registreret.</Empty>}
      {editing && (
        <Modal title={editing === "new" ? "Ny fast udgift" : "Fast udgift"} onClose={() => setEditing(null)} wide>
          <EntityForm type="recurring_expense" row={editing === "new" ? null : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function Accounts() {
  const { archive } = useSession();
  const [key, setKey] = useState(0);
  const q = useQuery({ queryKey: ["account", "list"], queryFn: () => listEntities(archive.db, "account", { orderBy: "name" }) });
  return (
    <div>
      <ul className="plain">
        {(q.data ?? []).map((a) => (
          <li key={String(a.id)} className="line">
            <span>{String(a.name)}</span>
            <span className="muted">{String(a.bank ?? "")}</span>
            <span className="muted">{a.last4 ? `…${a.last4}` : ""}</span>
          </li>
        ))}
      </ul>
      <EntityForm key={key} type="account" title="Ny konto" invalidate={[["account"]]} onSaved={() => setKey((k) => k + 1)} />
    </div>
  );
}
