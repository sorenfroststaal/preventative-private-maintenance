import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULES } from "../src/lib/modules";

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");
function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}
const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const darkBlock = css.slice(darkStart, css.indexOf("}", css.indexOf(":root {", darkStart)));
const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };

/** Text/foreground on surface pairs that occur in the UI. */
const PAIRS: [string, string][] = [
  ["--text", "--bg"],
  ["--text", "--surface"],
  ["--text", "--selected"],
  ["--text", "--warning-bg"],
  ["--muted", "--bg"],
  ["--muted", "--surface"],
  ["--accent", "--surface"],
  ["--accent", "--selected"],
  ["--accent-text", "--accent"],
  ["--danger", "--surface"],
  ["--danger", "--bg"],
  ["--danger", "--warning-bg"],
];

describe("phase 2b.9 – contrast of at least 4.5:1 in light and dark theme", () => {
  for (const [name, theme] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it(`${name}: text pairs and module colour tokens`, () => {
      const pairs: [string, string][] = [...PAIRS, ...MODULES.map((m) => ["--c-on", m.token] as [string, string])];
      for (const [fg, bg] of pairs) {
        expect(theme[fg], `${name} ${fg}`).toBeTruthy();
        expect(theme[bg], `${name} ${bg}`).toBeTruthy();
        expect(contrast(theme[fg]!, theme[bg]!), `${name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("every module in the menu has its own token in both themes", () => {
    expect(MODULES.map((m) => m.label)).toEqual([
      "Overblik",
      "Opgaver",
      "Bolig og inventar",
      "Arbejdsordrer",
      "Bil",
      "Økonomi",
      "Madplan",
      "Forsikring",
      "Helbred",
      "Dokumenter",
      "AI-indbakke",
      "Lister",
      "Indstillinger",
    ]);
    for (const m of MODULES) {
      expect(tokens(lightBlock)[m.token], m.token).toBeTruthy();
      expect(tokens(darkBlock)[m.token], m.token).toBeTruthy();
    }
  });
});
