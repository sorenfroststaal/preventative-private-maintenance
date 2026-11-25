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
  createUser,
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
    const row = (await screen.findByText("Ulykkesforsikring", { selector: "td" })).closest("tr")!;
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
});

