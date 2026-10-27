import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fixtureModel } from "../src/core/fixtures";
import { serializeDraft } from "../src/draft";

const finding = (page: Page) => page.getByRole("status", { name: "Finding" });
const seedFixture = async (page: Page, id: string) => {
  const draft = serializeDraft(fixtureModel(id));
  await page.addInitScript((raw) => localStorage.setItem("logocausal:draft:v3", raw), draft);
};
const open = async (page: Page, id = "forager") => {
  await seedFixture(page, id);
  await page.goto("/");
};
const editNeuron = (page: Page, label: string) =>
  page.getByRole("button", { name: `Edit neuron ${label}`, exact: true }).click();

test("runs live and reads loops on the overlap network", async ({ page }) => {
  await open(page, "overlap");
  await expect(page.getByText(/T000[1-9]/)).toBeVisible();
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByText(/PAUSED/)).toBeVisible();
  const hud = await page.locator(".hud").textContent();
  await page.getByRole("button", { name: "Step" }).click();
  await expect(page.locator(".hud")).not.toHaveText(hud!);
  await expect(finding(page)).toHaveText("2 loops");
  await expect(page.getByRole("button", { name: "Inspect group {B, C}", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inspect group {A, B}", exact: true }).click();
  await expect(page.getByLabel("Selected group")).toContainText("0.31");
  await editNeuron(page, "B");
  await expect(page.getByLabel("Rule for B")).toHaveValue("or");
  await expect(page.getByText("B′ = A ∨ C")).toBeVisible();
});

test("reports awareness without a loop for a one-way influence", async ({ page }) => {
  await open(page, "oneway");
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(finding(page)).toHaveText("No loops");
  await page.getByRole("button", { name: "Inspect group {A, B}", exact: true }).click();
  await expect(page.getByLabel("Selected group")).toContainText("no loop");
});

test("editing rules turns separate neurons into a loop", async ({ page }) => {
  await open(page, "independent");
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(finding(page)).toContainText("No loops");
  await editNeuron(page, "A");
  await page.getByLabel("Add input to A").selectOption({ label: "B" });
  await editNeuron(page, "B");
  await page.getByLabel("Add input to B").selectOption({ label: "A" });
  await expect(page.getByText("B′ = ¬A", { exact: true })).toBeVisible();
  await expect(finding(page)).toHaveText("1 loop");
});

test("caps the network at 24 neurons and still analyses it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  const add = page.getByRole("button", { name: "+ Add neuron" });
  for (let i = 0; i < 19; i++) await add.click();
  await expect(add).toBeDisabled();
  await expect(finding(page)).toContainText("loop", { timeout: 60_000 });
});

test("configures push neurons toward food or light in the combined Network/Rule panel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  await editNeuron(page, "C");
  await expect(page.getByLabel("Push for C")).toHaveValue("food");
  await expect(page.getByText("C′ = A ∨ D ◎◆")).toBeVisible();
  await page.getByLabel("Push for C").selectOption("light");
  await expect(page.getByText("C′ = A ∨ D ◎☀")).toBeVisible();
  expect(errors).toEqual([]);
});

test("has a usable mobile layout, starts with 0 neurons, and supports Random gen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Pause/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit neuron / })).toHaveCount(0);
  await page.getByRole("button", { name: "Random gen" }).first().click();
  await expect(page.getByRole("button", { name: /^Edit neuron / })).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("restores edited rules after a reload", async ({ page }) => {
  await open(page, "independent");
  await page.getByRole("button", { name: /Pause/ }).click();
  await editNeuron(page, "A");
  await page.getByLabel("Add input to A").selectOption({ label: "B" });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("logocausal:draft:v3")))
    .toContain('"table":[1,0]');
  await page.reload();
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByRole("status", { name: "Draft status" })).toContainText("Draft restored");
  await editNeuron(page, "A");
  await expect(page.getByLabel("Rule for A")).toHaveValue("not");
});

test("recovers from a malformed saved draft", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("logocausal:draft:v3", "{"));
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Draft status" })).toContainText("could not be read");
  await expect(page.getByRole("button", { name: /^Edit neuron / })).toHaveCount(0);
});

test("works when draft storage is unavailable", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Unavailable", "SecurityError");
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Draft status" })).toContainText("Draft storage unavailable");
  await expect(finding(page)).toHaveText("1 loop");
});

test("neurons freeze to death without sun", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("slider").first().fill("12");
  await page.getByRole("checkbox", { name: /Sun/ }).uncheck();
  await expect(page.getByLabel("Life log")).toContainText("froze", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("a sensor rule reads the world and can also connect and move", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  await editNeuron(page, "C");
  await page.getByLabel("Sense for C").selectOption("light");
  await expect(page.getByText("C′ = ☀ ∨ (A ∨ D) ◎◆")).toBeVisible();
});
