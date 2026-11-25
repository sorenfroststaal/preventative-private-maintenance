import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DocumentsTab } from "../components/DetailTabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveEntity,
  LOAN_KINDS,
  loanSummary,
  budgetFromRecurring,
  budgetVsActual,
  categoryTrends,
  foodHistory,
  monthlyFlow,
  RECURRING_PRIORITY,
  setFoodBudget,
  transactionYearStats,
  parseDanishAmount,
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
import { Empty, Modal, rowProps, SearchBox, Tabs } from "../components/ui";
import { formatDate, formatMoney, MONTH_NAMES } from "../lib/format";
import { optionLabel, PERIODS } from "../lib/entityFields";
import { useToast } from "../layout/Shell";
import { IconButton, PageHeader, PriorityDots, StatusBadge } from "../components/visual";
import { HBar, MultiLineChart, Sparkline, monthShort } from "../components/charts";
import { ArchiveButton } from "../components/ArchiveButton";
import { Archive } from "lucide-react";

export function Finance() {
  const [params, setParams] = useSearchParams();
  return (
    <section>
      <PageHeader module="finance" />
      <Tabs
        active={params.get("tab") ?? "overview"}
        onChange={(id) => setParams({ tab: id })}
        tabs={[
          { id: "overview", label: "Overblik", content: () => <FinanceOverview /> },
          { id: "tx", label: "Posteringer", content: () => <Transactions /> },
          { id: "import", label: "Importér kontoudtog", content: () => <ImportWizard /> },
          { id: "budget", label: "Budget", content: () => <Budget /> },
          { id: "recurring", label: "Faste udgifter", content: () => <Recurring /> },
          { id: "loans", label: "Lån", content: () => <Loans /> },
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
  const qc = useQueryClient();
  const toast = useToast();
  const txCount = useQuery({ queryKey: ["bank_transaction", "count", selectedYear], queryFn: () => transactionYearStats(session.archive.db, selectedYear) });
  const nTx = txCount.data?.count ?? 0;
  const nUnc = txCount.data?.uncategorized ?? 0;
  const suggest = useMutation({
    mutationFn: () => budgetFromRecurring(session.ctx(), String(budget!.id)),
    onSuccess: async (n) => {
      toast(n === 0 ? "Alle kategorier med faste udgifter har allerede en budgetlinje" : `${n} budgetlinjer er tilføjet fra de faste udgifter`);
      await qc.invalidateQueries({ queryKey: ["budget"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const hasLines = (rows.data ?? []).some((r) => r.budget_total !== 0);
  return (
    <div>
      <details className="panel" open={!budget || !hasLines}>
        <summary>Sådan virker budgettet</summary>
        <p className="small">
          Budgettet sammenligner det, du <strong>planlægger</strong> at bruge pr. kategori, med det, du <strong>faktisk</strong> har brugt ifølge posteringerne fra dine kontoudtog.
        </p>
        <ol className="small">
          <li>Opret et budget for året (ét pr. år er nok).</li>
          <li>Tilføj et beløb pr. kategori – fx 5.000 kr. til "Mad og dagligvarer". Lader du måneden stå tom, gælder beløbet hver måned. Du kan også hente beløbene fra dine faste udgifter.</li>
          <li>
            Importér kontoudtog under fanen <em>Importér kontoudtog</em>. Posteringerne får en kategori automatisk eller af dig under <em>Posteringer</em> – først da fyldes "faktisk" ud.
          </li>
        </ol>
      </details>
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
        <p className="small muted">
          {nTx === 0
            ? `Der er ingen posteringer fra ${selectedYear} endnu, så "faktisk" er 0. Importér et kontoudtog for at se forbruget.`
            : `${nTx} posteringer i ${selectedYear}${nUnc > 0 ? `, heraf ${nUnc} uden kategori (de tælles ikke med her – giv dem en kategori under Posteringer)` : ""}.`}
        </p>
      )}
      {budget && !hasLines && (rows.data ?? []).length === 0 && <Empty>Budgettet har ingen linjer endnu. Tilføj en budgetlinje nedenfor, eller hent dem fra de faste udgifter.</Empty>}
      {budget && (
        <>
          <div className="row">
            <button onClick={() => suggest.mutate()} disabled={session.archive.readOnly || suggest.isPending}>
              Hent beløb fra faste udgifter
            </button>
          </div>
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

const priorityLabel = (p: unknown) => RECURRING_PRIORITY.find(([n]) => n === Number(p))?.[1] ?? "";

function Recurring() {
  const session = useSession();
  const { archive } = session;
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [sort, setSort] = useState<"name" | "priority" | "amount">("name");
  const today = session.env.clock.today();
  const q = useQuery({ queryKey: ["recurring_expense", "summary", today], queryFn: () => recurringSummary(archive.db, { today }) });
  const archiveRow = useMutation({
    mutationFn: (r: Row) => archiveEntity(session.ctx(), "recurring_expense", String(r.id)),
    onSuccess: async (_, r) => {
      toast(`${String(r.name)} er arkiveret`);
      await qc.invalidateQueries({ queryKey: ["recurring_expense"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const items = [...(q.data?.items ?? [])].sort((a, b) =>
    sort === "priority"
      ? Number(a.priority ?? 0) - Number(b.priority ?? 0) || b.monthly_minor - a.monthly_minor
      : sort === "amount"
        ? b.monthly_minor - a.monthly_minor
        : String(a.name).localeCompare(String(b.name), "da"),
  );
  const byP = q.data?.monthly_by_priority ?? {};
  const optional = (byP["1"] ?? 0) + (byP["2"] ?? 0);
  return (
    <div>
      <div className="row">
        <button className="primary" onClick={() => setEditing("new")} disabled={archive.readOnly}>
          Ny fast udgift
        </button>
        <label className="inline-label">
          Sortér efter
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="name">Navn</option>
            <option value="priority">Prioritet (laveste først)</option>
            <option value="amount">Beløb pr. måned</option>
          </select>
        </label>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>Navn</th>
            <th>Kategori</th>
            <th>Prioritet</th>
            <th className="num">Beløb</th>
            <th>Pr.</th>
            <th className="num">Pr. måned</th>
            <th>Binding / slut</th>
            <th>
              <span className="sr-only">Handlinger</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={String(r.id)} tabIndex={0} onClick={() => setEditing(r)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && setEditing(r)}>
              <td>
                {String(r.name)}
                {r.property_name || r.vehicle_name ? <div className="small muted">{String(r.property_name ?? r.vehicle_name)}</div> : null}
              </td>
              <td>{String(r.category_name ?? "–")}</td>
              <td>{r.priority != null ? <PriorityDots value={Number(r.priority)} label={priorityLabel(r.priority)} /> : <span className="muted small">Ikke vurderet</span>}</td>
              <td className="num" title={r.amount_variable ? "Variabelt beløb – et skøn" : undefined}>
                {r.amount_variable ? "ca. " : ""}
                {formatMoney(r.amount_minor as number)}
              </td>
              <td>{optionLabel(PERIODS, r.period)}</td>
              <td className="num">{r.ended ? <StatusBadge kind="missing">Ophørt</StatusBadge> : formatMoney(r.monthly_minor)}</td>
              <td>
                {formatDate(r.binding_until as string)}
                {r.end_date ? <div className="small muted">Slutter {formatDate(r.end_date as string)}</div> : null}
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <IconButton
                  icon={Archive}
                  label={`Arkivér ${String(r.name)}`}
                  disabled={archive.readOnly || archiveRow.isPending}
                  onClick={() => window.confirm(`Arkivér "${String(r.name)}"? Den forsvinder fra listen, men data bevares og kan findes i eksporten.`) && archiveRow.mutate(r)}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>I alt pr. måned</td>
            <td className="num">
              <strong>{formatMoney(q.data?.monthly_total_minor ?? 0)}</strong>
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
      {optional > 0 && (
        <p className="small">
          Udgifter med prioritet 1–2 (rart at have / kan undværes): <strong>{formatMoney(optional)}</strong> pr. måned, {formatMoney(optional * 12)} pr. år.
        </p>
      )}
      <p className="small muted">Arkivér en udgift, du har opsagt. Den forsvinder fra listen og summerne, men historikken bevares.</p>
      {q.data?.items.length === 0 && <Empty>Ingen faste udgifter registreret.</Empty>}
      {editing && (
        <Modal title={editing === "new" ? "Ny fast udgift" : "Fast udgift"} onClose={() => setEditing(null)} wide>
          <EntityForm type="recurring_expense" row={editing === "new" ? null : editing} defaults={{ amount_variable: 0, period: "month" }} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
          {editing !== "new" && (
            <div className="row" style={{ marginTop: "0.6rem" }}>
              <ArchiveButton type="recurring_expense" id={String(editing.id)} label="Den faste udgift" onDone={() => setEditing(null)} />
            </div>
          )}
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

/** Økonomi → Overblik: income/expense over time, the food budget and history per category. */
function FinanceOverview() {
  const session = useSession();
  const today = session.env.clock.today();
  const [months, setMonths] = useState(12);
  const flow = useQuery({ queryKey: ["bank_transaction", "flow", today, months], queryFn: () => monthlyFlow(session.archive.db, today, months) });
  const trends = useQuery({ queryKey: ["bank_transaction", "trends", today, months], queryFn: () => categoryTrends(session.archive.db, today, months) });
  const [picked, setPicked] = useState<string | null>(null);
  const data = flow.data ?? [];
  const ms = data.map((d) => d.month);
  const full = data.slice(0, -1).filter((d) => d.income_minor || d.expense_minor);
  const avg = (f: (d: (typeof data)[number]) => number) => (full.length ? Math.round(full.reduce((a, d) => a + f(d), 0) / full.length) : 0);
  const avgIn = avg((d) => d.income_minor);
  const avgOut = avg((d) => d.expense_minor);
  const rows = trends.data?.rows ?? [];
  const sel = rows.find((r) => r.category_id === picked) ?? rows.find((r) => r.kind === "expense");
  const empty = data.length > 0 && data.every((d) => !d.income_minor && !d.expense_minor);
  return (
    <div>
      <div className="row">
        <label className="inline-label">
          Periode
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={6}>6 måneder</option>
            <option value={12}>12 måneder</option>
            <option value={24}>24 måneder</option>
          </select>
        </label>
      </div>
      {empty && (
        <Empty>
          Der er ingen posteringer i perioden. Importér et kontoudtog under <em>Importér kontoudtog</em>, så vises indtægter, udgifter og historik her.
        </Empty>
      )}
      <div className="panel">
        <h2>Indtægter og udgifter</h2>
        <MultiLineChart
          months={ms}
          label={`Indtægter og udgifter de seneste ${months} måneder`}
          series={[
            { label: "Indtægter", kind: "s-income", values: data.map((d) => d.income_minor) },
            { label: "Udgifter", kind: "s-expense", values: data.map((d) => d.expense_minor) },
          ]}
        />
        <p className="small">
          Gennemsnit pr. hele måned: indtægter <strong>{formatMoney(avgIn)}</strong> · udgifter <strong>{formatMoney(avgOut)}</strong> ·{" "}
          {avgIn - avgOut >= 0 ? "overskud" : "underskud"} <strong className={avgIn - avgOut < 0 ? "danger" : ""}>{formatMoney(Math.abs(avgIn - avgOut))}</strong>
        </p>
        <p className="small muted">Overførsler mellem egne konti tælles ikke med. Posteringer uden kategori tælles efter fortegn. Indeværende måned er ikke slut.</p>
      </div>
      <FoodBudget months={months} />
      <div className="panel">
        <h2>Historik pr. kategori</h2>
        {rows.length === 0 ? (
          <p className="small muted">Ingen kategoriserede posteringer i perioden.</p>
        ) : (
          <>
            {sel && (
              <MultiLineChart
                months={trends.data!.months}
                label={`${sel.name} de seneste ${months} måneder`}
                series={[{ label: sel.name, kind: sel.kind === "income" ? "s-income" : "s-expense", values: sel.values }]}
              />
            )}
            <p className="small muted">Vælg en kategori for at se kurven. Lav fx underkategorier som "Streaming" og "Internet" under Lister → Kategorier for at følge dem hver for sig.</p>
            <table className="list">
              <thead>
                <tr>
                  <th>Kategori</th>
                  <th>Udvikling</th>
                  <th className="num" title="Gennemsnit af de måneder, der har posteringer">Gns. pr. måned</th>
                  <th className="num">I alt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.category_id} {...rowProps(sel?.category_id === r.category_id, () => setPicked(r.category_id))}>
                    <td>
                      {r.name} {r.kind === "income" && r.name !== "Indtægt" && <StatusBadge kind="done">Indtægt</StatusBadge>}
                    </td>
                    <td>
                      <Sparkline values={r.values} label={`${r.name}: ${trends.data!.months.map((m, i) => `${monthShort(m)} ${formatMoney(r.values[i]!)}`).join(", ")}`} />
                    </td>
                    <td className="num">{formatMoney(Math.round(r.total_minor / Math.max(1, r.values.filter((v) => v !== 0).length)))}</td>
                    <td className="num">{formatMoney(r.total_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function FoodBudget({ months }: { months: number }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const today = session.env.clock.today();
  const q = useQuery({ queryKey: ["budget", "food", today, months], queryFn: () => foodHistory(session.archive.db, today, months) });
  const [amount, setAmount] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const v = parseDanishAmount(amount);
      if (v === null || v < 0) throw new ValidationError([{ path: "amount_minor", message: "Skriv beløbet som fx 5.000" }]);
      return setFoodBudget(session.ctx(), Number(today.slice(0, 4)), v);
    },
    onSuccess: async () => {
      setAmount("");
      toast("Madbudgettet er gemt");
      await qc.invalidateQueries({ queryKey: ["budget"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const f = q.data;
  if (!f) return null;
  const now = f.months[f.months.length - 1]!;
  const hasBudget = now.budget_minor > 0;
  return (
    <div className="panel module" style={{ ["--mc" as string]: "var(--c-food)" }}>
      <h2>Madbudget</h2>
      {!f.has_category ? (
        <p className="small">Opret kategorien "Mad og dagligvarer" under Lister → Kategorier for at følge madforbruget.</p>
      ) : (
        <>
          <HBar label={`Mad i ${monthShort(now.month)}`} value={now.amount_minor} max={Math.max(now.amount_minor, now.budget_minor)} budget={now.budget_minor} />
          <MultiLineChart
            months={f.months.map((m) => m.month)}
            label={`Mad og dagligvarer de seneste ${months} måneder`}
            series={[
              { label: "Brugt på mad", kind: "s-main", values: f.months.map((m) => m.amount_minor) },
              ...(f.months.some((m) => m.budget_minor > 0) ? [{ label: "Budget", kind: "s-budget" as const, values: f.months.map((m) => m.budget_minor) }] : []),
            ]}
          />
          <p className="small">
            Gennemsnit pr. hele måned: <strong>{formatMoney(f.average_minor)}</strong>
            {hasBudget && ` · budget ${formatMoney(now.budget_minor)} pr. måned`}
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <label className="inline-label">
              {hasBudget ? "Nyt madbudget pr. måned" : "Sæt madbudget pr. måned"}
              <input inputMode="decimal" className="short" placeholder={f.average_minor ? String(Math.round(f.average_minor / 100)) : "5000"} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <button type="submit" disabled={!amount || session.archive.readOnly || save.isPending}>
              Gem
            </button>
          </form>
          <p className="small muted">Tæller posteringer i "Mad og dagligvarer" og dens underkategorier. Budgettet gemmes som en linje i årets budget og bruges også på Madplan.</p>
        </>
      )}
    </div>
  );
}

function Loans() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["loan", "summary"], queryFn: () => loanSummary(session.archive.db) });
  const selectedId = params.get("loan");
  const sel = q.data?.items.find((l) => l.id === selectedId) ?? null;
  const select = (id: string | null) => setParams(id ? { tab: "loans", loan: id } : { tab: "loans" });
  return (
    <div>
      <div className="row">
        <button className="primary" onClick={() => setCreating(true)} disabled={session.archive.readOnly}>
          Nyt lån
        </button>
      </div>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Lån</th>
              <th>Type</th>
              <th className="num">Restgæld</th>
              <th className="num">Rente</th>
              <th className="num">Ydelse pr. måned</th>
              <th>Sidste ydelse</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.items ?? []).map((l) => (
              <tr key={String(l.id)} {...rowProps(l.id === selectedId, () => select(String(l.id)))}>
                <td>
                  {String(l.name)}
                  {l.lender_name && <div className="small muted">{l.lender_name}</div>}
                </td>
                <td>{optionLabel(LOAN_KINDS, l.kind)}</td>
                <td className="num">
                  {formatMoney(l.balance_minor as number)}
                  {l.balance_date ? <div className="small muted">pr. {formatDate(l.balance_date as string)}</div> : null}
                </td>
                <td className="num">{l.interest_rate == null ? "–" : `${Number(l.interest_rate).toLocaleString("da-DK")} %`}</td>
                <td className="num">{formatMoney(l.monthly_payment_minor)}</td>
                <td>{formatDate(l.end_date as string)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>I alt</td>
              <td className="num">
                <strong>{formatMoney(q.data?.balance_total_minor ?? 0)}</strong>
              </td>
              <td />
              <td className="num">
                <strong>{formatMoney(q.data?.monthly_payment_total_minor ?? 0)}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
        {sel && (
          <aside className="detail wide-detail" aria-label="Lån" key={String(sel.id)}>
            <div className="header-row">
              <h2>{String(sel.name)}</h2>
              <ArchiveButton type="loan" id={String(sel.id)} label="Lånet" onDone={() => select(null)} />
            </div>
            <Tabs
              tabs={[
                { id: "info", label: "Oplysninger", content: () => <EntityForm type="loan" row={sel} /> },
                { id: "docs", label: "Bilag", content: () => <DocumentsTab targetType="loan" targetId={String(sel.id)} roles={["contract", "letter", "invoice", "other"]} /> },
              ]}
            />
          </aside>
        )}
      </div>
      {q.data?.items.length === 0 && <Empty>Ingen lån registreret. Opret fx boliglån, billån eller SU-lån med restgæld, rente og ydelse.</Empty>}
      <p className="small muted">Ret restgælden, når du får en årsopgørelse. Posteringer med afdrag kan kobles til lånet.</p>
      {creating && (
        <Modal title="Nyt lån" onClose={() => setCreating(false)} wide>
          <EntityForm
            type="loan"
            defaults={{ kind: "other", payment_period: "month" }}
            onSaved={(r) => {
              setCreating(false);
              select(String(r.id));
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
    </div>
  );
}
