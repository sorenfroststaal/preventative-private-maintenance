import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { fields, archivedTables, type RecordType } from '../../../packages/core/src/domain/records';
import { BankImport, RelatedDocuments, SaveOutput } from './module-actions';
import { nextDate } from '../../../packages/core/src/recurrence/next';

type Row = { id: string } & Record<string, unknown>;
type Option = { id: string; name: string };
type Local = <T>(action: string, data?: unknown) => Promise<T>;
type Run = (action: () => Promise<void>) => Promise<void>;

export const sections: Record<string, [RecordType, string][]> = {
  'Bolig og inventar': [['property', 'Boliger'], ['location', 'Rum'], ['item', 'Genstande'], ['item_part', 'Reservedele'], ['building_part', 'Bygningsdele']],
  Arbejdsordrer: [['work_order', 'Arbejdsordrer'], ['contact', 'Kontakter']],
  Bil: [['vehicle', 'Biler'], ['odometer_reading', 'Km-stand']],
  Økonomi: [['account', 'Konti'], ['category', 'Kategorier'], ['category_rule', 'Regler'], ['budget', 'Budgetter'], ['budget_line', 'Budgetlinjer'], ['recurring_expense', 'Faste udgifter']],
  Forsikring: [['policy', 'Policer'], ['claim', 'Skader']],
  Helbred: [['health_visit', 'Besøg'], ['health_screening', 'Screeninger'], ['health_vaccination', 'Vaccinationer'], ['health_medication', 'Medicin'], ['health_allergy', 'Allergier'], ['health_measurement', 'Målinger']],
};

const labels: Record<string, string> = {
  name: 'Navn', title: 'Titel', address: 'Adresse', kind: 'Type', owned: 'Ejet', notes: 'Noter', property_id: 'Bolig',
  parent_id: 'Overordnet post', category: 'Kategori', location_id: 'Rum', brand: 'Mærke', model: 'Model',
  serial_number: 'Serienummer', purchase_date: 'Købsdato', purchase_price_minor: 'Købspris i øre', currency: 'Valuta',
  vendor_contact_id: 'Forhandler (kontakt)', vendor_name: 'Forhandler', warranty_until: 'Garanti til',
  complaint_until: 'Reklamationsret til', item_id: 'Genstand', part_number: 'Reservedelsnummer', vendor: 'Leverandør',
  installed_date: 'Installationsdato', registration: 'Nummerplade', vin: 'Stelnummer', make: 'Mærke', model_year: 'Modelår',
  first_registration_date: 'Første registrering', fuel: 'Brændstof', vehicle_id: 'Bil', reading_date: 'Aflæsningsdato',
  km: 'Km-stand', description: 'Beskrivelse', status: 'Status', target_type: 'Måltype', target_id: 'Mål', contact_id: 'Kontakt',
  reported_date: 'Registreringsdato', completed_date: 'Udført dato', cost_minor: 'Omkostning i øre', odometer_km: 'Km-stand',
  claim_id: 'Skadesag', phone: 'Telefon', email: 'E-mail', website: 'Hjemmeside', bank: 'Bank', last4: 'Sidste fire cifre',
  match_type: 'Sammenligning', pattern: 'Mønster', category_id: 'Kategori', priority: 'Prioritet', created_from: 'Oprettet fra',
  year: 'År', month: 'Måned', budget_id: 'Budget', amount_minor: 'Beløb i øre', period: 'Periode', next_date: 'Næste dato',
  binding_until: 'Binding til', policy_id: 'Police', insurer_contact_id: 'Forsikringsselskab (kontakt)', insurer_name: 'Forsikringsselskab',
  policy_number: 'Policenummer', premium_minor: 'Præmie i øre', premium_period: 'Præmieperiode', start_date: 'Fra dato',
  renewal_date: 'Fornyelsesdato', deductible_minor: 'Selvrisiko i øre', coverage_sum_minor: 'Dækning i øre', claim_number: 'Skadenummer',
  incident_date: 'Skadedato', payout_minor: 'Udbetaling i øre', person_id: 'Person', visit_date: 'Besøgsdato', reason: 'Årsag',
  referral: 'Henvisning', screening_date: 'Screeningsdato', result: 'Resultat', next_due_date: 'Næste dato', vaccine: 'Vaccine',
  dose: 'Dosis', given_date: 'Givet dato', strength: 'Styrke', dosage: 'Dosering', end_date: 'Til dato',
  prescription_renewal_date: 'Receptfornyelse', substance: 'Stof', reaction: 'Reaktion', severity: 'Sværhedsgrad',
  type: 'Type', value: 'Værdi', unit: 'Enhed', measured_at: 'Måletidspunkt', note: 'Note',
};
const choices: Record<string, string> = {
  house: 'Hus', apartment: 'Lejlighed', summerhouse: 'Sommerhus', other: 'Andet', property: 'Bolig', item: 'Genstand',
  building_part: 'Bygningsdel', vehicle: 'Bil', repair: 'Reparation', service: 'Service', damage: 'Skade',
  improvement: 'Forbedring', inspection: 'Eftersyn', registered: 'Registreret', quote_requested: 'Tilbud udbedt',
  ordered: 'Bestilt', done: 'Udført', invoiced: 'Faktureret', closed: 'Lukket', cancelled: 'Annulleret',
  petrol: 'Benzin', diesel: 'Diesel', electric: 'El', hybrid: 'Hybrid', plugin_hybrid: 'Plug-in-hybrid',
  expense: 'Udgift', income: 'Indtægt', transfer: 'Overførsel', contains: 'Indeholder', starts_with: 'Starter med',
  month: 'Måned', quarter: 'Kvartal', half_year: 'Halvår', year: 'År', user: 'Bruger', learned: 'Lært',
  home_contents: 'Indbo', building: 'Bygning', car: 'Bil', accident: 'Ulykke', health: 'Sundhed', life: 'Liv',
  travel: 'Rejse', change_of_ownership: 'Ejerskifte', pet: 'Dyr', reported: 'Anmeldt', in_progress: 'Under behandling',
  approved: 'Godkendt', rejected: 'Afvist', paid: 'Udbetalt', gp: 'Egen læge', dentist: 'Tandlæge',
  specialist: 'Speciallæge', hospital: 'Hospital', physio: 'Fysioterapeut', mild: 'Let', moderate: 'Moderat',
  severe: 'Alvorlig', craftsman: 'Håndværker', shop: 'Forhandler', insurer: 'Forsikringsselskab', doctor: 'Læge',
  workshop: 'Værksted', bank: 'Bank', '0': 'Nej', '1': 'Ja',
};
const references: Record<string, string> = {
  property_id: 'property', location_id: 'location', vendor_contact_id: 'contact', insurer_contact_id: 'contact',
  contact_id: 'contact', item_id: 'item', vehicle_id: 'vehicle', claim_id: 'claim', category_id: 'category',
  budget_id: 'budget', policy_id: 'policy', person_id: 'person',
};
type Shape = { type?: string; format?: string; enum?: (string | number)[]; const?: number; anyOf?: Shape[]; minimum?: number; maximum?: number };
function shape(field: z.ZodType): Shape {
  const meta = z.toJSONSchema(field, { io: 'input' }) as Shape;
  if (!meta.anyOf) return meta;
  const variants = meta.anyOf.filter(v => v.type !== 'null');
  if (variants.every(v => v.const !== undefined)) return { type: 'integer', enum: variants.map(v => v.const!) };
  return variants[0];
}

export function ModuleView({ name, local, run }: { name: string; local: Local; run: Run }) {
  const tabs = sections[name];
  const [type, setType] = useState(tabs[0][0]);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row>();
  const [filter, setFilter] = useState('');
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [targetType, setTargetType] = useState('');
  const [purchase, setPurchase] = useState('');
  const [aux, setAux] = useState<string[]>([]);
  const [personFilter, setPersonFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const tableFields = fields[type];
  const [receipts, setReceipts] = useState(false);
  const display = (r: Row) => String(r.title ?? r.name ?? r.vaccine ?? r.reason ?? r.description ?? r.substance ?? r.pattern ?? r.type ?? r.reading_date ?? r.amount_minor ?? r.id);
  const referenceFor = (key: string) => key === 'target_id' ? targetType : key === 'parent_id' ? type : references[key];

  async function load() {
    setRows(await local<Row[]>('records', type));
  }

  useEffect(() => {
    void run(async () => {
      await load();
      const referenced = new Set(Object.keys(tableFields).map(referenceFor).filter(Boolean));
      if (type === 'work_order') for (const value of ['property', 'building_part', 'item', 'vehicle']) referenced.add(value);
      const results = await Promise.all([...referenced].map(async table => {
        const entries = await local<Row[]>('records', table);
        return [table, entries.filter(row => !row.archived_at).map(entry => ({ id: entry.id, name: display(entry) }))] as const;
      }));
      setOptions(Object.fromEntries(results));
    });
  }, [type]);

  function edit(row?: Row) {
    setSelected(row);
    setPurchase(String(row?.purchase_date ?? ''));
    setTargetType(String(row?.target_type ?? ''));
    setAux([]);
    if (!row) return;
    if (type === 'vehicle') void run(async () => {
      const costs = await local<{ currency: string; amount: number }[]>('vehicleCosts', { id: row.id, year: new Date().getFullYear() });
      setAux(costs.map(c => new Intl.NumberFormat('da-DK', { style: 'currency', currency: c.currency }).format(c.amount / 100)));
    });
    if (['vehicle', 'item', 'building_part', 'work_order'].includes(type)) void run(async () => {
      const history = await local<{ caption: string; date: string }[]>('history', { type, id: row.id });
      setAux(previous => [...previous, ...history.map(e => e.date + ' · ' + e.caption)]);
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result: Record<string, unknown> = {};
    const schema = z.toJSONSchema(z.object(tableFields), { io: 'input' });
    const required = new Set(schema.required as string[] ?? []);
    for (const [key, field] of Object.entries(tableFields)) {
      const raw = new FormData(form).get(key);
      const info = shape(field);
      if (typeof raw !== 'string' || raw === '') {
        if (selected?.[key] != null && !required.has(key) && key !== 'currency') result[key] = null;
        continue;
      }
      result[key] = info.type === 'number' || info.type === 'integer' ? Number(raw) : info.format === 'date-time' ? new Date(raw).toISOString() : raw;
    }
    void run(async () => {
      await local('saveRecord', { type, values: result, id: selected?.id });
      edit();
      form.reset();
      await load();
    });
  }

  const required = new Set(z.toJSONSchema(z.object(tableFields), { io: 'input' }).required as string[] ?? []);
  const suggestion = type === 'item' && purchase && !selected?.complaint_until
    ? nextDate({ kind: 'interval', unit: 'year', every: 2 }, purchase, purchase) : null;

  return <>
    <h1>{name}</h1>
    <div className="actions">{tabs.map(([key, label]) =>
      <button key={key} aria-pressed={key === type} onClick={() => { edit(); setRows([]); setOptions({}); setType(key); }}>{label}</button>)}</div>
    {name === 'Helbred' && <><p>Dine egne noter og påmindelser. Erstatter ikke journal eller rådgivning fra sundhedspersonale.</p>
      <p>Synlighed pr. bruger er ikke en sikkerhedsgrænse. Arkivet er ukrypteret.</p>
      <label>Person<select value={personFilter} onChange={event => setPersonFilter(event.target.value)}>
        <option value="">Alle synlige personer</option>{options.person?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
    </>}
    <div className="actions"><label>Filtrér listen<input value={filter} onChange={e => setFilter(e.target.value)} /></label>
      {archivedTables.has(type) && <label><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Vis arkiverede</label>}
    </div>
    <ul className="records">{rows.filter(r => (showArchived || !r.archived_at) && (!personFilter || name !== 'Helbred' || r.person_id === personFilter) &&
      display(r).toLocaleLowerCase('da').includes(filter.toLocaleLowerCase('da'))).map(row =>
      <li key={row.id}><button onClick={() => edit(row)}>{display(row)}</button>
        {archivedTables.has(type) && <button onClick={() => void run(async () => {
          await local('archiveRecord', { type, id: row.id, archive: !row.archived_at });
          edit();
          await load();
        })}>{row.archived_at ? 'Gendan' : 'Arkivér'}</button>}
      </li>)}</ul>
    {(name === 'Forsikring' || name === 'Bolig og inventar') && <section><h2>Forsikringsrapport</h2>
      <label><input type="checkbox" checked={receipts} onChange={e => setReceipts(e.target.checked)} />Medtag kvitteringer</label>
      <SaveOutput action="report" payload={{ policy: type === 'policy' ? selected?.id : undefined, property: type === 'property' ? selected?.id : undefined,
        location: type === 'location' ? selected?.id : undefined, archived: showArchived, receipts }} label="Gem forsikringsrapport" local={local} run={run} />
    </section>}
    {selected && type === 'account' && <BankImport key={selected.id} account={selected.id} local={local} run={run} />}
    {selected && ['item', 'work_order', 'policy', 'vehicle', 'building_part'].includes(type) &&
      <RelatedDocuments key={selected.id} type={type} id={selected.id} local={local} run={run} />}
    <div className="actions">
      <SaveOutput action="export" payload={{ format: 'csv', table: type }} label="Gem tabel som CSV" local={local} run={run} />
      <SaveOutput action="export" payload={{ format: 'json', table: type }} label="Gem tabel som JSON" local={local} run={run} />
    </div>
    {aux.length > 0 && <ul>{aux.map((value, i) => <li key={i}>{value}</li>)}</ul>}
    {selected && <button onClick={() => edit()}>Ny post</button>}
    <h2>{selected ? 'Redigér post' : 'Ny post'}</h2>
    <form key={type + (selected?.id ?? '')} onSubmit={save}>
      {Object.entries(tableFields).map(([key, field]) => {
        const info = shape(field);
        const ref = referenceFor(key);
        const raw = selected?.[key] ?? (key === 'person_id' ? personFilter : '');
        const value = String(raw);
        const necessary = required.has(key);
        if (info.enum || ref || key === 'target_id') return <label key={key}>{labels[key]}
          <select name={key} defaultValue={value} required={necessary} onChange={key === 'target_type' ? e => setTargetType(e.target.value) : undefined}>
            <option value="">Vælg</option>
            {info.enum?.map(option => <option key={option} value={option}>{choices[option] ?? option}</option>)}
            {options[ref]?.filter(option => key !== 'parent_id' || option.id !== selected?.id).map(option =>
              <option key={option.id} value={option.id}>{option.name}</option>)}
          </select></label>;
        return <label key={key}>{labels[key]}
          <input name={key} required={necessary} defaultValue={info.format === 'date-time' ? value.slice(0, 16) : value}
            type={info.format === 'date' ? 'date' : info.format === 'date-time' ? 'datetime-local' : ['number', 'integer'].includes(info.type ?? '') ? 'number' : 'text'}
            step={info.type === 'number' ? 'any' : undefined} min={info.minimum} max={info.maximum}
            onChange={key === 'purchase_date' ? e => setPurchase(e.target.value) : undefined} />
          {key === 'complaint_until' && suggestion && <span>Forslag {suggestion.split('-').reverse().join('.')}. Forslag ud fra 2 års reklamationsret ved forbrugerkøb. Kontrollér dine egne vilkår.</span>}
        </label>;
      })}
      <button>Gem</button>
    </form>
  </>;
}
