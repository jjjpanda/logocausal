import { expect, test } from "@playwright/test";
import { serializeDraft } from "../src/draft";
import type { NetworkModel } from "../src/core/model";
import { fixtureModel } from "../src/core/fixtures";

test("fast playback coalesces continuing machine changes without postponing the update", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.addInitScript(raw => {
    Math.random = () => 0.99;
    // IDs set spring lengths; pin them so the run is repeatable.
    let serial = 0;
    crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
    localStorage.setItem("logocausal:draft:v3", raw);
  }, serializeDraft(fixtureModel("clusters")));
  await page.goto("/?speed=12");
  await expect(page.locator(".machine-name")).toHaveText("Memory & oscillator");
  await page.getByRole("button", { name: "Edit neuron A", exact: true }).click();
  await page.getByLabel("Rule for A").selectOption("not");
  await page.clock.runFor(1000);
  // A light mover does not feed, so no division can break the {A, B} loop during the test.
  await page.getByLabel("Push for A").selectOption("light");
  await page.getByRole("tab", { name: "Population", exact: true }).click();
  await expect(page.locator(".machine-name")).toHaveText("Memory & oscillator");
  await page.clock.runFor(1100);
  await expect(page.locator(".machine-name")).toHaveText("Oscillator");
  await expect(page.locator(".machine-connections")).toContainText("seeks comfortable warmth");
});

test("inspects a six-neuron mechanism without changing the highlighted information score", async ({ page }) => {
  const model: NetworkModel = { version: 1, name: "Six-neuron memory", seed: 1,
    nodes: Array.from({ length: 6 }, (_, i) => ({ id: `whole-${i}`, label: String.fromCharCode(65 + i),
      inputs: [i ? i - 1 : 1], table: [0, 1] })) };
  await page.addInitScript(raw => localStorage.setItem("logocausal:draft:v3", raw), serializeDraft(model));
  await page.goto("/?autoplay=false");
  const machine = page.getByRole("region", { name: "Machine description" });
  await expect(machine.getByRole("button", { name: "Inspect whole circuit" })).toBeVisible();
  const score = await page.getByRole("status", { name: "Finding" }).textContent();
  await machine.getByRole("button", { name: "Inspect whole circuit" }).click();
  await expect(machine.locator(".raster-row")).toHaveCount(6);
  await expect(machine).toContainText("64 possible states");
  await expect(machine.locator(".machine-name")).toHaveText("Memory & oscillator");
  await expect(page.getByRole("status", { name: "Finding" })).toHaveText(score!);
  await machine.getByRole("button", { name: "Back to highlighted group" }).click();
  expect(await machine.locator(".raster-row").count()).toBeLessThan(6);
});

test("recovers from worker startup failures through the analysis retry action", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.Worker = new Proxy(window.Worker, { construct(target, args) {
      if (!Reflect.get(window, "allowAnalysisWorkers")) throw new DOMException("Workers blocked", "SecurityError");
      return Reflect.construct(target, args);
    } });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Analysis could not start");
  await page.evaluate(() => Reflect.set(window, "allowAnalysisWorkers", true));
  await page.getByRole("button", { name: "Retry analysis" }).click();
  await expect(page.getByRole("status", { name: "Finding" })).not.toHaveText("Analysing…");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});
