/**
 * Renders every page of the real app shell against a real (Node) archive and checks the
 * visual-style rules that can be tested in the DOM (spec 04 "Visuel stil", 07 fase 2b nr. 9):
 * icon-only buttons have aria-label and tooltip, charts have a text summary, decorative
 * icons are hidden, and the meal plan shows warnings and the dashboard today's dish.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "../src/app/queryClient";
let lastQueryClient: QueryClient;
import { MemoryRouter } from "react-router-dom";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDays,
  createArchive,
  createEntity,
  disposeItems,
  createRecipe,
  createGift,
  createOutsidePerson,
  setSetting,
  createTask,
  createPairingCode,
  createUser,
  redeemPairingCode,
  personLinks,
  setPersonLinks,
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
const picked = vi.hoisted(() => ({ files: [] as string[], mobile: null as null | Record<string, unknown>, network: null as null | string, calls: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    picked.calls.push(cmd);
    if (cmd === "pick_files") return picked.files.splice(0);
    if (cmd === "mobile_status") return picked.mobile;
    if (cmd === "mobile_network") return { addresses: [], network: picked.network };
    return [];
  },
}));

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
  const qc = createQueryClient();
  lastQueryClient = qc;
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

  it("dropdowns: category from an editable list with '+ Tilføj ny…', and '+ Nyt rum…' creates a location and selects it", async () => {
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
    expect([...placement.options].at(-1)?.textContent).toBe("+ Nyt rum…");
    fireEvent.change(placement, { target: { value: "__new__" } });
    const newRoom = await screen.findByRole("dialog", { name: "Nyt rum" });
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

  it("Nyt rum: the only property is chosen, 'Del af' lists only rooms in that property and is optional", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const props = await archive.db.select<{ id: string }>("SELECT id FROM property WHERE archived_at IS NULL");
    for (const p of props) await archive.db.execute("UPDATE property SET archived_at = 'x' WHERE id = ?", [p.id]);
    const house = await createEntity(ctx, "property", { name: "Rumtest-hus", kind: "house" });
    await createEntity(ctx, "location", { property_id: String(house.id), name: "Rumtest-køkken" });
    renderAt("/lister?liste=location");
    await settle("Lister");
    fireEvent.click(await screen.findByRole("button", { name: "Nyt rum" }));
    const dialog = await screen.findByRole("dialog", { name: "Nyt rum" });
    await waitFor(() => expect((within(dialog).getByLabelText(/^Bolig/) as HTMLSelectElement).value).toBe(String(house.id)));
    const parent = within(dialog).getByLabelText(/^Del af/) as HTMLSelectElement;
    await waitFor(() => expect([...parent.options].map((o) => o.textContent)).toEqual(["– vælg –", "Rumtest-køkken"]));
    fireEvent.change(within(dialog).getByLabelText(/^Navn/), { target: { value: "Rumtest-skab" } });
    fireEvent.change(parent, { target: { value: parent.options[1]!.value } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Opret" }));
    await waitFor(async () => expect(await archive.db.select("SELECT l.name, p.name AS parent FROM location l JOIN location p ON p.id = l.parent_id WHERE l.name = 'Rumtest-skab'")).toEqual([{ name: "Rumtest-skab", parent: "Rumtest-køkken" }]));
    for (const p of props) await archive.db.execute("UPDATE property SET archived_at = NULL WHERE id = ?", [p.id]);
  });

  it("items: several owners can be chosen; the list can be filtered by person and shows the owner's initials", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const owner = await createEntity(ctx, "person", { name: "Ejer Testesen" });
    const other = await createEntity(ctx, "person", { name: "Anden Ejer" });
    const bike = await createEntity(ctx, "item", { name: "Ejertest-cykel" });
    await setPersonLinks(ctx, "item", String(bike.id), [String(owner.id)]);
    renderAt("/bolig");
    await settle("Bolig og inventar");
    const filter = (await screen.findByLabelText("Ejer")) as HTMLSelectElement;
    await waitFor(() => expect([...filter.options].map((o) => o.textContent)).toContain("Ejer Testesen"));
    fireEvent.change(filter, { target: { value: String(owner.id) } });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByRole("img", { name: "Ejer Testesen" }).textContent).toBe("ET");
    fireEvent.click(within(rows[0]!).getByText("Ejertest-cykel"));
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    const group = await within(detail).findByRole("group", { name: "Ejere" });
    await waitFor(() => expect(within(group).getByRole("button", { name: /Ejer Testesen/ })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(within(group).getByRole("button", { name: /Anden Ejer/ }));
    await waitFor(async () => expect((await personLinks(archive.db, "item")).get(String(bike.id))?.map((p) => p.id).sort()).toEqual([String(owner.id), String(other.id)].sort()));
  });

  it("recurring expense: several persons can be chosen in the dialog; the list filters by person", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const a = await createEntity(ctx, "person", { name: "Udgift Person A" });
    const b = await createEntity(ctx, "person", { name: "Udgift Person B" });
    renderAt("/okonomi?tab=recurring");
    await settle("Økonomi");
    fireEvent.click(await screen.findByRole("button", { name: "Ny fast udgift" }));
    const dialog = await screen.findByRole("dialog", { name: "Ny fast udgift" });
    fireEvent.change(within(dialog).getByLabelText(/^Navn/), { target: { value: "Familie-streaming" } });
    fireEvent.change(within(dialog).getByLabelText(/^Beløb \*/), { target: { value: "129" } });
    const group = await within(dialog).findByRole("group", { name: "Personer, udgiften hører til" });
    fireEvent.click(within(group).getByRole("button", { name: /Udgift Person A/ }));
    fireEvent.click(within(group).getByRole("button", { name: /Udgift Person B/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Opret" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ny fast udgift" })).toBeNull());
    const [rec] = await archive.db.select<{ id: string }>("SELECT id FROM recurring_expense WHERE name = 'Familie-streaming'");
    expect((await personLinks(archive.db, "recurring_expense")).get(rec!.id)?.map((p) => p.id).sort()).toEqual([String(a.id), String(b.id)].sort());
    const row = (await screen.findByText("Familie-streaming")).closest("tr")!;
    expect(row.textContent).toContain("Udgift Person A, Udgift Person B");
  });

  it("Indstillinger → Mobil (iPhone): QR codes for certificate and app, a pairing code, and paired phones that can be removed", async () => {
    picked.mobile = { ready: true, addresses: ["192.168.1.20"], httpsPort: 4730, httpPort: 4731, caFingerprint: "AA:BB" };
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const { code } = await createPairingCode(ctx);
    await redeemPairingCode(ctx, code, "Annas iPhone");
    const { container } = renderAt("/indstillinger");
    await settle("Indstillinger");
    expect(await screen.findByRole("img", { name: /certifikat: http:\/\/192\.168\.1\.20:4731\// })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /QR-kode til PPM: https:\/\/192\.168\.1\.20:4730\// })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Parr en telefon" }));
    const shown = await screen.findByLabelText(/^Parringskode /);
    expect(shown.textContent).toMatch(/^[A-Z2-9]{3} [A-Z2-9]{3}$/);
    expect(await screen.findByText("Annas iPhone")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mobiladgang er slået til/ })).toBeInTheDocument();
    checkButtons(container, "Mobil");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(within(screen.getByText("Annas iPhone").closest("li")!).getByRole("button", { name: "Fjern" }));
    await waitFor(() => expect(screen.queryByText("Annas iPhone")).toBeNull());
    picked.mobile = null;
  });
  it("gifts: a gift to a person outside the household is registered, listed and summed; outside persons are not offered as owners", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const friend = await createOutsidePerson(ctx, "Gavetest Ven", "ven");
    await createGift(ctx, { person_id: String(friend.id), title: "Gavetest-bog", occasion: "Jul", gift_date: "2026-12-24", amount_minor: 19900 });
    renderAt("/bolig?tab=gifts");
    await settle("Bolig og inventar");
    const row = (await screen.findByText("Gavetest-bog")).closest("tr")!;
    expect(within(row).getByText(/Gavetest Ven/)).toBeTruthy();
    expect(within(row).getByText("Jul")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Pr. person/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Registrér gave" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrér gave" });
    const who = within(dialog).getByLabelText(/^Person/) as HTMLSelectElement;
    await waitFor(() => expect([...who.options].map((o) => o.textContent)).toContain("Gavetest Ven"));
    fireEvent.change(who, { target: { value: String(friend.id) } });
    fireEvent.change(within(dialog).getByLabelText(/^Gave/), { target: { value: "Gavetest-vin" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Gem gave" }));
    await waitFor(async () => expect(await archive.db.select("SELECT direction, title FROM gift WHERE title = 'Gavetest-vin'")).toEqual([{ direction: "given", title: "Gavetest-vin" }]));
    cleanup();
    // The owner picker on an item only offers the household.
    const bike = await createEntity(ctx, "item", { name: "Gavetest-cykel" });
    renderAt(`/bolig?id=${String(bike.id)}`);
    await settle("Bolig og inventar");
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    const group = await within(detail).findByRole("group", { name: "Ejere" });
    expect(within(group).queryByRole("button", { name: /Gavetest Ven/ })).toBeNull();
  });
  it("errors: a failed load and an unhandled failed save show an error toast instead of an empty page (review D1)", async () => {
    renderAt("/bolig");
    await settle("Bolig og inventar");
    await lastQueryClient.fetchQuery({ queryKey: ["d1-test"], queryFn: () => Promise.reject(new Error("Databasen er låst")) }).catch(() => undefined);
    expect(await screen.findByText("Kunne ikke hente data: Databasen er låst")).toBeTruthy();
    // A failed list on the page leaves a banner (not only a toast that disappears).
    const items = lastQueryClient.getQueryCache().find({ queryKey: ["item", "list"] })!;
    items.setState({ status: "error", error: new Error("x"), data: undefined });
    expect(await screen.findByText(/Noget kunne ikke hentes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prøv igen" }));
    await waitFor(() => expect(screen.queryByText(/Noget kunne ikke hentes/)).toBeNull());
    const m = lastQueryClient.getMutationCache().build(lastQueryClient, { mutationFn: () => Promise.reject(new Error("Disken er fuld")) });
    await m.execute(undefined).catch(() => undefined);
    expect(await screen.findByText("Kunne ikke gemme: Disken er fuld")).toBeTruthy();
    // A mutation with its own onError is not reported twice.
    const own = lastQueryClient.getMutationCache().build(lastQueryClient, { mutationFn: () => Promise.reject(new Error("Egen fejl")), onError: () => undefined });
    await own.execute(undefined).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Egen fejl/)).toBeNull();
  });
  it("C5: archiving an item and removing an attachment ask first; cancelling keeps them", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const item = await createEntity(ctx, "item", { name: "C5-lampe" });
    const tmp = join(mkdtempSync(join(tmpdir(), "ppm-c5-")), "kvittering.pdf");
    writeFileSync(tmp, "%PDF-1.4 c5");
    const { document } = await importDocument(env, archive, ctx, tmp, { source: "drop" });
    await linkDocument(ctx, { document_id: String(document.id), target_type: "item", target_id: String(item.id), role: "receipt" });
    renderAt(`/bolig?id=${String(item.id)}`);
    await settle("Bolig og inventar");
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(detail).getByRole("button", { name: "Arkivér …" }));
    let dialog = await screen.findByRole("dialog", { name: "Arkivér genstanden" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Annullér" }));
    expect(await archive.db.select("SELECT archived_at FROM item WHERE id = ?", [String(item.id)])).toEqual([{ archived_at: null }]);
    fireEvent.click(within(detail).getByRole("tab", { name: "Bilag" }));
    fireEvent.click(await within(detail).findByRole("button", { name: /^Fjern kvittering/ }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/Fjern bilaget/));
    expect((await archive.db.select("SELECT count(*) AS n FROM document_link WHERE target_id = ?", [String(item.id)]))[0]).toEqual({ n: 1 });
    fireEvent.click(within(detail).getByRole("button", { name: "Arkivér …" }));
    dialog = await screen.findByRole("dialog", { name: "Arkivér genstanden" });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Smidt ud/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Arkivér" }));
    await waitFor(async () => expect((await archive.db.select<{ archived_at: string | null; disposal_kind: string | null }>("SELECT archived_at, disposal_kind FROM item WHERE id = ?", [String(item.id)]))[0]).toMatchObject({ disposal_kind: "discarded" }));
    cleanup();
    // Removing what a policy covers asks first too.
    const policy = await createEntity(ctx, "policy", { title: "C5-police", kind: "home_contents", premium_period: "year" });
    const bike = await createEntity(ctx, "item", { name: "C5-cykel" });
    await createEntity(ctx, "policy_coverage", { policy_id: String(policy.id), target_type: "item", target_id: String(bike.id) });
    renderAt(`/forsikring?id=${String(policy.id)}`);
    await settle("Forsikring");
    confirm.mockReturnValue(false);
    fireEvent.click(await screen.findByRole("button", { name: "Fjern C5-cykel fra policen" }));
    expect(confirm).toHaveBeenLastCalledWith('Fjern "C5-cykel" fra policen?');
    expect((await archive.db.select("SELECT count(*) AS n FROM policy_coverage WHERE policy_id = ?", [String(policy.id)]))[0]).toEqual({ n: 1 });
    confirm.mockRestore();
  });
  it("archive reasons: an item is sold with a price, found in Arkiv, restored, and only Slet helt removes it", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const item = await createEntity(ctx, "item", { name: "Arkiv-cykel" });
    const id = String(item.id);
    renderAt(`/bolig?id=${id}`);
    await settle("Bolig og inventar");
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    fireEvent.click(within(detail).getByRole("button", { name: "Arkivér …" }));
    const dialog = await screen.findByRole("dialog", { name: "Arkivér genstanden" });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Solgt/ }));
    fireEvent.change(within(dialog).getByLabelText("Pris"), { target: { value: "1.250" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Arkivér" }));
    await waitFor(async () =>
      expect((await archive.db.select("SELECT disposal_kind, disposal_price_minor FROM item WHERE id = ?", [id]))[0]).toEqual({ disposal_kind: "sold", disposal_price_minor: 125000 }),
    );
    cleanup();

    renderAt("/bolig?tab=archive");
    await settle("Bolig og inventar");
    const table = await screen.findByRole("table", { name: "Arkiverede genstande" });
    fireEvent.click(await within(table).findByText("Arkiv-cykel"));
    let aside = await screen.findByRole("complementary", { name: "Arkiveret genstand" });
    expect(aside.textContent).toContain("Solgt");
    expect(aside.textContent).toMatch(/1\.250/);
    fireEvent.click(within(aside).getByRole("button", { name: "Gendan" }));
    await waitFor(async () => expect((await archive.db.select("SELECT archived_at, disposal_kind FROM item WHERE id = ?", [id]))[0]).toEqual({ archived_at: null, disposal_kind: null }));

    // Archive again without a reason, then delete it for good from Arkiv (requires typing "slet").
    await disposeItems(ctx, [id], { kind: null });
    cleanup();
    renderAt("/bolig?tab=archive");
    await settle("Bolig og inventar");
    fireEvent.click(await within(await screen.findByRole("table", { name: "Arkiverede genstande" })).findByText("Arkiv-cykel"));
    aside = await screen.findByRole("complementary", { name: "Arkiveret genstand" });
    fireEvent.click(within(aside).getByRole("button", { name: "Slet helt …" }));
    const del = await screen.findByRole("dialog", { name: 'Arkivér "Arkiv-cykel"' });
    const go = within(del).getByRole("button", { name: "Slet helt" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(del).getByLabelText("Bekræft sletning"), { target: { value: "slet" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(async () => expect((await archive.db.select("SELECT count(*) AS n FROM item WHERE id = ?", [id]))[0]).toEqual({ n: 0 }));
  });
  it("C1: persons and finance categories are created in one place (Lister); Settings links there", async () => {
    renderAt("/indstillinger");
    await settle("Indstillinger");
    expect(screen.queryByRole("button", { name: "Tilføj person" })).toBeNull();
    expect(screen.getByRole("link", { name: "Lister → Personer" }).getAttribute("href")).toContain("liste=person");
    expect(screen.getByRole("link", { name: "Lister → Økonomikategorier" }).getAttribute("href")).toContain("liste=category");
    expect(screen.queryByText("Ny kategori")).toBeNull();
  });
  it("E2: mobile access does not start by itself on another network and the panel says why", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    await setSetting(ctx, "mobile.enabled", true);
    await setSetting(ctx, "mobile.networks", ["router:aa:bb:cc:dd:ee:ff"]);
    picked.network = "router:11:22:33:44:55:66";
    picked.calls.length = 0;
    renderAt("/indstillinger");
    await settle("Indstillinger");
    expect(await screen.findByText(/blev ikke startet automatisk/)).toBeInTheDocument();
    expect(picked.calls).toContain("mobile_network");
    expect(picked.calls).not.toContain("mobile_start");
    cleanup();
    // On the remembered network it starts.
    picked.network = "router:aa:bb:cc:dd:ee:ff";
    picked.calls.length = 0;
    renderAt("/indstillinger");
    await settle("Indstillinger");
    await waitFor(() => expect(picked.calls).toContain("mobile_start"));
    await setSetting(ctx, "mobile.enabled", false);
    picked.network = null;
  });
  it("B2: the vehicle's monthly total counts a recurring expense with the loan's amount once and keeps one that only shares the name", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const car = await createEntity(ctx, "vehicle", { name: "B2-bil" });
    await createEntity(ctx, "loan", { name: "B2-bil", kind: "car", payment_minor: 250000, vehicle_id: String(car.id) });
    await createEntity(ctx, "recurring_expense", { name: "Afdrag", amount_minor: 250000, period: "month", vehicle_id: String(car.id) });
    await createEntity(ctx, "recurring_expense", { name: "B2-bil forsikring", amount_minor: 60000, period: "month", vehicle_id: String(car.id) });
    renderAt(`/bil?id=${String(car.id)}&tab=cost`);
    await settle("Bil");
    const total = await screen.findByText(/I alt pr. måned/);
    await waitFor(() => expect(total.textContent?.replace(/\s/g, " ")).toMatch(/3\.100,00/));
    expect(screen.getByText(/samme beløb som lånet B2-bil; tælles kun én gang/)).toBeInTheDocument();
    expect(screen.getByText(/ligner lånet B2-bil/)).toBeInTheDocument();
  });
  it("components: an accessory and a spare part nest under an item, the tree expands with +, and a spare part is used in a repair", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const house = await createEntity(ctx, "property", { name: "Komptest-hus", kind: "house" });
    const room = await createEntity(ctx, "location", { property_id: String(house.id), name: "Komptest-værksted" });
    const printer = await createEntity(ctx, "item", { name: "Komptest-printer", location_id: String(room.id) });
    await createEntity(ctx, "item", { name: "Komptest-hotend", parent_item_id: String(printer.id), component_role: "accessory" });
    const wo = await createEntity(ctx, "work_order", { title: "Komptest-reparation", kind: "repair", target_type: "item", target_id: String(printer.id), reported_date: "2026-11-20" });

    renderAt(`/bolig?id=${String(printer.id)}&tab=components`);
    await settle("Bolig og inventar");
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    expect(await within(detail).findByText("Komptest-hotend")).toBeInTheDocument();
    expect(within(detail).getByRole("heading", { name: /^Tilbehør/ })).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "Tilføj komponent" }));
    const dialog = await screen.findByRole("dialog", { name: /Ny komponent til Komptest-printer/ });
    fireEvent.change(within(dialog).getByLabelText(/^Navn/), { target: { value: "Komptest-termistor" } });
    fireEvent.change(within(dialog).getByLabelText(/^Antal/), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tilføj" }));
    await waitFor(async () =>
      expect(await archive.db.select("SELECT component_role, quantity, stock_status, location_id FROM item WHERE name = 'Komptest-termistor'")).toEqual([
        { component_role: "spare_part", quantity: 3, stock_status: "in_stock", location_id: String(room.id) },
      ]),
    );
    const line = (await within(detail).findByText("Komptest-termistor")).closest("li")!;
    fireEvent.click(within(line).getByRole("button", { name: "Brug …" }));
    const use = await screen.findByRole("dialog", { name: "Brug Komptest-termistor" });
    fireEvent.change(within(use).getByLabelText(/^Antal/), { target: { value: "1" } });
    const woSelect = within(use).getByLabelText(/arbejdsordre/) as HTMLSelectElement;
    await waitFor(() => expect([...woSelect.options].map((o) => o.value)).toContain(String(wo.id)));
    fireEvent.change(woSelect, { target: { value: String(wo.id) } });
    fireEvent.click(within(use).getByRole("button", { name: "Registrér som brugt" }));
    await waitFor(async () =>
      expect(await archive.db.select("SELECT quantity, stock_status, used_work_order_id FROM item WHERE name = 'Komptest-termistor' ORDER BY stock_status")).toEqual([
        { quantity: 2, stock_status: "in_stock", used_work_order_id: null },
        { quantity: 1, stock_status: "used", used_work_order_id: String(wo.id) },
      ]),
    );
    cleanup();

    // The tree: house › workshop › printer, expanded with + to show its components.
    renderAt("/bolig");
    await settle("Bolig og inventar");
    fireEvent.click(screen.getByRole("button", { name: "Træ" }));
    fireEvent.change(await screen.findByLabelText(/Gruppér efter/), { target: { value: "location" } });
    const tree = await screen.findByRole("tree");
    expect(await within(tree).findByText("Komptest-printer")).toBeInTheDocument();
    expect(within(tree).queryByText("Komptest-hotend")).toBeNull();
    fireEvent.click(within(tree).getByRole("button", { name: "Fold ud: Komptest-printer" }));
    expect(await within(tree).findByText("Komptest-hotend")).toBeInTheDocument();
    expect(within(tree).getAllByText("Komptest-termistor").length).toBeGreaterThan(0);
    try {
      localStorage.removeItem("ppm.items.view");
    } catch {
      // ignore
    }
  });
  it("expired complaint period: shown on the item in the list and among an item's components", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const today = env.clock.today();
    const parent = await createEntity(ctx, "item", { name: "Udløbstest-printer" });
    await createEntity(ctx, "item", { name: "Udløbstest-hotend", parent_item_id: String(parent.id), component_role: "accessory", complaint_until: addDays(today, -10) });
    await createEntity(ctx, "item", { name: "Udløbstest-dyse", parent_item_id: String(parent.id), component_role: "accessory", complaint_until: addDays(today, 100) });
    renderAt(`/bolig?id=${String(parent.id)}&tab=components`);
    await settle("Bolig og inventar");
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    const expired = (await within(detail).findByText("Udløbstest-hotend")).closest("li")!;
    expect(within(expired).getByText("Reklamationsret udløbet")).toBeInTheDocument();
    const fresh = within(detail).getByText("Udløbstest-dyse").closest("li")!;
    expect(within(fresh).queryByText("Reklamationsret udløbet")).toBeNull();
  });
  it("warranty: 5 years from the purchase date in one click; the item shows time left and 'Meld fejl' creates a work order", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const today = env.clock.today();
    const ice = await createEntity(ctx, "item", { name: "Garantitest-ismaskine", purchase_date: today, complaint_until: addDays(today, 30) });
    renderAt(`/bolig?id=${String(ice.id)}`);
    await settle("Bolig og inventar");
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    fireEvent.click(within(detail).getByRole("button", { name: "5 år" }));
    const warranty = within(detail).getByLabelText(/^Garanti til/) as HTMLInputElement;
    expect(warranty.value).toBe(addDays(today, 0).replace(/^(\d{4})/, (y) => String(Number(y) + 5)));
    fireEvent.click(within(detail).getByRole("button", { name: /^Gem/ }));
    await waitFor(async () => expect((await archive.db.select<{ warranty_until: string }>("SELECT warranty_until FROM item WHERE id = ?", [String(ice.id)]))[0]!.warranty_until).toBe(warranty.value));
    expect(await within(detail).findByText(/30 dage tilbage/)).toBeInTheDocument();
    expect(within(detail).getByText(/ca\. 5 år tilbage|ca\. 4 år tilbage/)).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "Meld fejl …" }));
    const dialog = await screen.findByRole("dialog", { name: "Meld fejl på Garantitest-ismaskine" });
    expect((within(dialog).getByLabelText(/^Titel/) as HTMLInputElement).value).toBe("Fejl på Garantitest-ismaskine");
    expect((within(dialog).getByLabelText(/^Beskrivelse/) as HTMLTextAreaElement).value).toMatch(/Reklamationsret til .* inden fristen/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Opret" }));
    await waitFor(async () =>
      expect(await archive.db.select("SELECT kind, target_type, target_id FROM work_order WHERE title = 'Fejl på Garantitest-ismaskine'")).toEqual([{ kind: "repair", target_type: "item", target_id: String(ice.id) }]),
    );
  });

  it("tree: dragging an item onto a room moves it, onto another item makes it a component, and it can be undone; component groups collapse", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const house = await createEntity(ctx, "property", { name: "Trækhus", kind: "house" });
    const a = await createEntity(ctx, "location", { property_id: String(house.id), name: "Træk-bryggers" });
    const b = await createEntity(ctx, "location", { property_id: String(house.id), name: "Træk-kontor" });
    const washer = await createEntity(ctx, "item", { name: "Træk-vaskemaskine", location_id: String(a.id) });
    const hose = await createEntity(ctx, "item", { name: "Træk-slange", location_id: String(a.id) });
    renderAt("/bolig");
    await settle("Bolig og inventar");
    fireEvent.click(screen.getByRole("button", { name: "Træ" }));
    fireEvent.change(await screen.findByLabelText(/Gruppér efter/), { target: { value: "location" } });
    const tree = await screen.findByRole("tree");
    const rowOf = async (text: string) => (await within(tree).findByText(text)).closest(".tree-row")!;
    const dt = { data: {} as Record<string, string>, setData(k: string, v: string) { this.data[k] = v; }, getData(k: string) { return this.data[k]; }, dropEffect: "", effectAllowed: "" };
    // Hose → the office.
    fireEvent.dragStart(await rowOf("Træk-slange"), { dataTransfer: dt });
    await screen.findByText(/Slip her for at gøre Træk-slange til en hovedgenstand/);
    fireEvent.dragOver(await rowOf("Træk-kontor"), { dataTransfer: dt });
    fireEvent.drop(await rowOf("Træk-kontor"), { dataTransfer: dt });
    await waitFor(async () => expect((await archive.db.select<{ location_id: string }>("SELECT location_id FROM item WHERE id = ?", [String(hose.id)]))[0]!.location_id).toBe(String(b.id)));
    expect(await screen.findByText(/Træk-slange er flyttet til Træk-kontor/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fortryd" }));
    await waitFor(async () => expect((await archive.db.select<{ location_id: string }>("SELECT location_id FROM item WHERE id = ?", [String(hose.id)]))[0]!.location_id).toBe(String(a.id)));
    // Hose → onto the washing machine: becomes its component.
    await waitFor(() => expect(screen.getByRole("tree").textContent).toMatch(/Træk-bryggers 2/));
    fireEvent.dragStart(await rowOf("Træk-slange"), { dataTransfer: dt });
    await screen.findByText(/Slip her for at gøre Træk-slange til en hovedgenstand/);
    fireEvent.dragOver(await rowOf("Træk-vaskemaskine"), { dataTransfer: dt });
    fireEvent.drop(await rowOf("Træk-vaskemaskine"), { dataTransfer: dt });
    await waitFor(async () => expect(await archive.db.select("SELECT parent_item_id, component_role FROM item WHERE id = ?", [String(hose.id)])).toEqual([{ parent_item_id: String(washer.id), component_role: "part" }]));
    cleanup();
    // The component groups on the item collapse.
    renderAt(`/bolig?id=${String(washer.id)}&tab=components`);
    await settle("Bolig og inventar");
    const detail = await screen.findByRole("complementary", { name: "Genstand" });
    const toggle = await within(detail).findByRole("button", { name: /Indbyggede dele/ });
    expect(within(detail).getByText("Træk-slange")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(detail).queryByText("Træk-slange")).toBeNull();
    try {
      localStorage.removeItem("ppm.items.view");
    } catch {
      // ignore
    }
  });
  it("multi-select: choose several items (checkbox and Shift-click), move them to a room, set a role and undo; drag a selection in the tree", async () => {
    const ctx = makeCtx(env, archive.db, user.id, "ui");
    const house = await createEntity(ctx, "property", { name: "Multihus", kind: "house" });
    const shed = await createEntity(ctx, "location", { property_id: String(house.id), name: "Multi-skur" });
    const box = await createEntity(ctx, "item", { name: "Multi-kasse", location_id: String(shed.id) });
    const ids: string[] = [];
    for (const n of ["Multi-A", "Multi-B", "Multi-C"]) ids.push(String((await createEntity(ctx, "item", { name: n })).id));
    renderAt("/bolig");
    await settle("Bolig og inventar");
    fireEvent.click(screen.getByRole("button", { name: "Liste" }));
    fireEvent.change(screen.getByPlaceholderText("Søg i genstande"), { target: { value: "Multi-" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Vælg Multi-A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Vælg Multi-C" }), { shiftKey: true });
    const bar = await screen.findByRole("toolbar", { name: "Handlinger for valgte genstande" });
    expect(within(bar).getByText("3 valgt")).toBeInTheDocument();
    const where = within(bar).getByLabelText("Flyt til placering") as HTMLSelectElement;
    await waitFor(() => expect([...where.options].map((o) => o.value)).toContain(String(shed.id)));
    fireEvent.change(where, { target: { value: String(shed.id) } });
    const locs = async () => (await archive.db.select<{ location_id: string | null }>(`SELECT location_id FROM item WHERE id IN (?, ?, ?)`, ids)).map((r) => r.location_id);
    await waitFor(async () => expect(await locs()).toEqual([String(shed.id), String(shed.id), String(shed.id)]));
    fireEvent.click(await within(bar).findByRole("button", { name: "Fortryd" }));
    await waitFor(async () => expect(await locs()).toEqual([null, null, null]));
    fireEvent.change(within(bar).getByLabelText("Rolle"), { target: { value: "spare_part" } });
    await waitFor(async () => expect((await archive.db.select<{ r: string }>(`SELECT component_role AS r FROM item WHERE id IN (?, ?, ?)`, ids)).map((x) => x.r)).toEqual(["spare_part", "spare_part", "spare_part"]));
    // In the tree, dragging one of the chosen items moves all of them.
    fireEvent.click(screen.getByRole("button", { name: "Træ" }));
    fireEvent.change(await screen.findByLabelText(/Gruppér efter/), { target: { value: "location" } });
    const tree = await screen.findByRole("tree");
    const rowOf = async (t: string) => (await within(tree).findByText(t)).closest(".tree-row")!;
    const dt = { data: {} as Record<string, string>, setData(k: string, v: string) { this.data[k] = v; }, getData(k: string) { return this.data[k]; }, dropEffect: "", effectAllowed: "" };
    fireEvent.dragStart(await rowOf("Multi-B"), { dataTransfer: dt });
    await screen.findByText(/Slip her for at gøre 3 genstande til en hovedgenstand/);
    fireEvent.dragOver(await rowOf("Multi-kasse"), { dataTransfer: dt });
    fireEvent.drop(await rowOf("Multi-kasse"), { dataTransfer: dt });
    await waitFor(async () => expect((await archive.db.select<{ p: string }>(`SELECT parent_item_id AS p FROM item WHERE id IN (?, ?, ?)`, ids)).map((x) => x.p)).toEqual([String(box.id), String(box.id), String(box.id)]));
    try {
      localStorage.removeItem("ppm.items.view");
    } catch {
      // ignore
    }
  });
});

