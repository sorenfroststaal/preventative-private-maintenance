import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './style.css';
import { HealthPrivacy, Overview, SaveOutput } from './module-actions';
import { ModuleView, sections } from './modules';

type User = { id: string; name: string; has_pin: number; is_admin: number };
type Task = { module: string; id: string; title: string; due_date: string | null };
type Document = { id: string; title: string; filename: string; source?: string; linked?: number; roles?: string };
type Opened = { cloud?: boolean; readonly?: boolean; users?: User[]; lastUserId?: string };

const chooseFiles = (purpose: string) => invoke<string[]>('choose_files', { purpose });

async function local<T>(action: string, data?: unknown): Promise<T> {
  const response = await invoke<{ result: T; error?: string }>('local_call', { request: { action, data } });
  if (response.error) throw new Error(response.error);
  return response.result;
}

function UserForm({ submit, first }: { submit: (fields: Record<string, FormDataEntryValue>) => Promise<void>; first: boolean }) {
  return <form onSubmit={(event) => {
    event.preventDefault();
    void submit(Object.fromEntries(new FormData(event.currentTarget)));
  }}>
    <label>Brugernavn<input name="name" required maxLength={120} /></label>
    <label>Personens navn<input name="personName" required maxLength={120} /></label>
    <label>PIN (valgfri)<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" /></label>
    <p>PIN beskytter brugervalget. Arkivets filer er ukrypterede.</p>
    <button>{first ? 'Opret administrator' : 'Opret bruger og person'}</button>
  </form>;
}

function App() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [selected, setSelected] = useState('');
  const [current, setCurrent] = useState<User>();
  const [readonly, setReadonly] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [exportTable, setExportTable] = useState('audit_log');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [backupDue, setBackupDue] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [section, setSection] = useState('Overblik');
  const [searchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<{ entity_id: string; title: string; module: string; entity_type: string }[]>([]);
  const [calendarIds, setCalendarIds] = useState<string[]>([]);
  const [fullHealthTitle, setFullHealthTitle] = useState(false);
  const [docSource, setDocSource] = useState('');
  const [docRole, setDocRole] = useState('');
  const [onlyQueued, setOnlyQueued] = useState(false);
  const [preview, setPreview] = useState<{ mime?: string; base64?: string; text?: string }>();
  const [inboxWarnings, setInboxWarnings] = useState<string[]>([]);
  const [repeat, setRepeat] = useState('');
  const [unit, setUnit] = useState('month');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const [nextTasks, nextDocuments, due] = await Promise.all([local<Task[]>('tasks'), local<Document[]>('documents'), local<boolean>('backupDue')]);
    setBackupDue(due);
    setTasks(nextTasks);
    setDocuments(nextDocuments);
  }

  async function archive(path: string | null, create: boolean) {
    let cloud = false;
    let stale = false;
    while (true) {
      try {
        const result = await local<Opened>(path ? 'open' : 'openRecent', { path, create, cloud, stale });
        if (result.cloud) {
          if (!window.confirm('Mappen kan være synkroniseret med en skytjeneste. Vil du fortsætte?')) return;
          cloud = true;
          continue;
        }
        setReadonly(Boolean(result.readonly));
        setUsers(result.users ?? []);
        setSelected(result.lastUserId ?? result.users?.[0]?.id ?? '');
        if (path) setSavedPath(path);
        return;
      } catch (reason) {
        if (stale || !(reason instanceof Error) || !reason.message.includes('forældede arkivlås')) throw reason;
        if (!window.confirm('Vil du fjerne den forældede arkivlås?')) return;
        stale = true;
      }
    }
  }

  useEffect(() => {
    void local<{ archivePath: string } | null>('config').then((config) => {
      if (config) setSavedPath(config.archivePath);
    }).catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    if (!current) return;
    const shortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [current]);

  async function importPaths(paths: string[]) {
    let duplicates = 0;
    for (const path of paths) {
      const result = await local<{ duplicate: boolean }>('import', path);
      if (result.duplicate) duplicates++;
    }
    setNotice(`${paths.length - duplicates} nye bilag · ${duplicates} dubletter`);
    await refresh();
  }

  useEffect(() => {
    if (!current) return;
    const listener = listen('ppm-files-dropped', () => {
      void run(async () => importPaths(await invoke<string[]>('take_dropped')));
    });
    return () => { void listener.then((unlisten) => unlisten()); };
  }, [current]);

  const chooseArchive = (create: boolean) => run(async () => {
    const [path] = await chooseFiles('open');
    if (typeof path === 'string') await archive(path, create);
  });

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pin = String(new FormData(event.currentTarget).get('pin') ?? '');
    void run(async () => {
      await local('login', { id: selected, pin });
      setCurrent(users?.find((user) => user.id === selected));
      await refresh();
    });
  };

  const newUser = (fields: Record<string, FormDataEntryValue>) => run(async () => {
    const result = await local<{ id: string; users: User[] }>('createUser', fields);
    setUsers(result.users);
    setSelected(result.id);
    setNotice('Bruger og person oprettet.');
  });

  function taskForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const due = String(fields.get('due_date') || '');
    const repetition = repeat ? {
      kind: repeat, unit, every: Number(fields.get('every')),
      ...(repeat === 'fixed' && unit === 'year' ? { month: Number(fields.get('month')) } : {}),
      ...(repeat === 'fixed' && ['month', 'year'].includes(unit) ? { day: Number(fields.get('day')) } : {}),
    } : null;
    void run(async () => {
      await local('createTask', { title: fields.get('title'), due_date: due || null, recurrence: repetition });
      form.reset();
      setRepeat('');
      await refresh();
    });
  }

  let content: ReactNode;
  if (users === null) {
    content = <><h1>Dit vedligeholdelsesarkiv</h1><p>Vælg en mappe til dit arkiv.</p><div className="actions">
      {savedPath && <button onClick={() => void run(() => archive(null, false))}>Åbn seneste arkiv</button>}
      <button onClick={() => void chooseArchive(true)}>Opret arkiv</button>
      <button onClick={() => void chooseArchive(false)}>Åbn eksisterende arkiv</button>
    </div></>;
  } else if (readonly) {
    content = <><h1>Skrivebeskyttet arkiv</h1><p>Arkivet bruger en nyere version. Opdatér appen for at se og redigere indholdet.</p>
      <button onClick={() => setUsers(null)}>Tilbage</button></>;
  } else if (users.length === 0) {
    content = <><h1>Opret den første bruger</h1><UserForm submit={newUser} first /></>;
  } else if (!current) {
    const user = users.find(({ id }) => id === selected);
    content = <><h1>Vælg bruger</h1><form onSubmit={login}>
      <label>Bruger<select value={selected} onChange={(event) => setSelected(event.target.value)}>
        {users.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      {Boolean(user?.has_pin) && <label>PIN<input key={selected} name="pin" type="password" inputMode="numeric" required /></label>}
      <div className="actions"><button>Fortsæt</button><button type="button" onClick={() => setUsers(null)}>Vælg andet arkiv</button></div>
    </form></>;
  } else if (searchOpen) {
    content = <><h1>Søg i arkivet</h1><form onSubmit={event => {
      event.preventDefault();
      const query = new FormData(event.currentTarget).get('query');
      void run(async () => setResults(await local('search', query)));
    }}>
      <label>Søg<input name="query" autoFocus /></label><div className="actions"><button>Søg</button>
        <button type="button" onClick={() => setSearchOpen(false)}>Luk</button></div>
    </form>{Object.entries(results.reduce<Record<string, typeof results>>((groups, row) => {
      const group = Object.entries(sections).find(([, types]) => types.some(([type]) => type === row.entity_type))?.[0] ??
        (row.module === 'documents' ? 'Dokumenter' : 'Opgaver');
      (groups[group] ??= []).push(row);
      return groups;
    }, {})).map(([group, hits]) =>
        <section key={group}><h2>{group}</h2><ul className="records">{hits?.map(hit =>
          <li key={hit.entity_type + hit.entity_id}><strong>{hit.title}</strong></li>)}</ul>
          <button onClick={() => { setSection(group); setSearchOpen(false); }}>Åbn {group.toLocaleLowerCase('da')}</button>
        </section>)}</>;
  } else if (section === 'Overblik') {
    content = <Overview local={local} run={run} backup={backupDue} openTasks={() => setSection('Opgaver')} />;
  } else if (sections[section]) {
    content = <ModuleView key={section} name={section} local={local} run={run} />;
  } else if (section === 'Dokumenter') {
    content = <><h1>Dokumenter</h1><p>Træk bilag ind i vinduet, eller vælg filer.</p>
      <button onClick={() => void run(async () => {
        const paths = await chooseFiles('import');
        if (Array.isArray(paths)) await importPaths(paths);
      })}>Importér bilag</button>
      <button onClick={() => void run(async () => { await refresh(); setInboxWarnings(await local('inbox')); })}>Opdatér importkø</button>
      {inboxWarnings.length > 0 && <ul>{inboxWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      <div className="actions">
        <label>Kilde<select value={docSource} onChange={e => setDocSource(e.target.value)}>
          <option value="">Alle kilder</option><option value="drop">Manuel</option><option value="inbox">Indbakke</option>
          <option value="bank_import">Bankimport</option><option value="ai">AI</option>
        </select></label>
        <label>Rolle<select value={docRole} onChange={e => setDocRole(e.target.value)}>
          <option value="">Alle roller</option><option value="receipt">Kvittering</option><option value="photo">Foto</option>
          <option value="quote">Tilbud</option><option value="invoice">Faktura</option><option value="photo_before">Førfoto</option>
          <option value="photo_after">Efterfoto</option><option value="manual">Manual</option><option value="policy_terms">Policevilkår</option>
          <option value="report">Rapport</option><option value="letter">Brev</option><option value="other">Andet</option>
        </select></label>
        <label><input type="checkbox" checked={onlyQueued} onChange={e => setOnlyQueued(e.target.checked)} />Kun uden kobling (importkø)</label>
      </div>
      <h2>Bilag</h2><ul className="records">{documents.filter(d => (!docSource || d.source === docSource) &&
        (!docRole || d.roles?.split(',').includes(docRole)) && (!onlyQueued || !d.linked)).map(({ id, filename, title }) => <li key={id}>
        <button onClick={() => void run(async () => setPreview(await local('previewDocument', id)))}>{title}</button><span>{filename}</span>
      </li>)}</ul>
      {preview && <section aria-label="Forhåndsvisning">
        <button onClick={() => setPreview(undefined)}>Luk forhåndsvisning</button>
        {preview.base64 && preview.mime?.startsWith('image/') && <img className="preview" alt="Forhåndsvisning af bilag" src={`data:${preview.mime};base64,${preview.base64}`} />}
        {preview.base64 && preview.mime === 'application/pdf' && <iframe className="preview" title="PDF-bilag" src={`data:application/pdf;base64,${preview.base64}`} />}
        {preview.text && <pre>{preview.text}</pre>}
        {!preview.base64 && !preview.text && <p>Bilaget har ingen forhåndsvisning.</p>}
      </section>}
    </>;
  } else if (section === 'Indstillinger') {
    content = <><h1>Indstillinger</h1><p className="path">{savedPath}</p><div className="actions">
      <button onClick={() => void run(async () => {
        const [path] = await chooseFiles('backup');
        if (typeof path === 'string') {
          setNotice('Backup gemt. ' + await local<string>('backup', path));
          setBackupDue(false);
        }
      })}>Lav backup</button>
      <button onClick={() => void run(async () => {
        const [path] = await chooseFiles('restore');
        if (typeof path !== 'string' || !window.confirm('Vil du gendanne arkivet fra den valgte backup?')) return;
        try {
          await local('restore', path);
          setNotice('Arkivet er gendannet.');
        } finally {
          setCurrent(undefined);
          setUsers(null);
        }
      })}>Gendan fra backup</button>
    </div>
    {Boolean(current.is_admin) && <><h2>Eksport</h2>
      <SaveOutput action="export" payload={{ format: 'json', table: 'all' }} label="Gem hele arkivet som JSON" local={local} run={run} />
      <label>Administrativ tabel<select value={exportTable} onChange={e => setExportTable(e.target.value)}>
        {'schema_migrations setting app_user person policy_coverage work_order_event task task_occurrence import_batch bank_transaction transaction_link document_link tag entity_tag search_index ai_draft ai_access_log audit_log'.split(' ').map(table =>
          <option key={table}>{table}</option>)}
      </select></label>
      <SaveOutput action="export" payload={{ format: 'csv', table: exportTable }} label="Gem tabel som CSV" local={local} run={run} />
      <SaveOutput action="export" payload={{ format: 'json', table: exportTable }} label="Gem tabel som JSON" local={local} run={run} />
      <h2>Brugere og personer</h2><UserForm submit={newUser} first={false} />
      <HealthPrivacy local={local} run={run} />
      <h3>Person uden eget login</h3>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = Object.fromEntries(new FormData(form));
        void run(async () => {
          await local('createPerson', fields);
          form.reset();
          setNotice('Personen er oprettet.');
        });
      }}>
        <label>Navn<input name="name" required maxLength={120} /></label>
        <label>Relation<input name="relation" maxLength={120} /></label>
        <button>Opret person</button>
      </form></>}</>;
  } else {
    content = <><h1>Opgaver</h1>
      <label><input type="checkbox" checked={fullHealthTitle} onChange={e => setFullHealthTitle(e.target.checked)} />Medtag fulde helbredstitler</label>
      <SaveOutput action="export" payload={{ format: 'ics', ids: calendarIds.length ? calendarIds : undefined, fullHealthTitle }}
        label={calendarIds.length ? 'Gem markerede opgaver som kalenderfil' : 'Gem åbne opgaver som kalenderfil'} local={local} run={run} />
      <ul className="records">{tasks.map(({ id, title, due_date, module }) => <li key={id}><label><input type="checkbox" checked={calendarIds.includes(id)} onChange={() => setCalendarIds(ids => ids.includes(id) ? ids.filter(key => key !== id) : [...ids, id])} />{title}</label>
        <span>{due_date ? due_date.split('-').reverse().join('.') : 'Ingen dato'}</span>
        <div className="actions">{(['done', 'skipped'] as const).map((status) => <button key={status}
          onClick={() => void run(async () => { await local('completeTask', { id, status }); await refresh(); })}>
          {status === 'done' ? 'Udført' : 'Spring over'}
        </button>)}{module !== 'health' && <button onClick={() => void run(async () => {
          await local('completeTask', { id, status: 'done', withWorkOrder: true }); await refresh();
        })}>Udført, opret arbejdsordre</button>}</div>
      </li>)}</ul>
      <h2>Ny opgave</h2><form onSubmit={taskForm}>
        <label>Titel<input name="title" required /></label>
        <label>Forfaldsdato<input name="due_date" type="date" /></label>
        <label>Gentagelse<select value={repeat} onChange={(event) => setRepeat(event.target.value)}>
          <option value="">Ingen</option><option value="fixed">Fast mønster</option><option value="interval">Fra udførelsesdato</option>
        </select></label>
        {repeat && <div className="actions">
          <label>Hver<input name="every" type="number" min="1" max="9999" defaultValue="1" required /></label>
          <label>Enhed<select value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="day">Dag</option><option value="week">Uge</option><option value="month">Måned</option><option value="year">År</option>
          </select></label>
          {repeat === 'fixed' && unit === 'year' && <label>Måned<input name="month" type="number" min="1" max="12" required /></label>}
          {repeat === 'fixed' && ['month', 'year'].includes(unit) && <label>Dag<input name="day" type="number" min="1" max="31" required /></label>}
        </div>}
        <button>Opret opgave</button>
      </form></>;
  }

  return <div className="layout">
    <aside><div className="brand">PPM</div><p>Privat vedligeholdelse</p>{current && <nav>
      {['Overblik', 'Opgaver', ...Object.keys(sections), 'Dokumenter', 'Indstillinger'].map((name) =>
        <button key={name} aria-current={section === name ? 'page' : undefined} onClick={() => { setSearchOpen(false); setSection(name); }}>{name}</button>)}
      <button onClick={() => setSearchOpen(true)}>Søg (Ctrl+K)</button>
      <button onClick={() => void run(async () => {
        await local('logout');
        setCalendarIds([]);
        setFullHealthTitle(false);
        setPreview(undefined);
        setResults([]);
        setCurrent(undefined);
      })}>Skift bruger</button>
    </nav>}</aside>
    <main>{current && backupDue && <p role="status">Der er gået over 30 dage uden backup.</p>}<fieldset disabled={busy}>{content}</fieldset>
      {busy && <p role="status">Arbejder …</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
