import { ModuleTitle } from './module-icon';
import { useEffect, useState, type FormEvent } from 'react';

export type Local = <T>(action: string, data?: unknown) => Promise<T>;
export type Run = (action: () => Promise<void>) => Promise<void>;

const money = (amount: number) => new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK' }).format(amount / 100);

type BankPreview = { added: number; duplicates: number; rows: { booking_date: string; text: string; amount_minor: number }[] };
export function BankImport({ account, local, run }: { account: string; local: Local; run: Run }) {
  const [selection, setSelection] = useState('sparkron');
  type Profile = { delimiter: string; header: boolean; dateFormat: string; date: number; text: number; amount: number; balance?: number };
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const custom = selection !== 'sparkron';
  const selected = selection.startsWith('saved:') ? profiles[selection.slice(6)] : undefined;
  useEffect(() => { void run(async () => setProfiles(await local('bankProfiles'))); }, []);

  const [preview, setPreview] = useState<BankPreview>();
  const [result, setResult] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const profile = custom ? {
      delimiter: values.get('delimiter'), header: values.has('header'), dateFormat: values.get('dateFormat'),
      date: Number(values.get('date')) - 1, text: Number(values.get('text')) - 1,
      amount: Number(values.get('amount')) - 1, balance: values.get('balance') ? Number(values.get('balance')) - 1 : undefined,
    } : 'sparkron';
    void run(async () => {
      const name = values.get('profileName');
      if (custom && typeof name === 'string' && name.trim()) setProfiles(await local('saveBankProfile', { name, profile }));
      const [path] = await local<string[]>('choose_files', { purpose: 'bankPreview' });
      if (!path) return;
      setResult('');
      setPreview(undefined);
      setPreview(await local('bankPreview', { path, account, profile }));
    });
  }
  return <section><h2>Importér kontoudtog</h2><form onSubmit={submit}>
    <label>CSV-profil<select value={selection} onChange={e => { setSelection(e.target.value); setPreview(undefined); }}>
      <option value="sparkron">Sparekassen Kronjylland</option><option value="generic">Manuel kolonneopsætning</option>{Object.keys(profiles).map(name => <option key={name} value={"saved:" + name}>{name}</option>)}
    </select></label>
    {custom && <div key={selection}>
      <label>Skilletegn<select name="delimiter" defaultValue={selected?.delimiter ?? ";"}><option value=";">Semikolon</option><option value=",">Komma</option><option value={'\t'}>Tabulator</option></select></label>
      <label><input name="header" type="checkbox" defaultChecked={selected?.header ?? true} />Første række er overskrifter</label>
      <label>Datoformat<select name="dateFormat" defaultValue={selected?.dateFormat ?? "danish"}><option value="danish">Dag, måned, år</option><option value="iso">År, måned, dag</option></select></label>
      <div className="actions">{[['date', 'Dato'], ['text', 'Tekst'], ['amount', 'Beløb'], ['balance', 'Saldo']].map(([key, label], index) =>
        <label key={key}>{label} (kolonne)<input name={key} type="number" required={index < 3} min="1" max="101" defaultValue={typeof selected?.[key as "date" | "text" | "amount" | "balance"] === "number" ? selected[key as "date" | "text" | "amount" | "balance"]! + 1 : index < 3 ? index + 1 : undefined} /></label>)}
      </div>
      <label>Gem opsætningen under navn (valgfrit)<input name="profileName" maxLength={80} /></label>
    </div>}
    <button>Vælg CSV og vis forhåndsvisning</button>
  </form>
  {preview && <>
    <p>{preview.added} nye · {preview.duplicates} dubletter</p>
    <table><thead><tr><th>Dato</th><th>Tekst</th><th>Beløb</th></tr></thead><tbody>
      {preview.rows.map((row, index) => <tr key={index}><td>{row.booking_date}</td><td>{row.text}</td><td>{money(row.amount_minor)}</td></tr>)}
    </tbody></table>
    <button onClick={() => void run(async () => {
      const data = await local<{ added: number; duplicates: number }>('bankApply');
      setPreview(undefined);
      setResult(`${data.added} importeret · ${data.duplicates} dubletter`);
    })}>Gennemfør import</button>
  </>}
  {result && <p role="status">{result}</p>}
  </section>;
}

type Task = { id: string; title: string; due_date: string | null };
type Summary = { spending: { month: string; amount: number }[]; current: string; meals: { day: string; name: string }[]; overdue: Task[]; upcoming: Task[]; expires: Task[]; horizon: number; missing: string[]; drafts: number; uncategorized: number;
  finances: { category: string; actual: number; budget: number }[] };

export function Overview({ local, run, backup, openTasks }: { local: Local; run: Run; backup: boolean; openTasks: (id: string) => void }) {
  const [summary, setSummary] = useState<Summary>();
  const [postpone, setPostpone] = useState('');
  async function load() { setSummary(await local('dashboard')); }
  useEffect(() => { void run(load); }, []);
  if (!summary) return <ModuleTitle name="Overblik" />;
  const lists = [['Forfaldne', summary.overdue], [`Næste ${summary.horizon} dage`, summary.upcoming], ['Udløber snart', summary.expires]] as const;
  const cards = [...lists.map(([title, entries]) => [title, entries.length] as const), ['Mangler oplysninger', summary.missing.length] as const];
  const amounts = summary.spending.map(row => row.amount);
  const low = Math.min(0, ...amounts);
  const high = Math.max(1, ...amounts);
  const points = amounts.map((amount, i) => [4 + i * 40, 74 - 68 * (amount - low) / (high - low)].join(',')).join(' ');
  return <><ModuleTitle name="Overblik" />
    <div className="metrics">{cards.map(([title, count], i) => <a href={'#overview-' + i} key={title}><strong>{count}</strong>{title}</a>)}</div>
    {summary.meals.length > 0 && <section><h2>Madplan</h2><ul>{summary.meals.map((meal, i) =>
      <li key={i}>{meal.day === summary.current ? 'I dag' : 'I morgen'} · {meal.name}</li>)}</ul></section>}
    {lists.map(([title, entries], i) => <section id={'overview-' + i} key={title}><h2>{title}</h2>
    {entries.length === 0 && <p>Ingen opgaver.</p>}
    <ul className="records">{entries.map(task => <li key={task.id}><span><strong>{task.title}</strong> · {task.due_date?.split('-').reverse().join('.')}</span>
      <div className="actions">
        <button onClick={() => void run(async () => { await local('completeTask', { id: task.id, status: 'done' }); await load(); })}>Udført</button>
        <button onClick={() => setPostpone(postpone === task.id ? '' : task.id)}>Udskyd</button>
        <button onClick={() => openTasks(task.id)}>Åbn</button>
      </div>
      {postpone === task.id && <form onSubmit={event => {
        event.preventDefault();
        const date = new FormData(event.currentTarget).get('date');
        void run(async () => { await local('postponeTask', { id: task.id, date }); setPostpone(''); await load(); });
      }}><label>Ny dato<input type="date" name="date" required /></label><button>Gem dato</button></form>}
    </li>)}</ul>
  </section>)}
  <h2 id="overview-3">Mangler oplysninger</h2><ul>{summary.missing.map((item, i) => <li key={i}>{item}</li>)}</ul>
  <h2>AI-indbakke</h2><p>{summary.drafts} kladder venter</p>
  <h2>Økonomi denne måned</h2><p>{summary.uncategorized} transaktioner uden kategori</p>
  <table><thead><tr><th>Kategori</th><th>Budget</th><th>Faktisk</th></tr></thead><tbody>
    {summary.finances.map(row => <tr key={row.category}><td>{row.category}</td><td>{money(row.budget)}</td><td>{money(row.actual)}</td></tr>)}
  </tbody></table>
  <h3>Forbrug de seneste seks måneder</h3>
  <svg className="spending" viewBox="0 0 208 80" role="img" aria-label={summary.spending.map(row => row.month + ' ' + money(row.amount)).join(', ')}>
    <polyline points={points} stroke="currentColor" strokeWidth="3" fill="none" />
  </svg>
  <h2>Backup</h2><p>{backup ? 'Der er gået over 30 dage uden backup.' : 'Ingen backupadvarsel.'}</p>
  </>;
}

export function SaveOutput({ action, payload, label, local, run }: { action: string; payload: unknown; label: string; local: Local; run: Run }) {
  const [path, setPath] = useState('');
  return <><button onClick={() => void run(async () => setPath(await local(action, payload)))}>{label}</button>
    {path && <p role="status" className="path">Gemt i {path}</p>}</>;
}

export function RelatedDocuments({ type, id, local, run }: { type: string; id: string; local: Local; run: Run }) {
  const [data, setData] = useState<{ documents: { id: string; title: string }[]; links: { document_id: string; role: string; title: string }[] }>();
  const [roles] = useState({ receipt: 'Kvittering', photo: 'Foto', quote: 'Tilbud', invoice: 'Faktura',
    photo_before: 'Førfoto', photo_after: 'Efterfoto', policy_terms: 'Policevilkår', manual: 'Manual', other: 'Andet' });
  async function load() { setData(await local('documentLinks', { type, id })); }
  useEffect(() => { void run(load); }, [type, id]);
  return <section><h3>Bilag</h3><ul>{data?.links.map(link =>
    <li key={link.document_id + link.role}>{link.title} · {roles[link.role as keyof typeof roles] ?? link.role}
      <button onClick={() => void run(async () => {
        await local('unlinkRecord', { type: 'document_link', key: { document_id: link.document_id, target_type: type, target_id: id, role: link.role } });
        await load();
      })}>Fjern kobling</button></li>)}</ul>
    <form onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void run(async () => {
        await local('linkRecord', { type: 'document_link', key: { document_id: values.get('document'), target_type: type, target_id: id, role: values.get('role') } });
        await load();
      });
    }}>
      <label>Bilag<select required name="document"><option value="">Vælg</option>
        {data?.documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></label>
      <label>Rolle<select name="role">{Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button>Tilknyt bilag</button>
    </form></section>;
}

type Named = { id: string; name?: string; title?: string };
export function PolicyCoverage({ id, currency, limit, annual, local, run }: {
  id: string; currency: string; limit: number | null; annual: number | null; local: Local; run: Run;
}) {
  const [type, setType] = useState('property');
  const [options, setOptions] = useState<Record<string, Named[]>>({});
  const [data, setData] = useState<{ totals: Record<string, number>; coverage: { target_type: string; target_id: string }[] }>();
  const labels: Record<string, string> = { property: 'Boliger', item: 'Genstande', vehicle: 'Biler', person: 'Personer' };
  const fmt = (value: number, code: string) => new Intl.NumberFormat('da-DK', { style: 'currency', currency: code }).format(value / 100);
  async function load() { setData(await local('policyInfo', id)); }
  useEffect(() => {
    void run(async () => {
      await load();
      const entries = await Promise.all(Object.keys(labels).map(async key => [key, await local<Named[]>('records', key)] as const));
      setOptions(Object.fromEntries(entries));
    });
  }, [id]);

  return <section><h3>Dækning</h3>
    {annual !== null && <p>Årlig præmie {fmt(annual, currency)}</p>}
    {limit !== null && <p>Dækningssum {fmt(limit, currency)}</p>}
    {data && Object.keys(data.totals).length > 0 && <p>Dækkede genstande {Object.entries(data.totals).map(([code, total]) => fmt(total, code)).join(' · ')}</p>}
    {data && limit !== null && (data.totals[currency] ?? 0) > limit && <p role="alert">Genstandenes samlede købspris overstiger dækningssummen.</p>}
    <ul>{data?.coverage.map(row => <li key={row.target_type + row.target_id}>
      {options[row.target_type]?.find(option => option.id === row.target_id)?.name ?? row.target_id}
      <button onClick={() => void run(async () => {
        await local('unlinkRecord', { type: 'policy_coverage', key: { policy_id: id, ...row } });
        await load();
      })}>Fjern dækning</button></li>)}</ul>
    <form onSubmit={e => {
      e.preventDefault();
      const target = new FormData(e.currentTarget).get('target');
      void run(async () => {
        await local('linkRecord', { type: 'policy_coverage', key: { policy_id: id, target_type: type, target_id: target } });
        await load();
      });
    }}>
      <label>Måltype<select value={type} onChange={e => setType(e.target.value)}>{Object.entries(labels).map(([key, label]) =>
        <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Dækket post<select key={type} name="target" required><option value="">Vælg</option>{options[type]?.map(row =>
        <option key={row.id} value={row.id}>{row.name ?? row.title}</option>)}</select></label>
      <button>Tilføj dækning</button>
    </form></section>;
}

type BankTransaction = { id: string; booking_date: string; text: string; category_id: string | null; currency: string; amount_minor: number };
export function AccountTransactions({ id, local, run }: { id: string; local: Local; run: Run }) {
  const [rows, setRows] = useState<BankTransaction[]>([]);
  const [categories, setCategories] = useState<Named[]>([]);
  async function reload() { setRows(await local('bankTransactions', id)); }
  useEffect(() => {
    void run(async () => { await reload(); setCategories(await local('records', 'category')); });
  }, [id]);
  return <section><h3>Posteringer</h3><button onClick={() => void run(reload)}>Opdatér posteringer</button>
    <ul className="records">{rows.map(row => <li key={row.id}><div>
      <strong>{row.text}</strong><p>{row.booking_date} · {new Intl.NumberFormat('da-DK', { style: 'currency', currency: row.currency }).format(row.amount_minor / 100)}</p></div>
      <form key={String(row.category_id)} onSubmit={event => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        void run(async () => {
          await local('categorize', { transaction: row.id, category: values.get('category') || null, learned: values.get('learned') || null });
          await reload();
        });
      }}>
        <label>Kategori<select name="category" defaultValue={row.category_id ?? ''}><option value="">Uden kategori</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Brug altid for tekster der indeholder (valgfrit)<input name="learned" maxLength={240} /></label>
        <button>Gem kategori</button>
      </form></li>)}</ul>
  </section>;
}

export function VehicleTemplates({ id, local, run }: { id: string; local: Local; run: Run }) {
  const [templates, setTemplates] = useState<{ id: string; title: string; description: string }[]>([]);
  const [notice, setNotice] = useState('');
  useEffect(() => { void run(async () => setTemplates(await local('vehicleTemplates'))); }, []);
  return <section><h3>Forslag til bilopgaver</h3><form onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void run(async () => {
      await local('addVehicleTemplate', { vehicle: id, template: values.get('template'), due: values.get('due') || null });
      setNotice('Opgaven er oprettet.');
    });
  }}><label>Skabelon<select name="template" required><option value="">Vælg</option>{templates.map(t =>
    <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
    <label>Første dato (påkrævet ved syn)<input type="date" name="due" /></label><button>Opret bilopgave</button>
  </form>{notice && <p role="status">{notice}</p>}</section>;
}

export function HealthPrivacy({ local, run }: { local: Local; run: Run }) {
  const [data, setData] = useState<{ persons: { id: string; name: string; health_private_user_id?: string }[]; users: Named[] }>();
  async function load() { setData(await local('privacy')); }
  useEffect(() => { void run(load); }, []);
  return <section><h3>Synlighed af helbred</h3><p>Arkivet er ukrypteret. Indstillingen styrer visningen i appen.</p>
    {data?.persons.map(person => <form key={person.id + person.health_private_user_id} onSubmit={event => {
      event.preventDefault();
      const owner = new FormData(event.currentTarget).get('owner');
      void run(async () => { await local('setPrivacy', { person: person.id, owner: owner || null }); await load(); });
    }}>
      <label>{person.name}<select name="owner" defaultValue={person.health_private_user_id ?? ''}>
        <option value="">Alle brugere</option>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select></label><button>Gem synlighed</button>
    </form>)}</section>;
}

export function FinanceSummary({ local, run }: { local: Local; run: Run }) {
  type Summary = { categories: { name: string; months: { budget: number; actual: number }[] }[]; fixed: { currency: string; annual: number }[] };
  const [data, setData] = useState<Summary>();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(-1);
  async function load() { setData(await local('financeYear', year)); }
  useEffect(() => { void run(load); }, []);
  const amount = (code: string, value: number) => new Intl.NumberFormat('da-DK', { style: 'currency', currency: code }).format(value / 100);
  return <section><h2>Budget og faste udgifter</h2>
    <form onSubmit={e => { e.preventDefault(); void run(load); }}>
      <label>År<input type="number" min="1900" max="9999" value={year} onChange={e => setYear(Number(e.target.value))} required /></label>
      <label>Periode<select value={month} onChange={e => setMonth(Number(e.target.value))}>
        <option value={-1}>Hele året</option>{Array.from({ length: 12 }, (_, i) =>
          <option key={i} value={i}>{new Intl.DateTimeFormat('da-DK', { month: 'long' }).format(new Date(2026, i, 15))}</option>)}</select></label>
      <button>Vis budget</button>
    </form>
    <table><thead><tr><th>Kategori</th><th>Budget</th><th>Faktisk (DKK)</th></tr></thead><tbody>{data?.categories.map(row => {
      const months = month === -1 ? row.months : row.months.slice(month, month + 1);
      return <tr key={row.name}><td>{row.name}</td><td>{money(months.reduce((total, entry) => total + entry.budget, 0))}</td>
        <td>{money(months.reduce((total, entry) => total + entry.actual, 0))}</td></tr>;
    })}</tbody></table>
    <h3>Faste udgifter</h3><ul>{data?.fixed.map(row => <li key={row.currency}>{amount(row.currency, Math.round(row.annual / 12))} i gennemsnit pr. måned · {amount(row.currency, row.annual)} pr. år</li>)}</ul>
  </section>;
}
