/**
 * Renders every page of the real app shell against a real (Node) archive and checks the
 * visual-style rules that can be tested in the DOM (spec 04 "Visuel stil", 07 fase 2b nr. 9):
 * icon-only buttons have aria-label and tooltip, charts have a text summary, decorative
 * icons are hidden, and the meal plan shows warnings and the dashboard today's dish.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDays,
  createArchive,
  createEntity,
  createRecipe,
  createTask,
  createUser,
  timelineEvents,
  importDocument,
  linkDocument,
  updateEntity,
  generateShoppingList,
  makeCtx,
  planMeal,
  runTool,
  type Archive,
  type Env,
  type PublicUser,
} from "@ppm/core";
import { localDate } from "@ppm/core";
import { nodeEnv } from "@ppm/core/node";

vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
const picked = vi.hoisted(() => ({ files: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => (cmd === "pick_files" ? picked.files.splice(0) : []) }));

import { SessionContext, type Session } from "../src/app/session";
import { Shell } from "../src/layout/Shell";
import { MODULES } from "../src/lib/modules";
import { attachPending } from "../src/components/Attachments";

let env: Env;
let archive: Archive;
let user: PublicUser;
let itemId = "";
let photoPath = "";
const TODAY = "2026-11-24";
const photoPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeAll(async () => {
  const now = new Date(`${TODAY}T10:00:00.000Z`);
  env = nodeEnv({ clock: { nowIso: () => now.toISOString(), today: () => localDate(now), now: () => new Date(now) } });
  archive = await createArchive(env, join(mkdtempSync(join(tmpdir(), "ppm-ui-")), "arkiv"), { appVersion: "test" });
  const ctx = makeCtx(env, archive.db, null, "ui");
  const { user: u } = await createUser(ctx, { name: "Anne", isAdmin: true });
  user = { id: String(u.id), name: "Anne", is_admin: 1, has_pin: false };
  const ida = await createEntity(ctx, "person", { name: "Ida" });
  await createEntity(ctx, "health_allergy", { person_id: String(ida.id), substance: "Rejer" });
  const shrimp = await createRecipe(ctx, { name: "Rejer med ris", estimated_cost_minor: 9000 }, ["300 g rejer", "250 g ris"]);
  const soup = await createRecipe(ctx, { name: "Tomatsuppe" }, ["1 dåse hakkede tomater", "1 løg"]);
  await planMeal(ctx, { plan_date: TODAY, recipe_id: String(soup.id) });
  await planMeal(ctx, { plan_date: addDays(TODAY, 1), recipe_id: String(shrimp.id) });
  await generateShoppingList(ctx, TODAY);
  const dishwasher = await createEntity(ctx, "item", { name: "Opvaskemaskine", purchase_price_minor: 499900 });
  itemId = String(dishwasher.id);
  photoPath = join(mkdtempSync(join(tmpdir(), "ppm-ui-photo-")), "opvasker.png");
  writeFileSync(photoPath, Buffer.from(photoPngBase64, "base64"));
  // A draft group from the MCP side (only ai_draft is written).
  await runTool({ env, archive, clientName: "test" }, "propose", {
    rationale: "Ny støvsuger fra kvittering",
    ops: [
      { op: "create", type: "item", data: { name: "Robotstøvsuger", purchase_price_minor: 249900 } },
      { op: "create", type: "contact", data: { name: "Elbutikken", kind: "shop" } },
    ],
  });
});

afterEach(cleanup);

function sessionFor(): Session {
  return {
    env,
    info: { pid: 1, hostname: "test", appVersion: "test", configPath: "/tmp/x", oneDriveEnv: [] },
    archive,
    user,
    ctx: () => makeCtx(env, archive.db, user.id, "ui"),
    logout: () => undefined,
    closeArchive: async () => undefined,
    restoreFrom: async () => undefined,
  };
}

function renderAt(path: string) {
  const session: Session = {
    env,
    info: { pid: 1, hostname: "test", appVersion: "test", configPath: "/tmp/x", oneDriveEnv: [] },
    archive,
    user,
    ctx: () => makeCtx(env, archive.db, user.id, "ui"),
    logout: () => undefined,
    closeArchive: async () => undefined,
    restoreFrom: async () => undefined,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Shell />
        </MemoryRouter>
      </QueryClientProvider>
    </SessionContext.Provider>,
  );
}

/** Every button needs an accessible name; buttons without visible text need aria-label and title. */
function checkButtons(container: HTMLElement, where: string) {
  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.length, where).toBeGreaterThan(0);
  for (const b of buttons) {
    const text = (b.textContent ?? "").trim();
    const desc = `${where}: <button class="${b.className}">${b.innerHTML.slice(0, 80)}`;
    if (!text) {
      expect(b.getAttribute("aria-label"), desc).toBeTruthy();
      expect(b.getAttribute("title"), desc).toBeTruthy();
    }
  }
  for (const svg of container.querySelectorAll("svg")) {
    // lucide icons are decorative; charts carry role=img and a summary.
    if (svg.getAttribute("role") === "img") expect(svg.getAttribute("aria-label"), `${where}: chart`).toBeTruthy();
    // An interactive chart (the timeline) exposes each event as a labelled button instead.
    else if (svg.querySelector('[role="button"]')) for (const b of svg.querySelectorAll('[role="button"]')) expect(b.getAttribute("aria-label"), `${where}: chart event`).toBeTruthy();
    else expect(svg.closest('[aria-hidden="true"]') ?? (svg.getAttribute("aria-hidden") === "true" ? svg : null), `${where}: svg ${svg.outerHTML.slice(0, 80)}`).not.toBeNull();
  }
}

async function settle(heading: string) {
  await screen.findByRole("heading", { level: 1, name: heading });
  // Let queries resolve.
  await new Promise((r) => setTimeout(r, 150));
}

describe("phase 2b.9 – rendered components", () => {
  it.each(MODULES.map((m) => [m.label, m.to] as const))("%s: icons in menu and header, icon-only buttons are labelled", async (label, to) => {
    const { container } = renderAt(to);
    await settle(label);
    // Menu: every entry has its module icon (decorative) and text.
    const nav = screen.getByRole("navigation", { name: "Hovedmenu" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/\d+$/, "").trim())).toEqual(MODULES.map((m) => m.label));
    for (const l of links) expect(l.querySelector('.module-icon[aria-hidden="true"] svg')).not.toBeNull();
    // Page header: module icon next to the h1.
    const h1 = screen.getByRole("heading", { level: 1, name: label });
    expect(h1.parentElement?.querySelector(".module-icon svg")).not.toBeNull();
    checkButtons(container, label);
  });

  it("meal plan: week with allergy warning, recipes and shopping list tabs", async () => {
    const { container } = renderAt("/madplan");
    await settle("Madplan");
    expect(await screen.findByText("Rejer (Ida)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forrige uge" })).toHaveAttribute("title", "Forrige uge");
    expect(screen.getByText(/Uge 48, 2026/)).toBeInTheDocument();
    checkButtons(container, "Madplan/Uge");

    fireEvent.click(screen.getByRole("tab", { name: "Opskrifter" }));
    fireEvent.click(await screen.findByText("Rejer med ris"));
    expect(await screen.findByRole("complementary", { name: "Opskrift" })).toBeInTheDocument();
    await screen.findByDisplayValue("rejer");
    checkButtons(container, "Madplan/Opskrifter");

    fireEvent.click(screen.getByRole("tab", { name: "Indkøbsliste" }));
    expect(await screen.findByText("Indkøb uge 48")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Kød og fisk" })).toBeInTheDocument();
    checkButtons(container, "Madplan/Indkøbsliste");
  });

  it("dashboard: key figure cards, 6-month chart and today's/tomorrow's dish", async () => {
    renderAt("/");
    await settle("Overblik");
    for (const name of [/^Forfaldne: \d+$/, /^Næste 30 dage: \d+$/, /^Udløber snart: \d+$/, /^Mangler oplysninger: \d+$/]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("img", { name: /^Forbrug de seneste 6 måneder: jun .* nov / })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Tomatsuppe")).toBeInTheDocument());
    expect(screen.getByText("Rejer med ris")).toBeInTheDocument();
    expect(screen.getByText("Rejer (Ida)")).toBeInTheDocument();
  });

  it("AI inbox: shows the draft group and approves all through core", async () => {
    const { container } = renderAt("/ai");
    await settle("AI-indbakke");
    const group = await screen.findByRole("region", { name: "Forslag: Ny støvsuger fra kvittering" });
    expect(within(group).getByText(/1\. Opret genstand: Robotstøvsuger/)).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Redigér operation 1" })).toHaveAttribute("title");
    checkButtons(container, "AI-indbakke");
    fireEvent.click(within(group).getByRole("button", { name: "Godkend alle" }));
    await waitFor(async () => expect(await archive.db.select("SELECT id FROM item WHERE name = 'Robotstøvsuger'")).toHaveLength(1));
    const audit = await archive.db.select<{ via: string }>("SELECT a.via FROM audit_log a JOIN item i ON i.id = a.entity_id WHERE i.name = 'Robotstøvsuger'");
    expect(audit[0]?.via).toBe("ai_draft");
  });

  it("settings: AI access with modules, channels and the access log", async () => {
    renderAt("/indstillinger");
    await settle("Indstillinger");
    expect(await screen.findByRole("heading", { name: "AI-adgang" })).toBeInTheDocument();
    const modules = screen.getByRole("group", { name: "Moduler, AI må læse" });
    expect(within(modules).getByRole("checkbox", { name: /Helbred/ })).not.toBeChecked();
    expect(within(modules).getByRole("checkbox", { name: /Madplan/ })).toBeChecked();
    expect(screen.getByText(/plugin install ppm@ppm/)).toBeInTheDocument();
    expect(screen.getByText("codex mcp add ppm -- ppm-mcp")).toBeInTheDocument();
    expect(await screen.findByText("propose")).toBeInTheDocument();
  });

  it("photos: new item offers photos and receipt; chosen files are linked after saving and shown as thumbnails", async () => {
    const session = sessionFor();
    const r = await attachPending(session, "item", itemId, [{ path: photoPath, role: "photo" }]);
    expect(r).toEqual({ linked: 1, errors: [] });
    const { container } = renderAt(`/bolig?id=${itemId}`);
    await settle("Bolig og inventar");
    expect(await screen.findByRole("button", { name: /^Vis foto: opvasker/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flere fotos…" })).toBeInTheDocument();
    checkButtons(container, "Genstand med foto");
    fireEvent.click(screen.getAllByRole("button", { name: "Ny genstand" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Ny genstand" });
    expect(within(dialog).getByRole("button", { name: "Tilføj fotos…" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Tilføj kvittering…" })).toBeInTheDocument();
    // The fieldset sits inside the form, above the Opret button.
    expect(within(dialog).getByRole("group", { name: "Fotos og kvittering" }).closest("form")).not.toBeNull();
  });

  it("dropdowns: category from an editable list with '+ Tilføj ny…', and '+ Ny rum…' creates a location and selects it", async () => {
    renderAt("/bolig");
    await settle("Bolig og inventar");
    fireEvent.click(screen.getAllByRole("button", { name: "Ny genstand" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Ny genstand" });
    const category = within(dialog).getByLabelText("Kategori") as HTMLSelectElement;
    await waitFor(() => expect([...category.options].map((o) => o.textContent)).toContain("Hvidevarer"));
    expect([...category.options].at(-1)?.textContent).toBe("+ Tilføj ny…");
    fireEvent.change(category, { target: { value: "__new__" } });
    fireEvent.change(within(dialog).getByPlaceholderText("Ny værdi"), { target: { value: "Smarthome" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tilføj" }));
    await waitFor(() => expect((within(dialog).getByLabelText("Kategori") as HTMLSelectElement).value).toBe("Smarthome"));

    const placement = within(dialog).getByLabelText("Placering") as HTMLSelectElement;
    expect([...placement.options].at(-1)?.textContent).toBe("+ Ny rum…");
    fireEvent.change(placement, { target: { value: "__new__" } });
    const newRoom = await screen.findByRole("dialog", { name: "Ny rum" });
    expect(within(newRoom).getByLabelText(/Bolig/)).toBeInTheDocument();
  });

  it("Lister: tabs for the records and value lists behind the dropdowns", async () => {
    const { container } = renderAt("/lister?liste=item_category");
    await settle("Lister");
    for (const t of ["Rum og placeringer", "Boliger", "Kontakter", "Personer", "Konti", "Økonomikategorier", "Genstandskategorier", "Bygningsdelstyper"]) {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    }
    expect(await screen.findByRole("button", { name: "Omdøb Hvidevarer" })).toHaveAttribute("title", "Omdøb Hvidevarer");
    checkButtons(container, "Lister");
    fireEvent.click(screen.getByRole("tab", { name: "Økonomikategorier" }));
    expect(await screen.findByText("Mad og dagligvarer")).toBeInTheDocument();
  });

  it("pets: tab under Bolig og inventar, opened from the URL", async () => {
    const { container } = renderAt("/bolig?tab=pets");
    await settle("Bolig og inventar");
    expect(screen.getByRole("tab", { name: "Husdyr", selected: true })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Opret dit første husdyr" })).toBeInTheDocument();
    checkButtons(container, "Husdyr");
    fireEvent.click(screen.getByRole("button", { name: "Nyt husdyr" }));
    const dialog = await screen.findByRole("dialog", { name: "Nyt husdyr" });
    for (const f of ["Navn", "Art", "Race", "Chipnummer", "Ejer", "Dyrlæge"]) expect(within(dialog).getByLabelText(new RegExp(f))).toBeInTheDocument();
  });

  it("empty states show the module icon, a sentence and the primary action", async () => {
    renderAt("/bil");
    await settle("Bil");
    const btn = await screen.findByRole("button", { name: "Opret din første bil" });
    const box = btn.closest(".empty-state")!;
    expect(box.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(box.querySelector("p")?.textContent).toMatch(/servicebog/);
  });

  it("insurance list: covered persons as round initials; persons can be toggled on the coverage tab", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const pol = await createEntity(ctx, "policy", { kind: "accident", title: "Ulykkesforsikring" });
    const bo = await createEntity(ctx, "person", { name: "Bo Testesen" });
    await createEntity(ctx, "policy_coverage", { policy_id: String(pol.id), target_type: "person", target_id: String(bo.id) });
    const { container } = renderAt(`/forsikring?id=${String(pol.id)}`);
    await settle("Forsikring");
    const row = (await screen.findByText("Ulykkesforsikring", { selector: ".text" })).closest("tr")!;
    expect(within(row).getByRole("img", { name: "Bo Testesen" }).textContent).toBe("BT");
    const group = await screen.findByRole("group", { name: "Dækkede personer" });
    expect(within(group).getByRole("button", { name: /Bo Testesen/ })).toHaveAttribute("aria-pressed", "true");
    const ida = within(group).getByRole("button", { name: /Ida/ });
    expect(ida).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(ida);
    await waitFor(() => expect(within(row).getByRole("img", { name: "Ida" })).toBeInTheDocument());
    checkButtons(container, "Forsikring");
  });

  it("finance: overview with income/expense chart and food budget; recurring expenses have priority and can be archived", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const acc = await createEntity(ctx, "account", { name: "Budgetkonto" });
    const [food] = await archive.db.select<{ id: string }>("SELECT id FROM category WHERE name = 'Mad og dagligvarer'");
    await createEntity(ctx, "bank_transaction", { account_id: String(acc.id), booking_date: "2026-10-03", text: "Netto", amount_minor: -123400, category_id: food!.id, dedupe_hash: "ui1" });
    await createEntity(ctx, "recurring_expense", { name: "Streamingtjeneste", amount_minor: 12900, period: "month", priority: 1 });
    const { container } = renderAt("/okonomi");
    await settle("Økonomi");
    expect(screen.getByRole("tab", { name: "Overblik", selected: true })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /^Indtægter og udgifter.*Udgifter: .*okt 1\.234,00/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Madbudget" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sæt madbudget pr. måned"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(await screen.findByRole("img", { name: /Budget: .*nov 5\.000,00/ })).toBeInTheDocument();
    checkButtons(container, "Økonomi overblik");

    fireEvent.click(screen.getByRole("tab", { name: "Faste udgifter" }));
    const row = (await screen.findByText("Streamingtjeneste", { selector: "td" })).closest("tr")!;
    expect(within(row).getByText("Kan undværes")).toBeInTheDocument();
    expect(screen.getByText(/Udgifter med prioritet 1–2/)).toBeInTheDocument();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(within(row).getByRole("button", { name: "Arkivér Streamingtjeneste" }));
    await waitFor(() => expect(screen.queryByText("Streamingtjeneste", { selector: "td" })).toBeNull());
    checkButtons(container, "Faste udgifter");
  });

  it("loans tab (migration 0006): list with totals, opened from the URL, with documents; contacts in Lister have a Bilag tab", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    await createEntity(ctx, "contact", { name: "Testkontakt", kind: "bank" });
    const loan = await createEntity(ctx, "loan", { name: "Testlån", kind: "bank", balance_minor: 10000000, payment_minor: 300000, interest_rate: 5.5 });
    const { container } = renderAt(`/okonomi?tab=loans&loan=${String(loan.id)}`);
    await settle("Økonomi");
    expect(screen.getByRole("tab", { name: "Lån", selected: true })).toBeInTheDocument();
    const row = (await screen.findByText("Testlån", { selector: "td" })).closest("tr")!;
    expect(within(row).getByText("Banklån")).toBeInTheDocument();
    expect(within(row).getByText("5,5 %")).toBeInTheDocument();
    const detail = await screen.findByRole("complementary", { name: "Lån" });
    expect(within(detail).getByRole("tab", { name: "Bilag" })).toBeInTheDocument();
    checkButtons(container, "Lån");
    cleanup();
    renderAt("/lister?liste=contact");
    await settle("Lister");
    fireEvent.click(await screen.findByText("Testkontakt", { selector: "td" }));
    expect(await screen.findByRole("tab", { name: "Bilag" })).toBeInTheDocument();
  });

  it("phase 4.2: category suggestions are shown on Posteringer and accepted all at once", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const acc = await createEntity(ctx, "account", { name: "Forslagskonto" });
    const [fun] = await archive.db.select<{ id: string }>("SELECT id FROM category WHERE name = 'Fritid'");
    let n = 0;
    const tx = (text: string, cat: string | null) =>
      createEntity(ctx, "bank_transaction", { account_id: String(acc.id), booking_date: TODAY, text, amount_minor: -9900, category_id: cat, dedupe_hash: `sg${n++}` });
    await tx("Biografen Nord 111", fun!.id);
    await tx("Biografen Nord 222", fun!.id);
    await tx("Biografen Nord 333", null);
    const { container } = renderAt("/okonomi?tab=tx");
    await settle("Økonomi");
    const region = await screen.findByRole("region", { name: "Forslag til kategorier" });
    fireEvent.click(within(region).getByRole("button", { name: "Vis forslag" }));
    expect(within(region).getByText("Biografen Nord 333")).toBeInTheDocument();
    expect(within(region).getByText("som 2 tidligere posteringer")).toBeInTheDocument();
    checkButtons(container, "Forslag");
    fireEvent.click(within(region).getByRole("button", { name: "Godkend alle" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Forslag til kategorier" })).toBeNull());
    const [row] = await archive.db.select<{ category_id: string; category_source: string }>("SELECT category_id, category_source FROM bank_transaction WHERE text = 'Biografen Nord 333'");
    expect(row).toEqual({ category_id: fun!.id, category_source: "user" });
  });

  it("phase 4.1: the import wizard recognises a bank by its headers and marks the preset as not verified", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    await createEntity(ctx, "account", { name: "Lønkonto Test" });
    picked.files = [join(__dirname, "../../../fixtures/bank/arbejdernes-landsbank-eksempel.csv")];
    const { container } = renderAt("/okonomi?tab=import");
    await settle("Økonomi");
    const account = await screen.findByRole("combobox", { name: "Konto" });
    const opt = within(account).getByRole("option", { name: "Lønkonto Test" }) as HTMLOptionElement;
    fireEvent.change(account, { target: { value: opt.value } });
    fireEvent.click(screen.getByRole("button", { name: "Vælg CSV-fil…" }));
    expect(await screen.findByRole("radio", { name: "Arbejdernes Landsbank" })).toBeChecked();
    expect(screen.getByText("Ikke verificeret")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vis forhåndsvisning" }));
    expect(await screen.findByText(/nye posteringer/)).toBeInTheDocument();
    expect(screen.getByText("-3.125,00 kr.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ret opsætningen" }));
    expect(screen.getByRole("combobox", { name: "Beløb står i" })).toHaveValue("split");
    expect(screen.getByRole("combobox", { name: "Ud (udbetaling)" })).toHaveValue("2");
    checkButtons(container, "Import");
  });

  it("phase 4.4: an item with a receipt that has text shows a banner; confirming fills price, date and vendor", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const item = await createEntity(ctx, "item", { name: "Kaffemaskine" });
    const png = join(mkdtempSync(join(tmpdir(), "ppm-ui-rc-")), "bon.png");
    writeFileSync(png, Buffer.concat([Buffer.from(photoPngBase64, "base64"), Buffer.from("rc")]));
    const { document } = await importDocument(env, archive, ctx, png, { source: "drop" });
    await updateEntity(ctx, "document", String(document.id), { extracted_text: "Kaffehuset\n01.09.2026\nKaffemaskine 1.899,00\nI alt 1.899,00\nMoms 379,80" });
    await linkDocument(ctx, { document_id: String(document.id), target_type: "item", target_id: String(item.id), role: "receipt" });
    const { container } = renderAt(`/bolig?id=${String(item.id)}`);
    await settle("Bolig og inventar");
    const banner = await screen.findByRole("region", { name: "Forslag fra kvittering" });
    expect(banner.textContent).toMatch(/købspris 1\.899,00 kr\., købsdato 01\.09\.2026, forhandler Kaffehuset/);
    checkButtons(container, "Kvitteringsforslag");
    fireEvent.click(within(banner).getByRole("button", { name: "Gennemse og udfyld…" }));
    const dialog = await screen.findByRole("dialog", { name: "Udfyld fra kvittering" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Udfyld forhandler" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Udfyld valgte" }));
    await waitFor(async () =>
      expect((await archive.db.select("SELECT purchase_price_minor, purchase_date, vendor_name FROM item WHERE id = ?", [String(item.id)]))[0]).toEqual({
        purchase_price_minor: 189900,
        purchase_date: "2026-09-01",
        vendor_name: null,
      }),
    );
  });

  it("phase 4.6: the onboarding guide opens from Indstillinger, maps answers to suggestions and creates the chosen tasks", async () => {
    const { container } = renderAt("/indstillinger");
    await settle("Indstillinger");
    fireEvent.click(screen.getByRole("button", { name: "Åbn opstartsguiden" }));
    const dialog = await screen.findByRole("dialog", { name: "Opstartsguide" });
    fireEvent.change(within(dialog).getByLabelText("Hvor bor I?"), { target: { value: "apartment" } });
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Ejer eller lejer I boligen?" })).getByLabelText("Lejer"));
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Har I brændeovn?" })).getByLabelText("Ja"));
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Har I bil?" })).getByLabelText("Ja"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Vis forslag" }));
    const list = within(dialog).getByRole("list", { name: "Foreslåede opgaver" });
    expect(within(list).getByLabelText("Skorstensfejning af brændeovn")).toBeChecked();
    expect(within(list).queryByLabelText("Rens tagrender")).toBeNull(); // renting an apartment
    expect(within(list).getByLabelText("Rens gulvafløb")).not.toBeChecked();
    for (const t of ["Skift til sommerdæk", "Skift til vinterdæk", "Service af bil"]) fireEvent.click(within(list).getByLabelText(t));
    checkButtons(container, "Opstartsguide");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Opret \d+ opgaver$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Opstartsguide" })).toBeNull());
    const rows = await archive.db.select<{ template_id: string }>("SELECT template_id FROM task WHERE source = 'template' ORDER BY template_id");
    expect(rows.map((r) => r.template_id)).toEqual(expect.arrayContaining(["home.wood_stove.check", "home.wood_stove.sweep", "home.smoke_alarm.test", "insurance.review", "vehicle.inspection"]));
    expect(rows.map((r) => r.template_id)).not.toContain("vehicle.tires.summer");
  });

  it("calendar: month grid with week numbers and today's events; the day panel links to the record", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    await createTask(ctx, { title: "Kalendertest rens filter", module: "maintenance", firstDueDate: TODAY });
    const { container } = renderAt("/kalender");
    await settle("Kalender");
    expect(screen.getByRole("tab", { name: "Månedsvisning", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "november 2026" })).toBeInTheDocument();
    const cell = container.querySelector(`[data-day="${TODAY}"]`)!;
    await waitFor(() => expect(cell.textContent).toContain("Kalendertest rens filter"));
    expect(cell.getAttribute("aria-label")).toMatch(/begivenhed/);
    const panel = screen.getByRole("complementary", { name: /Begivenheder 24\.11\.2026/ });
    expect(within(panel).getByText("Kalendertest rens filter")).toBeInTheDocument();
    checkButtons(container, "Kalender");
    // Kinds can be switched off.
    fireEvent.click(screen.getByRole("button", { name: "Opgaver", pressed: true }));
    await waitFor(() => expect(cell.textContent).not.toContain("Kalendertest rens filter"));
    fireEvent.click(screen.getByRole("button", { name: "Opgaver", pressed: false }));
    await waitFor(() => expect(cell.textContent).toContain("Kalendertest rens filter"));
    fireEvent.click(within(panel).getByText("Kalendertest rens filter"));
    await screen.findByRole("heading", { level: 1, name: "Opgaver" });
  });

  it("timeline: lanes per kind, events as labelled buttons, zoom presets change the range", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    await createEntity(ctx, "policy", { kind: "travel", title: "Rejseforsikring tidslinje", renewal_date: addDays(TODAY, 20) });
    const { container } = renderAt("/kalender?visning=timeline");
    await settle("Kalender");
    const ev = await screen.findByRole("button", { name: /^Fornyelse: Rejseforsikring tidslinje, 14\.12\.2026/ });
    expect(ev.querySelector("circle")).not.toBeNull();
    expect(container.querySelector(".tl-lane-label")?.textContent).toMatch(/i visningen/);
    const range = () => container.querySelector(".tl-range")!.textContent;
    const before = range();
    fireEvent.click(screen.getByRole("button", { name: "Uge" }));
    await waitFor(() => expect(range()).not.toBe(before));
    fireEvent.click(screen.getByRole("button", { name: /Vis som liste/ }));
    expect(screen.getAllByRole("button", { name: /Fornyelse: Rejseforsikring tidslinje/ })).toHaveLength(2); // in the chart and in the list
    checkButtons(container, "Tidslinje");
  });

  it("lending: lend a thing to a free name, see it in the list and on the calendar, mark it as returned", async () => {
    const { container } = renderAt("/bolig?tab=lending");
    await settle("Bolig og inventar");
    fireEvent.click(await screen.findByRole("button", { name: "Lån noget ud" }));
    const dialog = await screen.findByRole("dialog", { name: "Lån noget ud" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrér udlån" }));
    expect(await within(dialog).findByText(/Vælg en genstand/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Eller beskriv tingen"), { target: { value: "Stige 4 m" } });
    fireEvent.change(within(dialog).getByLabelText(/^Eller lånerens navn/), { target: { value: "Naboen" } });
    fireEvent.change(within(dialog).getByLabelText("Afleveres senest"), { target: { value: addDays(TODAY, 7) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrér udlån" }));
    const row = (await screen.findByText("Stige 4 m", { selector: ".text" })).closest("tr")!;
    expect(within(row).getByText("Naboen")).toBeInTheDocument();
    checkButtons(container, "Udlån");
    const ev = await timelineEvents(archive.db, { from: TODAY, to: addDays(TODAY, 30), kinds: ["lending"], today: TODAY, userId: user.id });
    expect(ev.map((e) => e.title)).toContain("Stige 4 m lånt ud til Naboen");
    fireEvent.click(within(row).getByRole("button", { name: "Markér Stige 4 m som afleveret" }));
    await waitFor(() => expect(screen.queryByText("Stige 4 m", { selector: ".text" })).toBeNull());
  });

  it("'+ Ny kontakt…' on an item's vendor creates and selects the contact without saving the item form", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const item = await createEntity(ctx, "item", { name: "Harddisk-beslag" });
    renderAt(`/bolig?id=${String(item.id)}`);
    await settle("Bolig og inventar");
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    const vendor = within(detail).getByLabelText("Forhandler (kontakt)") as HTMLSelectElement;
    fireEvent.change(vendor, { target: { value: "__new__" } });
    const dialog = await screen.findByRole("dialog", { name: "Ny kontakt" });
    fireEvent.change(within(dialog).getByLabelText(/^Navn/), { target: { value: "Netbutik Eksempel" } });
    fireEvent.change(within(dialog).getByLabelText(/^Type/), { target: { value: "shop" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Opret|Gem/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ny kontakt" })).toBeNull());
    const [c] = await archive.db.select<{ id: string }>("SELECT id FROM contact WHERE name = 'Netbutik Eksempel'");
    expect(c).toBeTruthy();
    await waitFor(() => expect((within(detail).getByLabelText("Forhandler (kontakt)") as HTMLSelectElement).value).toBe(c!.id));
    // The item itself is saved only when the user saves the form (the dialog's submit must not bubble).
    expect((await archive.db.select("SELECT vendor_contact_id FROM item WHERE id = ?", [String(item.id)]))[0]).toEqual({ vendor_contact_id: null });
    expect(await archive.db.select("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'item' AND entity_id = ? AND action = 'update'", [String(item.id)])).toEqual([{ n: 0 }]);
    fireEvent.click(within(detail).getByRole("button", { name: "Gem" }));
    await waitFor(async () => expect((await archive.db.select("SELECT vendor_contact_id FROM item WHERE id = ?", [String(item.id)]))[0]).toEqual({ vendor_contact_id: c!.id }));
  });

  it("Lister: a person can be created (the form has fields)", async () => {
    renderAt("/lister?liste=person");
    await settle("Lister");
    fireEvent.click(await screen.findByRole("button", { name: "Ny person" }));
    const dialog = await screen.findByRole("dialog", { name: "Ny person" });
    fireEvent.change(within(dialog).getByLabelText(/^Navn/), { target: { value: "Noah Eksempel" } });
    fireEvent.change(within(dialog).getByLabelText(/^Relation/), { target: { value: "barn" } });
    fireEvent.change(within(dialog).getByLabelText(/^Fødselsår/), { target: { value: "2016" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opret" }));
    await waitFor(async () => expect(await archive.db.select("SELECT relation, birth_year FROM person WHERE name = 'Noah Eksempel'")).toEqual([{ relation: "barn", birth_year: 2016 }]));
  });

  it("documents: images get a preview and the Koblinger column names the linked records", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const item = await createEntity(ctx, "item", { name: "Koblingstest-lampe" });
    const png = join(mkdtempSync(join(tmpdir(), "ppm-ui-dl-")), "lampe.png");
    writeFileSync(png, Buffer.concat([Buffer.from(photoPngBase64, "base64"), Buffer.from("dl")]));
    const { document } = await importDocument(env, archive, ctx, png, { source: "drop" });
    await linkDocument(ctx, { document_id: String(document.id), target_type: "item", target_id: String(item.id), role: "photo" });
    const { container } = renderAt("/dokumenter");
    await settle("Dokumenter");
    const chip = await screen.findByRole("button", { name: /Genstand: Koblingstest-lampe/ });
    const row = chip.closest("tr")!;
    expect(row.querySelector(".row-thumb")).not.toBeNull();
    checkButtons(container, "Dokumenter");
    fireEvent.click(chip);
    await screen.findByRole("heading", { level: 1, name: "Bolig og inventar" });
  });
});

