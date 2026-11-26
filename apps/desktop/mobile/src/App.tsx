import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Camera, CircleCheck, House, ImagePlus, Pencil, Plus, Search, ShoppingBasket, Package, Users } from "lucide-react";
import { api, ApiError, getToken, imageUrl, setToken } from "./api";
import { GiftForm, ItemForm, LendForm, NewPersonForm, type GiftValue } from "./forms";
import { PeopleScreen, PersonDetail } from "./people";
import { Header } from "./ui";

type Tab = "overview" | "calendar" | "food" | "items" | "people";
/** A screen on top of the tabs (a detail or a form); "Tilbage" pops it. */
type Screen =
  | { kind: "item"; id: string }
  | { kind: "itemForm"; id: string | null; item: Record<string, unknown> | null; parent?: { id: string; name: string; location_id: string | null } }
  | { kind: "person"; id: string }
  | { kind: "personForm" }
  | { kind: "giftForm"; personId?: string; gift?: GiftValue }
  | { kind: "lendForm"; itemId?: string; personId?: string }
  | { kind: "search" };

const MONTHS = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const MEALS: Record<string, string> = { breakfast: "Morgenmad", lunch: "Frokost", dinner: "Aftensmad", snack: "Mellemmåltid" };
const KIND_COLOR: Record<string, string> = {
  task: "#5a4a8c",
  work_order: "#6b5713",
  purchase: "#8a4f24",
  warranty: "#8a4f24",
  lending: "#8a4f24",
  policy: "#2b5f73",
  recurring: "#1f6b4a",
  loan: "#1f6b4a",
  meal: "#a13d1c",
  document: "#545b66",
};

const dateOf = (iso: string) => new Date(`${iso}T12:00:00`);
const fmtDate = (iso: string | null | undefined) => (iso ? `${+iso.slice(8, 10)}. ${MONTHS[+iso.slice(5, 7) - 1]}` : "");
function dayLabel(iso: string, today: string): string {
  const diff = Math.round((dateOf(iso).getTime() - dateOf(today).getTime()) / 86_400_000);
  if (diff === 0) return "I dag";
  if (diff === 1) return "I morgen";
  if (diff === -1) return "I går";
  return `${WEEKDAYS[dateOf(iso).getDay()]![0]!.toUpperCase()}${WEEKDAYS[dateOf(iso).getDay()]!.slice(1)} ${fmtDate(iso)}`;
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [paired, setPaired] = useState(Boolean(getToken()));
  const [tab, setTab] = useState<Tab>("overview");
  const [stack, setStack] = useState<Screen[]>([]);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: string | null; today: string }>("/api/me"), enabled: paired });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      setToken(null);
      setPaired(false);
    }
  }, [me.error]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stack.length, tab]);
  if (!paired) return <Pairing onPaired={() => setPaired(true)} />;
  const today = me.data?.today ?? new Date().toISOString().slice(0, 10);
  const push = (sc: Screen) => setStack((x) => [...x, sc]);
  const back = () => setStack((x) => x.slice(0, -1));
  /** Replaces the top screen, e.g. a new item's form becomes the new item. */
  const replace = (sc: Screen) => setStack((x) => [...x.slice(0, -1), sc]);
  const top = stack[stack.length - 1];
  let body;
  if (top?.kind === "item")
    body = (
      <ItemDetail
        key={top.id}
        id={top.id}
        onBack={back}
        onEdit={(item) => push({ kind: "itemForm", id: top.id, item })}
        onLend={() => push({ kind: "lendForm", itemId: top.id })}
        onOpen={(id) => push({ kind: "item", id })}
        onAddComponent={(parent) => push({ kind: "itemForm", id: null, item: null, parent })}
      />
    );
  else if (top?.kind === "itemForm") body = <ItemForm item={top.item} parent={top.parent} onCancel={back} onDone={(id) => (top.id || top.parent ? back() : replace({ kind: "item", id }))} />;
  else if (top?.kind === "person")
    body = (
      <PersonDetail
        key={top.id}
        id={top.id}
        onBack={back}
        onGift={() => push({ kind: "giftForm", personId: top.id })}
        onEditGift={(gift) => push({ kind: "giftForm", personId: top.id, gift })}
        onLend={() => push({ kind: "lendForm", personId: top.id })}
      />
    );
  else if (top?.kind === "personForm") body = <NewPersonForm onCancel={back} onDone={(id) => replace({ kind: "person", id })} />;
  else if (top?.kind === "giftForm") body = <GiftForm personId={top.personId} gift={top.gift} today={today} onCancel={back} onDone={back} />;
  else if (top?.kind === "lendForm") body = <LendForm itemId={top.itemId} personId={top.personId} today={today} onCancel={back} onDone={back} />;
  else if (top?.kind === "search") body = <SearchScreen onBack={back} onOpenItem={(id) => push({ kind: "item", id })} />;
  else if (tab === "overview") body = <Overview today={today} user={me.data?.user ?? null} onSearch={() => push({ kind: "search" })} />;
  else if (tab === "calendar") body = <CalendarList today={today} />;
  else if (tab === "food") body = <Food today={today} />;
  else if (tab === "items") body = <Items onOpen={(id) => push({ kind: "item", id })} onNew={() => push({ kind: "itemForm", id: null, item: null })} />;
  else body = <PeopleScreen onOpen={(id) => push({ kind: "person", id })} onNew={() => push({ kind: "personForm" })} />;
  return (
    <div className="app">
      <main className="screen">
        {body}
        {me.error && !(me.error instanceof ApiError && me.error.status === 401) && <p className="banner error">{errorText(me.error)}</p>}
      </main>
      <nav className="tabbar" aria-label="Faner">
        {(
          [
            ["overview", "Overblik", House],
            ["calendar", "Kalender", CalendarDays],
            ["food", "Mad", ShoppingBasket],
            ["items", "Ting", Package],
            ["people", "Folk", Users],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            aria-current={tab === id && !top ? "page" : undefined}
            onClick={() => {
              setStack([]);
              setTab(id);
            }}
          >
            <Icon size={24} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------- pairing

function Pairing({ onPaired }: { onPaired(): void }) {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  const [code, setCode] = useState("");
  const [name, setName] = useState("iPhone");
  const pair = useMutation({
    mutationFn: () => api<{ token: string }>("/api/pair", { body: { code, name } }),
    onSuccess: (r) => {
      setToken(r.token);
      onPaired();
    },
  });
  return (
    <div className="pairing">
      <img src="/icon-180.png" alt="" className="logo" />
      <h1>PPM på iPhone</h1>
      {!standalone && (
        <div className="card hint">
          <b>Læg PPM på hjemmeskærmen først</b>
          <p>
            Tryk på <b>Del</b>-knappen nederst i Safari, vælg <b>Føj til hjemmeskærm</b>, og åbn PPM fra det nye ikon. Parr derefter telefonen dér.
          </p>
        </div>
      )}
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          pair.mutate();
        }}
      >
        <p>
          Åbn PPM på computeren: <b>Indstillinger → Mobil (iPhone) → Parr en telefon</b>, og skriv koden her.
        </p>
        <label>
          Parringskode
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="one-time-code" inputMode="text" maxLength={7} placeholder="ABC123" required />
        </label>
        <label>
          Telefonens navn
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <button className="primary big" disabled={pair.isPending || code.replace(/\W/g, "").length < 6}>
          Parr telefonen
        </button>
        {pair.error && (
          <p className="error" role="alert">
            {errorText(pair.error)}
          </p>
        )}
      </form>
      <p className="muted small">Telefonen taler kun med computeren på jeres eget netværk. Intet sendes til internettet.</p>
    </div>
  );
}

// ---------------------------------------------------------------- overview

interface OvTask {
  title: string;
  due: string | null;
  occurrence: string;
}
interface Overview {
  today: string;
  overdue: OvTask[];
  upcoming: OvTask[];
  expiring: OvTask[];
  meals: { today: { label: string }[]; tomorrow: { label: string }[] } | null;
  lending: { id: string; thing: string; borrower: string; due: string | null; overdue: boolean }[];
}

function Overview({ today, user, onSearch }: { today: string; user: string | null; onSearch(): void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/api/overview") });
  const done = useMutation({
    mutationFn: (occ: string) => api(`/api/occurrences/${occ}/complete`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const ret = useMutation({
    mutationFn: (id: string) => api(`/api/lending/${id}/return`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const d = q.data;
  const taskList = (title: string, tasks: OvTask[], tone?: string) =>
    tasks.length > 0 && (
      <section className="card">
        <h2 className={tone}>
          {title} <span className="count">{tasks.length}</span>
        </h2>
        <ul className="rows">
          {tasks.map((t) => (
            <li key={t.occurrence} className="row">
              <div className="grow">
                <div>{t.title}</div>
                {t.due && <div className={`small ${tone === "danger" ? "danger" : "muted"}`}>{dayLabel(t.due, today)}</div>}
              </div>
              <button className="check" onClick={() => done.mutate(t.occurrence)} disabled={done.isPending} aria-label={`Markér ${t.title} som udført`}>
                <CircleCheck size={26} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <>
      <Header title="Overblik">
        <div className="upload">
          <button className="icon-btn ghost" onClick={onSearch} aria-label="Søg i alt">
            <Search size={22} aria-hidden="true" />
          </button>
          <UploadButton />
        </div>
      </Header>
      {user && <p className="muted greeting">Hej {user.split(" ")[0]} · {dayLabel(today, today).toLowerCase()} {fmtDate(today)}</p>}
      {q.isLoading && <p className="muted">Henter …</p>}
      {q.error && <p className="banner error">{errorText(q.error)}</p>}
      {d?.meals && (
        <section className="card meals">
          <div>
            <div className="small muted">I dag</div>
            <b>{d.meals.today.map((m) => m.label).join(", ") || "–"}</b>
          </div>
          <div>
            <div className="small muted">I morgen</div>
            <b>{d.meals.tomorrow.map((m) => m.label).join(", ") || "–"}</b>
          </div>
        </section>
      )}
      {d && taskList("Forfaldne", d.overdue, "danger")}
      {d && taskList("Næste dage", d.upcoming)}
      {d && d.expiring.length > 0 && (
        <section className="card">
          <h2>
            Udløber snart <span className="count">{d.expiring.length}</span>
          </h2>
          <ul className="rows">
            {d.expiring.map((t) => (
              <li key={t.occurrence} className="row">
                <div className="grow">{t.title}</div>
                <span className="small muted">{fmtDate(t.due)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {d && d.lending.length > 0 && (
        <section className="card">
          <h2>Udlånt</h2>
          <ul className="rows">
            {d.lending.map((l) => (
              <li key={l.id} className="row">
                <div className="grow">
                  <div>{l.thing}</div>
                  <div className={`small ${l.overdue ? "danger" : "muted"}`}>
                    {l.borrower}
                    {l.due ? ` · afleveres ${fmtDate(l.due)}` : ""}
                  </div>
                </div>
                <button className="pill" onClick={() => ret.mutate(l.id)}>
                  Afleveret
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {d && !d.overdue.length && !d.upcoming.length && !d.expiring.length && !d.lending.length && <p className="empty">Intet at gøre lige nu.</p>}
    </>
  );
}

// ---------------------------------------------------------------- calendar

interface Ev {
  id: string;
  kind: string;
  start: string;
  end: string | null;
  title: string;
  detail: string | null;
  status: string | null;
}

function CalendarList({ today }: { today: string }) {
  const [offset, setOffset] = useState(0);
  const from = new Date(dateOf(today).getTime() + offset * 30 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(dateOf(from).getTime() + 45 * 86_400_000).toISOString().slice(0, 10);
  const q = useQuery({ queryKey: ["calendar", from], queryFn: () => api<Ev[]>(`/api/calendar?from=${from}&to=${to}`) });
  const days = new Map<string, Ev[]>();
  for (const e of q.data ?? []) {
    const d = e.start < from ? from : e.start;
    days.set(d, [...(days.get(d) ?? []), e]);
  }
  return (
    <>
      <Header title="Kalender" />
      <div className="segmented">
        <button onClick={() => setOffset(offset - 1)}>‹ Før</button>
        <button onClick={() => setOffset(0)} aria-pressed={offset === 0}>
          Fra i dag
        </button>
        <button onClick={() => setOffset(offset + 1)}>Senere ›</button>
      </div>
      {q.isLoading && <p className="muted">Henter …</p>}
      {q.error && <p className="banner error">{errorText(q.error)}</p>}
      {[...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, evs]) => (
          <section key={day} className="day">
            <h2 className={day === today ? "today" : ""}>{dayLabel(day, today)}</h2>
            <ul className="card rows">
              {evs.map((e) => (
                <li key={e.id} className={`row ev ${e.status ?? ""}`} style={{ ["--kc" as string]: KIND_COLOR[e.kind] ?? "#545b66" }}>
                  <span className="bar" aria-hidden="true" />
                  <div className="grow">
                    <div>{e.title}</div>
                    {(e.detail || (e.end && e.end !== e.start)) && (
                      <div className="small muted">{[e.end && e.end !== e.start ? `til ${fmtDate(e.end)}` : null, e.detail].filter(Boolean).join(" · ")}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {q.data && q.data.length === 0 && <p className="empty">Ingen begivenheder i perioden.</p>}
    </>
  );
}

// ---------------------------------------------------------------- food

interface Shopping {
  monday: string;
  list: { id: string } | null;
  sections: { category: string; items: { id: string; text: string; checked: boolean }[] }[];
}

function Food({ today }: { today: string }) {
  const qc = useQueryClient();
  const meals = useQuery({ queryKey: ["meals", today], queryFn: () => api<{ entries: { id: string; date: string; meal: string; title: string }[] }>(`/api/meals?date=${today}`) });
  const shop = useQuery({ queryKey: ["shopping", today], queryFn: () => api<Shopping>(`/api/shopping?date=${today}`) });
  const save = useMutation({
    mutationFn: (i: { id: string; checked: boolean }) => api(`/api/shopping/${i.id}`, { body: { checked: i.checked } }),
    onError: () => qc.invalidateQueries({ queryKey: ["shopping"] }),
  });
  // The tick shows at once (in the shop the connection can be slow); the computer is updated after.
  const toggle = { mutate: (i: { id: string; checked: boolean }) => {
    qc.setQueryData<Shopping>(["shopping", today], (old) =>
      old ? { ...old, sections: old.sections.map((s) => ({ ...s, items: s.items.map((x) => (x.id === i.id ? { ...x, checked: i.checked } : x)) })) } : old,
    );
    save.mutate(i);
  } };
  const byDay = new Map<string, { meal: string; title: string; id: string }[]>();
  for (const e of meals.data?.entries ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const left = (shop.data?.sections ?? []).reduce((a, s) => a + s.items.filter((i) => !i.checked).length, 0);
  return (
    <>
      <Header title="Mad" />
      <section className="card">
        <h2>Ugens madplan</h2>
        {byDay.size === 0 && <p className="muted">Ingen retter planlagt denne uge.</p>}
        <ul className="rows">
          {[...byDay.entries()].map(([day, es]) => (
            <li key={day} className={`row ${day === today ? "is-today" : ""}`}>
              <div className="day-col small">{dayLabel(day, today)}</div>
              <div className="grow">
                {es.map((e) => (
                  <div key={e.id}>
                    {e.title}
                    {e.meal !== "dinner" && <span className="small muted"> · {MEALS[e.meal]}</span>}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>
          Indkøbsliste {shop.data?.list && <span className="count">{left} tilbage</span>}
        </h2>
        {shop.data && !shop.data.list && <p className="muted">Der er ingen indkøbsliste for denne uge. Lav den i PPM på computeren.</p>}
        {(shop.data?.sections ?? []).map((s) => (
          <div key={s.category} className="shop-section">
            <h3>{s.category}</h3>
            <ul className="rows">
              {s.items.map((i) => (
                <li key={i.id}>
                  <label className={`row shop-item ${i.checked ? "checked" : ""}`}>
                    <input type="checkbox" checked={i.checked} onChange={(e) => toggle.mutate({ id: i.id, checked: e.target.checked })} />
                    <span>{i.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- items

interface ItemRow {
  id: string;
  name: string;
  location: string | null;
  brand: string | null;
  thumb: string | null;
  parent: string | null;
}

function Thumb({ docId }: { docId: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!docId || !ref.current) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        imageUrl(docId).then(setUrl, () => undefined);
      }
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [docId]);
  return (
    <span ref={ref} className="thumb" aria-hidden="true">
      {url ? <img src={url} alt="" /> : <Package size={20} />}
    </span>
  );
}

function Items({ onOpen, onNew }: { onOpen(id: string): void; onNew(): void }) {
  const [q, setQ] = useState("");
  const items = useQuery({ queryKey: ["items"], queryFn: () => api<ItemRow[]>("/api/items") });
  // Components are shown under their item; a search finds them too.
  const shown = (items.data ?? []).filter((i) => (q ? [i.name, i.location, i.brand, i.parent].some((v) => v?.toLowerCase().includes(q.toLowerCase())) : !i.parent));
  return (
    <>
      <Header title="Ting">
        <button className="icon-btn" onClick={onNew} aria-label="Ny genstand">
          <Plus size={24} aria-hidden="true" />
        </button>
      </Header>
      <input className="search" type="search" placeholder="Søg i genstande" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="card rows">
        {shown.map((i) => (
          <li key={i.id}>
            <button className="row link-row" onClick={() => onOpen(i.id)}>
              <Thumb docId={i.thumb} />
              <div className="grow">
                <div>{i.name}</div>
                {(i.location || i.brand || i.parent) && <div className="small muted">{[i.parent ? `del af ${i.parent}` : null, i.brand, i.location].filter(Boolean).join(" · ")}</div>}
              </div>
              <span className="chev" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.error && <p className="banner error">{errorText(items.error)}</p>}
      {items.data && shown.length === 0 && (
        <p className="empty">
          {q ? "Ingen genstande passer til søgningen." : "Ingen genstande endnu."}
          <br />
          <button className="pill" onClick={onNew}>
            Opret en genstand
          </button>
        </p>
      )}
    </>
  );
}

const ROLE_LABEL: Record<string, string> = { part: "Indbygget del", accessory: "Tilbehør", consumable: "Forbrugsstof", spare_part: "Reservedel" };
const STOCK_LABEL: Record<string, string> = { in_stock: "på lager", used: "brugt", to_buy: "skal købes" };

function ItemDetail({
  id,
  onBack,
  onEdit,
  onLend,
  onOpen,
  onAddComponent,
}: {
  id: string;
  onBack(): void;
  onEdit(item: Record<string, unknown>): void;
  onLend(): void;
  onOpen(id: string): void;
  onAddComponent(parent: { id: string; name: string; location_id: string | null }): void;
}) {
  const q = useQuery({
    queryKey: ["item", id],
    queryFn: () =>
      api<{
        item: Record<string, string | number | null>;
        documents: { id: string; title: string; role: string; ext: string }[];
        lending: { borrower: string; since: string; due: string | null } | null;
        path: { id: string; name: string }[];
        components: { id: string; name: string; role: string | null; quantity: number; stock: string | null; part_number: string | null; children: number }[];
      }>(`/api/items/${id}`),
  });
  const it = q.data?.item;
  const photos = (q.data?.documents ?? []).filter((d) => ["jpg", "jpeg", "png"].includes(d.ext));
  const facts: [string, string | number | null | undefined][] = it
    ? [
        ["Placering", it.location],
        ["Mærke", it.brand],
        ["Model", it.model],
        ["Serienummer", it.serial_number],
        ["Købt", fmtDate(it.purchase_date as string | null)],
        ["Kategori", it.category],
        ["Forhandler", it.vendor_name],
        ["Pris", it.purchase_price_minor != null ? `${(Number(it.purchase_price_minor) / 100).toLocaleString("da-DK", { minimumFractionDigits: 2 })} kr.` : null],
        ["Garanti til", fmtDate(it.warranty_until as string | null)],
        ["Reklamationsret til", fmtDate(it.complaint_until as string | null)],
      ]
    : [];
  return (
    <>
      <Header title={String(it?.name ?? "")} onBack={onBack}>
        {it && (
          <button className="text-btn" onClick={() => onEdit(it)}>
            <Pencil size={17} aria-hidden="true" /> Ret
          </button>
        )}
      </Header>
      {q.error && <p className="banner error">{errorText(q.error)}</p>}
      {(q.data?.path ?? []).length > 0 && (
        <p className="muted greeting">
          Del af{" "}
          {q.data!.path.map((p, n) => (
            <span key={p.id}>
              {n > 0 && " › "}
              <button className="text-btn inline" onClick={() => onOpen(p.id)}>
                {p.name}
              </button>
            </span>
          ))}
        </p>
      )}
      {photos.length > 0 && (
        <div className="photos">
          {photos.map((p) => (
            <Photo key={p.id} docId={p.id} />
          ))}
        </div>
      )}
      <div className="action-row">
        <PhotoButton itemId={id} />
        {q.data && !q.data.lending && (
          <button className="pill big-pill" onClick={onLend}>
            Lån ud
          </button>
        )}
      </div>
      {q.data?.lending && (
        <p className="banner">
          Udlånt til <b>{q.data.lending.borrower}</b> siden {fmtDate(q.data.lending.since)}
        </p>
      )}
      <dl className="card facts">
        {facts
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <section className="card">
        <h2>
          Komponenter {(q.data?.components ?? []).length > 0 && <span className="count">{q.data!.components.length}</span>}
        </h2>
        <ul className="rows">
          {(q.data?.components ?? []).map((c) => (
            <li key={c.id}>
              <button className="row link-row" onClick={() => onOpen(c.id)}>
                <div className="grow">
                  <div>{c.name}</div>
                  <div className="small muted">
                    {[c.role ? ROLE_LABEL[c.role] : null, c.part_number, c.role === "spare_part" || c.role === "consumable" ? `${c.quantity} stk. ${STOCK_LABEL[c.stock ?? "in_stock"] ?? ""}` : null, c.children ? (c.children === 1 ? "1 del" : `${c.children} dele`) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
        {it && (
          <button className="pill" onClick={() => onAddComponent({ id, name: String(it.name), location_id: (it.location_id as string | null) ?? null })}>
            + Tilføj komponent
          </button>
        )}
      </section>
      {(q.data?.documents ?? []).length > 0 && (
        <section className="card">
          <h2>Bilag</h2>
          <ul className="rows">
            {q.data!.documents.map((d) => (
              <li key={`${d.id}${d.role}`} className="row">
                <div className="grow">{d.title}</div>
                <span className="small muted">{ROLE[d.role] ?? d.role}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
const ROLE: Record<string, string> = { receipt: "Kvittering", invoice: "Faktura", photo: "Foto", manual: "Manual", warranty: "Garantibevis", other: "Andet" };

function Photo({ docId }: { docId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    imageUrl(docId).then(setUrl, () => undefined);
  }, [docId]);
  return url ? <img className="photo" src={url} alt="" /> : <span className="photo" />;
}

/** Take a photo (receipt or of the item) and send it to the computer's archive. */
function UploadButton({ itemId }: { itemId?: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<"receipt" | "photo">("receipt");
  const [msg, setMsg] = useState<string | null>(null);
  const up = useMutation({
    mutationFn: async (f: File) => {
      const ext = (f.name.match(/\.\w+$/)?.[0] ?? (f.type === "image/png" ? ".png" : ".jpg")).toLowerCase();
      const name = `${role === "receipt" ? "kvittering" : "foto"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}${ext}`;
      return api<{ duplicate: boolean }>(`/api/upload?name=${encodeURIComponent(name)}${itemId ? `&item=${itemId}&role=${role}` : ""}`, { raw: f });
    },
    onSuccess: async (r) => {
      setMsg(r.duplicate ? "Billedet fandtes allerede." : itemId ? "Gemt på genstanden." : "Sendt til PPM. Find det i Dokumenter på computeren.");
      await qc.invalidateQueries();
      setTimeout(() => setMsg(null), 3500);
    },
    onError: (e) => setMsg(errorText(e)),
  });
  return (
    <>
      <div className="upload">
        {itemId && (
          <select value={role} onChange={(e) => setRole(e.target.value as "receipt" | "photo")} aria-label="Hvad er billedet">
            <option value="receipt">Kvittering</option>
            <option value="photo">Foto af tingen</option>
          </select>
        )}
        <button className="icon-btn" onClick={() => input.current?.click()} disabled={up.isPending} aria-label={itemId ? "Tag billede til genstanden" : "Tag billede af en kvittering"}>
          <Camera size={22} aria-hidden="true" />
        </button>
        <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && up.mutate(e.target.files[0])} />
      </div>
      {(msg || up.isPending) && <div className="toast">{up.isPending ? "Sender …" : msg}</div>}
    </>
  );
}

/**
 * Adds pictures to an item: iOS offers "Tag billede" and "Fotobibliotek" because the input has no
 * `capture` attribute. Several pictures can be chosen at once.
 */
function PhotoButton({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<"photo" | "receipt">("photo");
  const [msg, setMsg] = useState<string | null>(null);
  const up = useMutation({
    mutationFn: async (files: File[]) => {
      let saved = 0;
      for (const [n, f] of files.entries()) {
        const ext = (f.name.match(/\.\w+$/)?.[0] ?? (f.type === "image/png" ? ".png" : ".jpg")).toLowerCase();
        const name = `${role === "receipt" ? "kvittering" : "foto"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}-${n + 1}${ext}`;
        await api(`/api/upload?name=${encodeURIComponent(name)}&item=${itemId}&role=${role}`, { raw: f });
        saved++;
      }
      return saved;
    },
    onSuccess: async (n) => {
      setMsg(n === 1 ? (role === "receipt" ? "Kvitteringen er gemt på genstanden." : "Billedet er gemt på genstanden.") : `${n} billeder er gemt på genstanden.`);
      await qc.invalidateQueries();
      setTimeout(() => setMsg(null), 3500);
    },
    onError: (e) => setMsg(errorText(e)),
  });
  const pick = (r: "photo" | "receipt") => {
    setRole(r);
    input.current?.click();
  };
  return (
    <>
      <button className="pill big-pill" onClick={() => pick("photo")} disabled={up.isPending}>
        <ImagePlus size={18} aria-hidden="true" /> Tilføj billede
      </button>
      <button className="pill big-pill" onClick={() => pick("receipt")} disabled={up.isPending}>
        <Camera size={18} aria-hidden="true" /> Kvittering
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) up.mutate(files);
        }}
      />
      {(msg || up.isPending) && <div className="toast">{up.isPending ? "Sender …" : msg}</div>}
    </>
  );
}

// ---------------------------------------------------------------- search

const TYPE_LABEL: Record<string, string> = {
  item: "Genstand",
  vehicle: "Bil",
  policy: "Forsikring",
  document: "Dokument",
  work_order: "Arbejdsordre",
  task: "Opgave",
  recipe: "Opskrift",
  contact: "Kontakt",
  pet: "Husdyr",
  loan: "Lån",
  lending: "Udlån",
  building_part: "Bygningsdel",
  bank_transaction: "Postering",
};

function SearchScreen({ onOpenItem, onBack }: { onOpenItem(id: string): void; onBack(): void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const r = useQuery({ queryKey: ["search", term], queryFn: () => api<{ type: string; id: string; title: string; snippet: string }[]>(`/api/search?q=${encodeURIComponent(term)}`), enabled: term.length > 1 });
  return (
    <>
      <Header title="Søg" onBack={onBack} />
      <input className="search" type="search" placeholder="Søg i alt" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="card rows">
        {(r.data ?? []).map((h) => (
          <li key={`${h.type}:${h.id}`}>
            <button className="row link-row" onClick={() => h.type === "item" && onOpenItem(h.id)} disabled={h.type !== "item"}>
              <div className="grow">
                <div>{h.title}</div>
                <div className="small muted">
                  {TYPE_LABEL[h.type] ?? h.type}
                  {h.snippet ? ` · ${h.snippet.replace(/<\/?mark>|\[|\]/g, "")}` : ""}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {r.data && r.data.length === 0 && <p className="empty">Intet fundet.</p>}
    </>
  );
}
