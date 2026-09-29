import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, tokensIn } from "./contrast";

/**
 * NFR-A11Y-004: WCAG 2.1 AA contrast across the design tokens, in both
 * themes. Text needs 4.5:1 (the UI's body text is 14px, so the "large text"
 * 3:1 allowance never applies). Focus rings and input borders are non-text
 * UI (1.4.11) and need 3:1 against what they sit on.
 */
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf-8");
const light = tokensIn(css, ":root");
const dark = tokensIn(css, ':root[data-theme="dark"]');
const darkByOs = tokensIn(css, ':root:not([data-theme="light"])');

const TEXT = 4.5;
const UI = 3;

/** [foreground, background, minimum]: every pairing the components use. */
const PAIRS: [string, string, number][] = [
  ...["foreground", "muted", "subtle"].flatMap((fg) =>
    ["background", "surface", "surface-muted"].map((bg): [string, string, number] => [fg, bg, TEXT]),
  ),
  ["primary", "surface", TEXT],
  ["primary", "background", TEXT],
  ["primary", "primary-surface", TEXT],
  ["primary-foreground", "primary", TEXT],
  ["primary-foreground", "primary-hover", TEXT],
  ...["success", "warning", "danger", "info"].flatMap((tone): [string, string, number][] => [
    [tone, `${tone}-surface`, TEXT],
    [tone, "surface", TEXT],
  ]),
  ["muted", "primary-surface", TEXT],
  ["danger-foreground", "danger", TEXT],
  ["focus-ring", "background", UI],
  ["focus-ring", "surface", UI],
  ["border-strong", "surface", UI],
  ["border-strong", "background", UI],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast (WCAG 2.1 AA)", (_name, tokens) => {
  it.each(PAIRS)("%s on %s ≥ %s:1", (fg, bg, min) => {
    expect(tokens[fg], `missing --${fg}`).toBeDefined();
    expect(tokens[bg], `missing --${bg}`).toBeDefined();
    expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe("theme definitions", () => {
  it("defines the OS-preference dark theme exactly like the explicit one", () => {
    expect(darkByOs).toEqual(dark);
  });

  it("gives every light token a dark pair", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("computes known reference ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});
