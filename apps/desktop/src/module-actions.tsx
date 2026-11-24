import { useEffect, useState, type FormEvent } from 'react';

export type Local = <T>(action: string, data?: unknown) => Promise<T>;
export type Run = (action: () => Promise<void>) => Promise<void>;

const money = (amount: number) => new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK' }).format(amount / 100);

type BankPreview = { added: number; duplicates: number; rows: { booking_date: string; text: string; amount_minor: number }[] };
export function BankImport({ account, local, run }: { account: string; local: Local; run: Run }) {
  const [custom, setCustom] = useState(false);
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
      const [path] = await local<string[]>('choose_files', { purpose: 'bankPreview' });
      if (!path) return;
      setResult('');
      setPreview(undefined);
      setPreview(await local('bankPreview', { path, account, profile }));
    });
  }
  return <section><h2>Importér kontoudtog</h2><form onSubmit={submit}>
    <label>CSV-profil<select value={custom ? 'generic' : 'sparkron'} onChange={e => { setCustom(e.target.value === 'generic'); setPreview(undefined); }}>
      <option value="sparkron">Sparekassen Kronjylland</option><option value="generic">Manuel kolonneopsætning</option>
    </select></label>
    {custom && <>
      <label>Skilletegn<select name="delimiter"><option value=";">Semikolon</option><option value=",">Komma</option><option value={'\t'}>Tabulator</option></select></label>
      <label><input name="header" type="checkbox" defaultChecked />Første række er overskrifter</label>
      <label>Datoformat<select name="dateFormat"><option value="danish">Dag, måned, år</option><option value="iso">År, måned, dag</option></select></label>
      <div className="actions">{[['date', 'Dato'], ['text', 'Tekst'], ['amount', 'Beløb'], ['balance', 'Saldo']].map(([key, label], index) =>
        <label key={key}>{label} (kolonne)<input name={key} type="number" required={index < 3} min="1" max="101" defaultValue={index < 3 ? index + 1 : undefined} /></label>)}
      </div>
    </>}
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
type Summary = { overdue: Task[]; upcoming: Task[]; expires: Task[]; horizon: number; missing: string[]; drafts: number; uncategorized: number;
  finances: { category: string; actual: number; budget: number }[] };

export function Overview({ local, run, backup, openTasks }: { local: Local; run: Run; backup: boolean; openTasks: () => void }) {
  const [summary, setSummary] = useState<Summary>();
  const [postpone, setPostpone] = useState('');
  async function load() { setSummary(await local('dashboard')); }
  useEffect(() => { void run(load); }, []);
  if (!summary) return <h1>Overblik</h1>;
  const lists = [['Forfaldne', summary.overdue], [`Næste ${summary.horizon} dage`, summary.upcoming], ['Udløber snart', summary.expires]] as const;
  return <><h1>Overblik</h1>{lists.map(([title, entries]) => <section key={title}><h2>{title}</h2>
    {entries.length === 0 && <p>Ingen opgaver.</p>}
    <ul className="records">{entries.map(task => <li key={task.id}><span><strong>{task.title}</strong> · {task.due_date?.split('-').reverse().join('.')}</span>
      <div className="actions">
        <button onClick={() => void run(async () => { await local('completeTask', { id: task.id, status: 'done' }); await load(); })}>Udført</button>
        <button onClick={() => setPostpone(postpone === task.id ? '' : task.id)}>Udskyd</button>
        <button onClick={openTasks}>Åbn</button>
      </div>
      {postpone === task.id && <form onSubmit={event => {
        event.preventDefault();
        const date = new FormData(event.currentTarget).get('date');
        void run(async () => { await local('postponeTask', { id: task.id, date }); setPostpone(''); await load(); });
      }}><label>Ny dato<input type="date" name="date" required /></label><button>Gem dato</button></form>}
    </li>)}</ul>
  </section>)}
  <h2>Mangler oplysninger</h2><ul>{summary.missing.map((item, i) => <li key={i}>{item}</li>)}</ul>
  <h2>AI-indbakke</h2><p>{summary.drafts} kladder venter</p>
  <h2>Økonomi denne måned</h2><p>{summary.uncategorized} transaktioner uden kategori</p>
  <table><thead><tr><th>Kategori</th><th>Budget</th><th>Faktisk</th></tr></thead><tbody>
    {summary.finances.map(row => <tr key={row.category}><td>{row.category}</td><td>{money(row.budget)}</td><td>{money(row.actual)}</td></tr>)}
  </tbody></table>
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
