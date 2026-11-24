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
