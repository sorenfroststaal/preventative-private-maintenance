import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Download, Plus, ShoppingCart, Trash2, Upload } from "lucide-react";
import { addDays, addShoppingItem, addStarterCatalog, allergenLabel, ALLERGENS, allRecipeTags, copyLastWeek, createRecipe, dismissStarterCatalog, exportOpenPlanner, foodSettings, formatShoppingItem, generateShoppingList, getEntity, groupBySection, importDocument, importOpenPlanner, isoWeek, listForWeek, listRecipes, MEAL_LABELS, moveMeal, parseIngredientLine, parseOpenPlanner, planMeal, previewOpenPlanner, recipeAllergens, recipeCount as countRecipes, recipeIngredients, removeMeal, removeShoppingItem, setItemCategory, setItemChecked, SHOP_CATEGORIES, shoppingItems, shoppingListText, shouldOfferCatalog, updateRecipe, weekPlan, weekRecipeIds, weekStart, type AllergenKey, type Meal, type OpenPlannerDatabase, type OpenPlannerPreview, type PlannedDish, type RecipeSummary, type Row } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { EntityForm } from "../components/EntityForm";
import { ArchiveButton } from "../components/ArchiveButton";
import { DocumentPreview } from "../components/DocumentPreview";
import { Modal, rowProps, SearchBox, Tabs } from "../components/ui";
import { EmptyState, IconButton, PageHeader, StatusBadge, TextIconButton } from "../components/visual";
import { HBar } from "../components/charts";
import { formatDate, formatMoney } from "../lib/format";
import { pickFiles } from "../platform/tauri";

const DAY_NAMES = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
const compactDate = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`;
const ymdCompact = (d: string) => d.replace(/-/g, "");

/** Meal plan module: Uge, Opskrifter and Indkøbsliste (spec 04 "Madplan"). */
export function Food() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const today = session.env.clock.today();
  const monday = weekStart(params.get("uge") ?? today);
  const setMonday = (d: string) => setParams((p) => ({ ...Object.fromEntries(p), uge: weekStart(d) }));
  const [importing, setImporting] = useState(false);

  const offer = useQuery({ queryKey: ["recipe", "catalog-offer"], queryFn: () => shouldOfferCatalog(session.archive.db) });
  const recipeCount = useQuery({
    queryKey: ["recipe", "count"],
    queryFn: () => countRecipes(session.archive.db),
  });
  const catalog = useMutation({
    mutationFn: (add: boolean) => (add ? addStarterCatalog(session.ctx()) : dismissStarterCatalog(session.ctx()).then(() => 0)),
    onSuccess: async (n) => {
      if (n) toast(`${n} retter er tilføjet fra startkataloget`);
      await qc.invalidateQueries({ queryKey: ["recipe"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });

  return (
    <section>
      <PageHeader module="food">
        <TextIconButton icon={Upload} onClick={() => setImporting(true)} disabled={session.archive.readOnly}>
          Importér fra Open Planner
        </TextIconButton>
      </PageHeader>
      {offer.data && recipeCount.data === 0 && (
        <div className="notice" role="region" aria-label="Startkatalog">
          <p>Vil du starte med 40 almindelige danske retter? Du tilføjer selv ingredienser og priser bagefter.</p>
          <div className="row">
            <button className="primary" onClick={() => catalog.mutate(true)} disabled={session.archive.readOnly || catalog.isPending}>
              Tilføj startkatalog
            </button>
            <button onClick={() => catalog.mutate(false)} disabled={session.archive.readOnly}>
              Nej tak
            </button>
          </div>
        </div>
      )}
      <Tabs
        active={params.get("tab") ?? "week"}
        onChange={(tab) => setParams((p) => ({ ...Object.fromEntries(p), tab }))}
        tabs={[
          { id: "week", label: "Uge", content: () => <WeekView monday={monday} today={today} onWeek={setMonday} /> },
          { id: "recipes", label: "Opskrifter", content: () => <Recipes /> },
          { id: "shopping", label: "Indkøbsliste", content: () => <Shopping monday={monday} onWeek={setMonday} today={today} /> },
        ]}
      />
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </section>
  );
}

function WeekNav({ monday, today, onWeek }: { monday: string; today: string; onWeek(d: string): void }) {
  const { week, year } = isoWeek(monday);
  return (
    <div className="week-nav">
      <IconButton icon={ChevronLeft} label="Forrige uge" onClick={() => onWeek(addDays(monday, -7))} />
      <strong>
        Uge {week}, {year}
      </strong>
      <span className="small muted">
        {compactDate(monday)}–{formatDate(addDays(monday, 6))}
      </span>
      <IconButton icon={ChevronRight} label="Næste uge" onClick={() => onWeek(addDays(monday, 7))} />
      <button onClick={() => onWeek(today)} disabled={weekStart(today) === monday}>
        Denne uge
      </button>
    </div>
  );
}

function useInvalidateFood() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["meal_plan_entry"] }),
      qc.invalidateQueries({ queryKey: ["shopping"] }),
      qc.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
}

function WeekView({ monday, today, onWeek }: { monday: string; today: string; onWeek(d: string): void }) {
  const session = useSession();
  const toast = useToast();
  const invalidate = useInvalidateFood();
  const [, setParams] = useSearchParams();
  const [adding, setAdding] = useState<{ date: string; meal: Meal } | null>(null);
  const plan = useQuery({
    queryKey: ["meal_plan_entry", "week", monday, session.user.id],
    queryFn: () => weekPlan(session.archive.db, monday, session.user.id),
  });
  const copy = useMutation({
    mutationFn: () => copyLastWeek(session.ctx(), monday),
    onSuccess: async (n) => {
      toast(n ? `${n} retter er kopieret fra sidste uge` : "Der var intet nyt at kopiere fra sidste uge");
      await invalidate();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const shop = useMutation({
    mutationFn: () => generateShoppingList(session.ctx(), monday),
    onSuccess: async (r) => {
      toast(`Indkøbslisten har ${r.items.length} varer`);
      await invalidate();
      setParams((p) => ({ ...Object.fromEntries(p), tab: "shopping" }));
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const exportWeek = useMutation({
    mutationFn: async () => {
      const ids = await weekRecipeIds(session.archive.db, monday, addDays(monday, 6));
      if (ids.length === 0) throw new Error("Ugen har ingen opskrifter at eksportere.");
      const data = await exportOpenPlanner(session.env, session.archive, ids, today);
      const name = `open-planner-uge-${isoWeek(monday).week}-${ymdCompact(today)}.json`;
      await session.env.fs.writeText(session.archive.path("eksport", name), JSON.stringify(data, null, 2));
      return { name, n: ids.length };
    },
    onSuccess: (r) => toast(`${r.n} retter er gemt i eksport/${r.name}. Åbn filen i Open Planner for at printe madkort.`),
    onError: (e) => toast(errorText(e), "error"),
  });
  const ro = session.archive.readOnly;
  const p = plan.data;
  const warnings = p?.entries.reduce((n, e) => n + (e.warnings.length ? 1 : 0), 0) ?? 0;

  return (
    <div>
      <div className="page-header">
        <WeekNav monday={monday} today={today} onWeek={onWeek} />
        <div className="row">
          <TextIconButton icon={Copy} onClick={() => copy.mutate()} disabled={ro || copy.isPending}>
            Kopiér sidste uge
          </TextIconButton>
          <TextIconButton icon={ShoppingCart} onClick={() => shop.mutate()} disabled={ro || shop.isPending}>
            Lav indkøbsliste for ugen
          </TextIconButton>
          <TextIconButton icon={Download} onClick={() => exportWeek.mutate()} disabled={exportWeek.isPending}>
            Eksportér ugens retter
          </TextIconButton>
        </div>
      </div>
      {p && (
        <>
          <div className="week-summary">
            <div className="panel">
              <h2>Anslået pris</h2>
              <p>
                <strong>{formatMoney(p.cost.total_minor)}</strong>
                <span className="muted"> for {p.cost.priced} {p.cost.priced === 1 ? "ret" : "retter"} med pris</span>
              </p>
              {p.cost.without_price > 0 && (
                <StatusBadge kind="missing">
                  {p.cost.without_price} {p.cost.without_price === 1 ? "ret" : "retter"} uden pris
                </StatusBadge>
              )}
            </div>
            <div className="panel">
              <h2>Budget for ugen</h2>
              {p.budget.has_budget ? (
                <HBar label="Mad og dagligvarer" value={p.budget.actual_minor} budget={p.budget.budget_minor} max={Math.max(p.budget.actual_minor, p.budget.budget_minor)} />
              ) : (
                <p className="muted small">Der er intet budget for "Mad og dagligvarer". Forbrug i ugen: {formatMoney(p.budget.actual_minor)}.</p>
              )}
            </div>
            <div className="panel">
              <h2>Allergi</h2>
              {warnings ? (
                <StatusBadge kind="allergy">
                  {warnings} {warnings === 1 ? "ret" : "retter"} med advarsel
                </StatusBadge>
              ) : (
                <p className="muted small">Ingen advarsler for ugens retter.</p>
              )}
            </div>
          </div>
          <div className="week-grid" role="list" aria-label={`Madplan for uge ${p.week}`}>
            {p.days.map((day, i) => (
              <div key={day} className={`day${day === today ? " today" : ""}`} role="listitem" aria-label={`${DAY_NAMES[i]} ${formatDate(day)}`}>
                <h3>
                  {DAY_NAMES[i]} <span className="small muted">{compactDate(day)}</span>
                  {day === today && (
                    <>
                      {" "}
                      <StatusBadge kind="today">I dag</StatusBadge>
                    </>
                  )}
                </h3>
                {p.meals.map((meal) => (
                  <div key={meal}>
                    {p.meals.length > 1 && <div className="meal-label">{MEAL_LABELS[meal]}</div>}
                    {p.entries
                      .filter((e) => e.plan_date === day && e.meal === meal)
                      .map((e) => (
                        <Dish key={e.id} dish={e} days={p.days} />
                      ))}
                    <IconButton icon={Plus} label={`Tilføj ${MEAL_LABELS[meal].toLowerCase()} ${DAY_NAMES[i]!.toLowerCase()}`} onClick={() => setAdding({ date: day, meal })} disabled={ro} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {adding && <PlanDialog date={adding.date} meal={adding.meal} onClose={() => setAdding(null)} />}
    </div>
  );
}

function Dish({ dish, days }: { dish: PlannedDish; days: string[] }) {
  const session = useSession();
  const toast = useToast();
  const invalidate = useInvalidateFood();
  const [, setParams] = useSearchParams();
  const ro = session.archive.readOnly;
  const run = (f: () => Promise<unknown>) => f().then(invalidate, (e) => toast(errorText(e), "error"));
  return (
    <div className="dish">
      {dish.recipe_id ? (
        <button className="link" style={{ textAlign: "left" }} onClick={() => setParams({ tab: "recipes", opskrift: String(dish.recipe_id) })}>
          {dish.label}
        </button>
      ) : (
        <span>{dish.label}</span>
      )}
      <span className="small muted">
        {dish.servings ? `${dish.servings} pers.` : ""}
        {dish.cost_minor !== null ? ` · ${formatMoney(dish.cost_minor)}` : ""}
      </span>
      {dish.warnings.map((w) => (
        <StatusBadge key={w.text} kind="allergy" title={w.private ? undefined : `Allergen: ${w.allergen}`}>
          {w.text}
        </StatusBadge>
      ))}
      {!ro && (
        <div className="dish-actions">
          <select
            aria-label={`Flyt ${dish.label} til en anden dag`}
            value={dish.plan_date}
            onChange={(e) => run(() => moveMeal(session.ctx(), dish.id, e.target.value))}
          >
            {days.map((d, i) => (
              <option key={d} value={d}>
                {DAY_NAMES[i]!.slice(0, 3)}. {compactDate(d)}
              </option>
            ))}
          </select>
          <IconButton icon={Trash2} label={`Fjern ${dish.label} fra madplanen`} onClick={() => run(() => removeMeal(session.ctx(), dish.id))} />
        </div>
      )}
    </div>
  );
}

function PlanDialog({ date, meal, recipeId, onClose }: { date: string; meal: Meal; recipeId?: string; onClose(): void }) {
  const session = useSession();
  const toast = useToast();
  const invalidate = useInvalidateFood();
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string | null>(recipeId ?? null);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(date);
  const [servings, setServings] = useState<string>("");
  const recipes = useQuery({ queryKey: ["recipe", "list", q], queryFn: () => listRecipes(session.archive.db, { q }) });
  const settings = useQuery({
    queryKey: ["setting", "food.default_servings"],
    queryFn: async () => String((await foodSettings(session.archive.db)).defaultServings),
  });
  const save = useMutation({
    mutationFn: () =>
      planMeal(session.ctx(), {
        plan_date: day,
        meal,
        recipe_id: chosen,
        title: chosen ? null : title,
        servings: Number(servings || settings.data || 4),
      }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  return (
    <Modal title={`Planlæg ${MEAL_LABELS[meal].toLowerCase()}`} onClose={onClose}>
      <label>
        Dag
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </label>
      <SearchBox value={q} onChange={setQ} placeholder="Søg i opskrifter" />
      <ul className="plain" style={{ maxHeight: "14rem", overflow: "auto", margin: "0.5rem 0" }} aria-label="Opskrifter">
        {(recipes.data ?? []).slice(0, 50).map((r) => (
          <li key={r.id}>
            <label className="inline">
              <input type="radio" name="recipe" checked={chosen === r.id} onChange={() => setChosen(r.id)} /> {r.name}
              {r.allergens.length > 0 && <span className="small muted"> · {r.allergens.map(allergenLabel).join(", ")}</span>}
            </label>
          </li>
        ))}
      </ul>
      <label>
        Eller fri tekst
        <input
          value={title}
          placeholder="Fx Rester"
          onChange={(e) => {
            setTitle(e.target.value);
            if (e.target.value) setChosen(null);
          }}
        />
      </label>
      <label>
        Portioner
        <input inputMode="numeric" className="short" placeholder={settings.data ?? "4"} value={servings} onChange={(e) => setServings(e.target.value)} />
      </label>
      <button className="primary" onClick={() => save.mutate()} disabled={save.isPending || (!chosen && !title.trim())}>
        Planlæg
      </button>
    </Modal>
  );
}

// ---------- Opskrifter ----------

function Recipes() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ["recipe", "list", q, tag], queryFn: () => listRecipes(session.archive.db, { q, tag: tag || undefined }) });
  const tags = useQuery({ queryKey: ["recipe", "tags"], queryFn: () => allRecipeTags(session.archive.db) });
  const selectedId = params.get("opskrift");
  const select = (id: string) => setParams({ tab: "recipes", opskrift: id });
  const empty = list.data?.length === 0 && !q && !tag;
  return (
    <div>
      <div className="row filters">
        <SearchBox value={q} onChange={setQ} placeholder="Søg i opskrifter og ingredienser" />
        <label className="inline-label">
          Tag
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Alle</option>
            {(tags.data ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <TextIconButton icon={Plus} className="primary" onClick={() => setCreating(true)} disabled={session.archive.readOnly}>
          Ny opskrift
        </TextIconButton>
      </div>
      {empty ? (
        <EmptyState module="food" text="Saml familiens retter med ingredienser, priser og allergener." action="Opret din første opskrift" onAction={() => setCreating(true)} disabled={session.archive.readOnly} />
      ) : (
        <div className="split">
          <table className="list">
            <thead>
              <tr>
                <th aria-label="Foto" />
                <th>Navn</th>
                <th>Tags</th>
                <th>Allergener</th>
                <th className="num">Pris</th>
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((r) => (
                <tr key={r.id} {...rowProps(r.id === selectedId, () => select(r.id))}>
                  <td>
                    <RecipeThumb recipe={r} />
                  </td>
                  <td>
                    {r.name}
                    {r.ingredient_count === 0 && (
                      <>
                        {" "}
                        <StatusBadge kind="missing">Ingen ingredienser</StatusBadge>
                      </>
                    )}
                  </td>
                  <td className="small">{r.tags.join(", ")}</td>
                  <td>
                    {r.allergens.length > 0 && (
                      <StatusBadge kind="allergy" title="Allergener (markeret og udledt af ingredienserne)">
                        {r.allergens.map(allergenLabel).join(", ")}
                      </StatusBadge>
                    )}
                  </td>
                  <td className="num">{r.estimated_cost_minor !== null ? formatMoney(Number(r.estimated_cost_minor)) : "–"}</td>
                </tr>
              ))}
              {list.data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Ingen opskrifter matcher.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {selectedId && <RecipeDetail key={selectedId} id={selectedId} />}
        </div>
      )}
      {creating && (
        <Modal title="Ny opskrift" onClose={() => setCreating(false)} wide>
          <NewRecipe
            onSaved={(id) => {
              setCreating(false);
              select(id);
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function RecipeThumb({ recipe }: { recipe: RecipeSummary }) {
  const { env, archive } = useSession();
  const url = useQuery({
    queryKey: ["recipe", "thumb", recipe.photo_document_id ?? null],
    enabled: Boolean(recipe.photo_document_id),
    queryFn: async () => {
      const doc = await getEntity(archive.db, "document", String(recipe.photo_document_id));
      if (!doc) return null;
      const bytes = await env.fs.readFile(archive.path(`bilag/${String(doc.sha256).slice(0, 2)}/${doc.sha256}.${doc.ext}`));
      return URL.createObjectURL(new Blob([bytes.slice()], { type: String(doc.mime) }));
    },
    staleTime: Infinity,
  });
  if (url.data) return <img className="thumb" src={url.data} alt="" />;
  return <span className="thumb" aria-hidden="true" />;
}

function NewRecipe({ onSaved, onCancel }: { onSaved(id: string): void; onCancel(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [servings, setServings] = useState("4");
  const [lines, setLines] = useState("");
  const save = useMutation({
    mutationFn: () => createRecipe(session.ctx(), { name, servings: Number(servings) || 4 }, lines),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["recipe"] });
      onSaved(String(r.id));
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid2">
        <label>
          Navn *
          <input value={name} required onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Portioner
          <input inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} />
        </label>
      </div>
      <label>
        Ingredienser (én pr. linje, fx "500 g hakket oksekød")
        <textarea rows={6} value={lines} onChange={(e) => setLines(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" type="submit" disabled={save.isPending || !name.trim()}>
          Opret
        </button>
        <button type="button" onClick={onCancel}>
          Annullér
        </button>
      </div>
    </form>
  );
}

function RecipeDetail({ id }: { id: string }) {
  const session = useSession();
  const [, setParams] = useSearchParams();
  const [planning, setPlanning] = useState(false);
  const recipe = useQuery({ queryKey: ["recipe", "one", id], queryFn: () => getEntity(session.archive.db, "recipe", id) });
  const r = recipe.data;
  if (!r) return null;
  return (
    <aside className="detail wide-detail" aria-label="Opskrift">
      <div className="header-row">
        <h2>{String(r.name)}</h2>
        <div className="row">
          <TextIconButton icon={CalendarDays} onClick={() => setPlanning(true)} disabled={session.archive.readOnly}>
            Planlæg
          </TextIconButton>
          <ArchiveButton type="recipe" id={id} label="Opskriften" onDone={() => setParams({ tab: "recipes" })} />
        </div>
      </div>
      <Tabs
        tabs={[
          { id: "ing", label: "Ingredienser", content: () => <IngredientEditor recipeId={id} /> },
          {
            id: "info",
            label: "Oplysninger",
            content: () => (
              <>
                <EntityForm type="recipe" row={r} invalidate={[["meal_plan_entry"]]} />
                <TagsEditor recipe={r} />
              </>
            ),
          },
          { id: "allergens", label: "Allergener", content: () => <AllergenEditor recipe={r} /> },
          { id: "photo", label: "Foto", content: () => <PhotoEditor recipe={r} /> },
        ]}
      />
      {planning && <PlanDialog date={session.env.clock.today()} meal="dinner" recipeId={id} onClose={() => setPlanning(false)} />}
    </aside>
  );
}

interface EditRow {
  amount: string;
  unit: string;
  name: string;
  note: string;
}
const toEdit = (i: { amount?: number | null; unit?: string | null; name: string; note?: string | null }): EditRow => ({
  amount: i.amount === null || i.amount === undefined ? "" : String(i.amount).replace(".", ","),
  unit: i.unit ?? "",
  name: i.name,
  note: i.note ?? "",
});

/** Ingredient table with amount, unit, item and note; text lines can be pasted and are parsed (spec 05). */
function IngredientEditor({ recipeId }: { recipeId: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["recipe", "ingredients", recipeId], queryFn: () => recipeIngredients(session.archive.db, recipeId) });
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [paste, setPaste] = useState("");
  const current = rows ?? (q.data ?? []).map(toEdit);
  const set = (i: number, k: keyof EditRow, v: string) => setRows(current.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = useMutation({
    mutationFn: () =>
      updateRecipe(
        session.ctx(),
        recipeId,
        {},
        current
          .filter((r) => r.name.trim())
          .map((r) => ({
            amount: r.amount.trim() ? Number(r.amount.replace(",", ".")) : null,
            unit: r.unit.trim() || null,
            name: r.name,
            note: r.note.trim() || null,
          })),
      ),
    onSuccess: async () => {
      setRows(null);
      toast("Ingredienserne er gemt");
      await qc.invalidateQueries({ queryKey: ["recipe"] });
      await qc.invalidateQueries({ queryKey: ["meal_plan_entry"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const ro = session.archive.readOnly;
  return (
    <div>
      <table className="list compact ingredient-table">
        <thead>
          <tr>
            <th>Mængde</th>
            <th>Enhed</th>
            <th>Vare</th>
            <th>Note</th>
            <th aria-label="Handlinger" />
          </tr>
        </thead>
        <tbody>
          {current.map((r, i) => (
            <tr key={i}>
              <td>
                <input aria-label={`Mængde, række ${i + 1}`} inputMode="decimal" value={r.amount} onChange={(e) => set(i, "amount", e.target.value)} style={{ width: "4.5rem" }} />
              </td>
              <td>
                <input aria-label={`Enhed, række ${i + 1}`} value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} style={{ width: "4rem" }} />
              </td>
              <td>
                <input aria-label={`Vare, række ${i + 1}`} value={r.name} onChange={(e) => set(i, "name", e.target.value)} />
              </td>
              <td>
                <input aria-label={`Note, række ${i + 1}`} value={r.note} onChange={(e) => set(i, "note", e.target.value)} />
              </td>
              <td>
                <IconButton icon={Trash2} label={`Fjern ${r.name || `række ${i + 1}`}`} onClick={() => setRows(current.filter((_, j) => j !== i))} disabled={ro} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ margin: "0.5rem 0" }}>
        <TextIconButton icon={Plus} onClick={() => setRows([...current, { amount: "", unit: "", name: "", note: "" }])} disabled={ro}>
          Tilføj række
        </TextIconButton>
        <button className="primary" onClick={() => save.mutate()} disabled={ro || rows === null || save.isPending}>
          Gem ingredienser
        </button>
      </div>
      <label>
        Indsæt tekstlinjer
        <textarea rows={4} value={paste} placeholder={"500 g hakket oksekød\n2 dl fløde\nSalt og peber"} onChange={(e) => setPaste(e.target.value)} />
      </label>
      <button
        onClick={() => {
          const parsed = paste
            .split(/\r?\n/)
            .map(parseIngredientLine)
            .filter((x) => x !== null);
          setRows([...current, ...parsed.map(toEdit)]);
          setPaste("");
        }}
        disabled={ro || !paste.trim()}
      >
        Fortolk og tilføj
      </button>
      <p className="small muted">Fortolkede linjer lægges i tabellen. Husk at gemme.</p>
    </div>
  );
}

const jsonList = (v: unknown): string[] => {
  try {
    const a: unknown = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};

function TagsEditor({ recipe }: { recipe: Row }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(jsonList(recipe.tags_json).join(", "));
  const save = useMutation({
    mutationFn: () => {
      const tags = [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];
      return updateRecipe(session.ctx(), String(recipe.id), { tags_json: tags.length ? JSON.stringify(tags) : null });
    },
    onSuccess: async () => {
      toast("Tags er gemt");
      await qc.invalidateQueries({ queryKey: ["recipe"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  return (
    <div className="row">
      <label style={{ flex: 1 }}>
        Tags (adskilt med komma)
        <input value={text} placeholder="vegetar, hurtig" onChange={(e) => setText(e.target.value)} />
      </label>
      <button onClick={() => save.mutate()} disabled={session.archive.readOnly}>
        Gem tags
      </button>
    </div>
  );
}

/** Marked allergens (allergens_json) plus the ones derived from the ingredient names. */
function AllergenEditor({ recipe }: { recipe: Row }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const id = String(recipe.id);
  const ings = useQuery({ queryKey: ["recipe", "ingredients", id], queryFn: () => recipeIngredients(session.archive.db, id) });
  const [marked, setMarked] = useState<string[]>(jsonList(recipe.allergens_json));
  const derived = useMemo(() => recipeAllergens(null, (ings.data ?? []).map((i) => String(i.name))).derived, [ings.data]);
  const save = useMutation({
    mutationFn: () => updateRecipe(session.ctx(), id, { allergens_json: marked.length ? JSON.stringify(marked) : null }),
    onSuccess: async () => {
      toast("Allergenerne er gemt");
      await qc.invalidateQueries({ queryKey: ["recipe"] });
      await qc.invalidateQueries({ queryKey: ["meal_plan_entry"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  return (
    <fieldset>
      <legend>Allergener</legend>
      {ALLERGENS.map((a) => (
        <label key={a.key} className="inline">
          <input
            type="checkbox"
            checked={marked.includes(a.key)}
            onChange={(e) => setMarked(e.target.checked ? [...marked, a.key] : marked.filter((k) => k !== a.key))}
          />{" "}
          {a.label}
          {derived.includes(a.key as AllergenKey) && <span className="small muted"> – udledt af ingredienserne</span>}
        </label>
      ))}
      <button className="primary" onClick={() => save.mutate()} disabled={session.archive.readOnly}>
        Gem allergener
      </button>
    </fieldset>
  );
}

function PhotoEditor({ recipe }: { recipe: Row }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const doc = useQuery({
    queryKey: ["recipe", "photo", recipe.photo_document_id ?? null],
    queryFn: () => (recipe.photo_document_id ? getEntity(session.archive.db, "document", String(recipe.photo_document_id)) : null),
  });
  const choose = useMutation({
    mutationFn: async () => {
      const [p] = await pickFiles("Vælg foto af retten", { filterName: "Billeder", extensions: ["jpg", "jpeg", "png"] });
      if (!p) return false;
      const r = await importDocument(session.env, session.archive, session.ctx(), p, { source: "drop", title: String(recipe.name) });
      await updateRecipe(session.ctx(), String(recipe.id), { photo_document_id: String(r.document.id) });
      return true;
    },
    onSuccess: async (changed) => {
      if (changed) await qc.invalidateQueries({ queryKey: ["recipe"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  return (
    <div>
      {doc.data ? <DocumentPreview doc={doc.data} /> : <p className="muted">Ingen foto.</p>}
      <button onClick={() => choose.mutate()} disabled={session.archive.readOnly}>
        {doc.data ? "Skift foto" : "Vælg foto"}
      </button>
    </div>
  );
}

// ---------- Indkøbsliste ----------

function Shopping({ monday, today, onWeek }: { monday: string; today: string; onWeek(d: string): void }) {
  const session = useSession();
  const toast = useToast();
  const invalidate = useInvalidateFood();
  const [name, setName] = useState("");
  const [includeChecked, setIncludeChecked] = useState(false);
  const data = useQuery({
    queryKey: ["shopping", monday],
    queryFn: async () => {
      const list = await listForWeek(session.archive.db, monday);
      return { list, items: list ? await shoppingItems(session.archive.db, String(list.id)) : [] };
    },
  });
  const run = (f: () => Promise<unknown>) => f().then(invalidate, (e) => toast(errorText(e), "error"));
  const ro = session.archive.readOnly;
  const list = data.data?.list;
  const items = data.data?.items ?? [];

  async function copyText() {
    const text = shoppingListText(items, { includeChecked });
    try {
      await navigator.clipboard.writeText(text);
      toast("Indkøbslisten er kopieret");
    } catch {
      window.prompt("Kopiér teksten:", text);
    }
  }

  return (
    <div>
      <div className="page-header">
        <WeekNav monday={monday} today={today} onWeek={onWeek} />
        <div className="row">
          <TextIconButton icon={ShoppingCart} onClick={() => run(() => generateShoppingList(session.ctx(), monday))} disabled={ro}>
            {list ? "Opdatér fra madplanen" : "Lav indkøbsliste for ugen"}
          </TextIconButton>
          <TextIconButton icon={Copy} onClick={copyText} disabled={!items.length}>
            Kopiér som tekst
          </TextIconButton>
        </div>
      </div>
      {!list ? (
        <EmptyState
          module="food"
          text="Indkøbslisten laves ud fra ugens madplan. Ingredienserne lægges sammen og sorteres efter butiksafdeling."
          action="Lav indkøbsliste for ugen"
          onAction={() => run(() => generateShoppingList(session.ctx(), monday))}
          disabled={ro}
        />
      ) : (
        <>
          <h2>{String(list.name)}</h2>
          <label className="inline small">
            <input type="checkbox" checked={includeChecked} onChange={(e) => setIncludeChecked(e.target.checked)} /> Tag afkrydsede varer med, når listen kopieres
          </label>
          {groupBySection(items).map((g) => (
            <div key={g.category} className="shop-group">
              <h3>{g.category}</h3>
              {g.items.map((i) => {
                const label = formatShoppingItem({ name: String(i.name), amount: i.amount as number | null, unit: i.unit as string | null });
                return (
                  <div key={String(i.id)} className={`shop-item${i.checked ? " checked" : ""}`}>
                    <input type="checkbox" aria-label={`Købt: ${label}`} checked={Boolean(i.checked)} disabled={ro} onChange={(e) => run(() => setItemChecked(session.ctx(), String(i.id), e.target.checked))} />
                    <span className="shop-name">
                      {label}
                      {i.source === "manual" && <span className="small muted"> · tilføjet manuelt</span>}
                    </span>
                    <select aria-label={`Afdeling for ${String(i.name)}`} value={String(i.category ?? "Andet")} disabled={ro} onChange={(e) => run(() => setItemCategory(session.ctx(), String(i.id), e.target.value))}>
                      {SHOP_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <IconButton icon={Trash2} label={`Slet ${String(i.name)}`} disabled={ro} onClick={() => run(() => removeShoppingItem(session.ctx(), String(i.id)))} />
                  </div>
                );
              })}
            </div>
          ))}
          <form
            className="row"
            style={{ marginTop: "1rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = parseIngredientLine(name);
              if (!parsed) return;
              void run(() => addShoppingItem(session.ctx(), String(list.id), parsed)).then(() => setName(""));
            }}
          >
            <label style={{ flex: 1, marginBottom: 0 }}>
              Tilføj vare
              <input value={name} placeholder="Fx 1 l mælk eller toiletpapir" onChange={(e) => setName(e.target.value)} />
            </label>
            <TextIconButton icon={Plus} type="submit" disabled={ro || !name.trim()}>
              Tilføj
            </TextIconButton>
          </form>
        </>
      )}
    </div>
  );
}

// ---------- Open Planner import ----------

function ImportDialog({ onClose }: { onClose(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<{ data: OpenPlannerDatabase; preview: OpenPlannerPreview; file: string } | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function choose() {
    setError(null);
    try {
      const [p] = await pickFiles("Vælg Open Planner-database", { filterName: "Open Planner (JSON)", extensions: ["json"] });
      if (!p) return;
      const data = parseOpenPlanner(await session.env.fs.readFile(p));
      setState({ data, preview: await previewOpenPlanner(session.archive.db, data), file: session.env.fs.basename(p) });
      setSkip([]);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const run = useMutation({
    mutationFn: () => importOpenPlanner(session.env, session.archive, session.ctx(), state!.data, { skip }),
    onSuccess: async (r) => {
      toast(`Import: ${r.created} nye, ${r.updated} opdateret, ${r.unchanged} uændrede${r.skipped ? `, ${r.skipped} fravalgt` : ""}`);
      await qc.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  const changed = state?.preview.dishes.filter((d) => d.status === "changed") ?? [];
  const CHANGE_LABEL = { name: "navn", instructions: "fremgangsmåde", ingredients: "ingredienser", photo: "foto" } as const;
  return (
    <Modal title="Importér fra Open Planner" onClose={onClose} wide>
      <p className="small muted">Vælg en Open Planner-database (JSON, version 1 eller 2). Retter, der allerede findes, kobles via deres id.</p>
      <button onClick={choose}>Vælg fil…</button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state && (
        <>
          <h3>{state.file}</h3>
          <p>
            <strong>{state.preview.counts.new}</strong> nye, <strong>{state.preview.counts.changed}</strong> ændrede, <strong>{state.preview.counts.unchanged}</strong> uændrede
          </p>
          {state.preview.messages.map((m) => (
            <p key={m} className="small">
              {m}
            </p>
          ))}
          {changed.length > 0 && (
            <fieldset>
              <legend>Ændrede retter (fravælg for at beholde dine egne ændringer)</legend>
              {changed.map((d) => (
                <label key={d.id} className="inline">
                  <input type="checkbox" checked={!skip.includes(d.id)} onChange={(e) => setSkip(e.target.checked ? skip.filter((x) => x !== d.id) : [...skip, d.id])} /> {d.name}
                  <span className="small muted"> – {d.changes.map((c) => CHANGE_LABEL[c]).join(", ")}</span>
                </label>
              ))}
            </fieldset>
          )}
          <button className="primary" onClick={() => run.mutate()} disabled={run.isPending || (state.preview.counts.new === 0 && changed.length === skip.length)}>
            Importér
          </button>
        </>
      )}
    </Modal>
  );
}

