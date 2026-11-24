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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDays,
  createArchive,
  createEntity,
  createRecipe,
  createUser,
  generateShoppingList,
  makeCtx,
  planMeal,
  type Archive,
  type Env,
  type PublicUser,
} from "@ppm/core";
import { localDate } from "@ppm/core";
import { nodeEnv } from "@ppm/core/node";

vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));

import { SessionContext, type Session } from "../src/app/session";
import { Shell } from "../src/layout/Shell";
import { MODULES } from "../src/lib/modules";

let env: Env;
let archive: Archive;
let user: PublicUser;
const TODAY = "2026-11-24";

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
  await createEntity(ctx, "item", { name: "Opvaskemaskine", purchase_price_minor: 499900 });
});

afterEach(cleanup);

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
    expect(links.map((l) => l.textContent?.trim())).toEqual(MODULES.map((m) => m.label));
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

  it("empty states show the module icon, a sentence and the primary action", async () => {
    renderAt("/bil");
    await settle("Bil");
    const btn = await screen.findByRole("button", { name: "Opret din første bil" });
    const box = btn.closest(".empty-state")!;
    expect(box.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(box.querySelector("p")?.textContent).toMatch(/servicebog/);
  });
});
