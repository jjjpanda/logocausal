import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fixtureModel } from "../src/core/fixtures";
import { serializeDraft } from "../src/draft";

const finding = (page: Page) => page.getByRole("status", { name: "Finding" });
const seedFixture = async (page: Page, id: string) => {
  const draft = serializeDraft(fixtureModel(id));
  await page.addInitScript((raw) => {
    if (!localStorage.getItem("logocausal:draft:v3")) localStorage.setItem("logocausal:draft:v3", raw);
  }, draft);
};
const open = async (page: Page, id = "forager") => {
  await seedFixture(page, id);
  await page.goto("/");
};
const editNeuron = (page: Page, label: string) =>
  page.getByRole("button", { name: `Edit neuron ${label}`, exact: true }).click();

test("runs live and reads loops on the overlap network", async ({ page }) => {
  // This test checks a known information score; keep evolution from changing its fixture.
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await open(page, "overlap");
  await expect(page.getByText(/T000[1-9]/)).toBeVisible();
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByText(/PAUSED/)).toBeVisible();
  const hud = await page.locator(".hud").textContent();
  await page.getByRole("button", { name: "Step" }).click();
  await expect(page.locator(".hud")).not.toHaveText(hud!);
  await expect(finding(page)).toHaveText("0.31 bit");
  await expect(page.getByRole("button", { name: /^Inspect group / })).toHaveCount(0);
  await expect(page.locator(".group-summary")).toContainText("{A, B}");
  await expect(page.getByLabel("Displayed group", { exact: true })).toContainText("0.31");
  await editNeuron(page, "B");
  await expect(page.getByLabel("Rule for B")).toHaveValue("or");
  await expect(page.getByText("B′ = A ∨ C")).toBeVisible();
});

test("reports awareness without a loop for a one-way influence", async ({ page }) => {
  await open(page, "oneway");
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(finding(page)).toHaveText("1.00 bit");
  await expect(page.getByLabel("Displayed group", { exact: true })).toContainText("no loop");
  const machine = page.getByRole("region", { name: "Machine description" });
  await expect(machine.locator(".machine-name")).toHaveText("Logic circuit");
  await machine.getByText("Neuron rules", { exact: true }).click();
  await expect(machine.locator(".machine-rules")).toContainText("A: Sensor");
  await expect(machine.locator(".machine-rules")).toContainText("B: COPY");
  await expect(machine.locator(".machine-rules")).toContainText("Copies its input.");
});

for (const width of [1440, 390]) test(`automatically reveals whole-circuit memory at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const model = fixtureModel("overlap");
  model.nodes = model.nodes.map((node, i) => ({ ...node,
    inputs: [0, 1, 2].filter(j => j !== i), table: [0, 1, 1, 1] }));
  await page.addInitScript(raw => {
    Math.random = () => 0.99;
    localStorage.setItem("logocausal:draft:v3", raw);
  }, serializeDraft(model));
  await page.goto("/");
  await page.getByRole("button", { name: /Pause/ }).click();
  const machine = page.getByRole("region", { name: "Machine description" });
  await expect(machine.locator(".machine-name")).toHaveText("Memory & oscillator");
  const whole = machine.getByRole("complementary", { name: "Whole circuit" });
  await expect(whole).toContainText("Whole circuit · {A, B, C}");
  await expect(whole).toContainText("Stable memory");
  await expect(whole).toContainText("Can hold one of up to 2 steady patterns.");
  await expect(whole).toContainText("Live activity above shows {A, B}.");
  await expect(machine.getByRole("combobox")).toHaveCount(0);
  await expect(machine.locator(".raster-row")).toHaveCount(2);
  await expect(page.locator(".group-summary")).toContainText("{A, B}");
});

test("editing rules turns separate neurons into a loop", async ({ page }) => {
  await open(page, "independent");
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(finding(page)).toContainText("No group");
  await editNeuron(page, "A");
  await page.getByLabel("Add input to A").selectOption({ label: "B" });
  await editNeuron(page, "B");
  await page.getByLabel("Add input to B").selectOption({ label: "A" });
  await expect(page.getByText("B′ = ¬A", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Population", exact: true }).click();
  await expect(finding(page)).toHaveText("1.00 bit");
});

test("inspects one neuron with activity and energy history and no neuron creation controls", async ({ page }) => {
  await open(page, "forager");
  await page.getByRole("button", { name: /Pause/ }).click();
  await editNeuron(page, "C");
  const panel = page.getByRole("region", { name: "Neuron details" });
  await expect(panel.locator(".neuron-title")).toContainText("Neuron C");
  await expect(page.getByRole("button", { name: "+ Add neuron" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Random gen" })).toHaveCount(0);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(page.getByLabel("Activity history for C", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Energy history for C", { exact: true })).toBeVisible();
  await panel.getByText("Energy budget", { exact: false }).click();
  await expect(panel.getByRole("definition").first()).toBeVisible();
  await page.getByLabel("Selected neuron", { exact: true }).selectOption({ label: "Neuron A" });
  await expect(page.getByLabel("Activity history for A", { exact: true })).toBeVisible();
});

test("configures push neurons toward food or light in the neuron inspector", async ({ page }) => {
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

test("has a usable mobile layout, starts with 6 random neurons, and supports Random gen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Pause/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit neuron / })).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "No neurons.", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Reset/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Random gen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Generate a random population?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(page.locator(".graph-node")).toHaveCount(6);
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit neuron / })).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("Random gen keeps the current network until confirmed and supports cancellation", async ({ page }) => {
  await open(page, "overlap");
  await page.getByRole("button", { name: /Pause/ }).click();
  await page.getByRole("button", { name: "Step", exact: true }).click();
  const draft = await page.evaluate(() => localStorage.getItem("logocausal:draft:v3"));
  const trigger = page.getByRole("button", { name: "Random gen", exact: true });
  const dialog = page.getByRole("dialog", { name: "Generate a random population?" });
  await trigger.click();
  await expect(dialog).toContainText("replaces the current network");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("logocausal:draft:v3"))).toBe(draft);
  await expect(page.locator(".hud")).toContainText("T0001");
  await trigger.click();
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".graph-node")).toHaveCount(6);
  await expect(page.locator(".hud")).toContainText("T0000");
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
  await expect(page.getByRole("status", { name: "Draft status" })).toHaveCount(0);
  await editNeuron(page, "A");
  await expect(page.getByLabel("Rule for A")).toHaveValue("not");
});

test("recovers from a malformed or empty saved draft with a random population", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("logocausal:draft:v3", "{"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Edit neuron / })).toHaveCount(6);
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
  await expect(page.getByRole("button", { name: /^Edit neuron / })).toHaveCount(6);
  await expect(finding(page)).not.toHaveText("Analysing…");
});

test("defaults to dark mode and the icon checkbox switches themes without changing sunlight", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(page.getByRole("checkbox", { name: "Sun", exact: true })).toHaveCount(0);
  await expect(page.locator(".sun")).toHaveCount(1);
  const theme = page.getByRole("checkbox", { name: "Dark mode", exact: true });
  await expect(theme).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".theme-toggle")).toHaveAttribute("title", "Switch to light mode");
  await theme.uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".theme-toggle")).toHaveAttribute("title", "Switch to dark mode");
  await theme.check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".sun")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a sensor rule reads the world and can also connect and move", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  await editNeuron(page, "C");
  await page.getByLabel("Sense for C").selectOption("light");
  await expect(page.getByText("C′ = ☀ ∨ (A ∨ D) ◎◆")).toBeVisible();
});

test("retains deceased neuron histories and allows revisiting them", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await open(page, "independent");
  await page.getByRole("button", { name: /Pause/ }).click();
  await page.getByRole("tab", { name: "Neuron", exact: true }).click();
  for (let i = 0; i < 240 && await page.locator('optgroup[label="Recent deceased"] option').count() < 2; i++) {
    await page.getByRole("button", { name: "Step", exact: true }).click();
  }
  const select = page.getByLabel("Selected neuron", { exact: true });
  const archived = await page.locator('optgroup[label="Recent deceased"] option').evaluateAll(options => options.map(o => ({ id: (o as HTMLOptionElement).value, label: o.textContent!.replace("Neuron ", "").replace(" · died", "") })));
  expect(archived.length).toBeGreaterThanOrEqual(2);
  const [first, second] = archived;
  await select.selectOption(first.id);
  await expect(page.locator(".state-badge")).toHaveText("Died");
  await expect(page.getByLabel(`Activity history for ${first.label}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel(`Life history for ${first.label}`, { exact: true })).toContainText("starved");
  await select.selectOption(second.id);
  await expect(page.getByLabel(`Activity history for ${second.label}`, { exact: true })).toBeVisible();
  await select.selectOption(first.id);
  await expect(page.getByLabel(`Activity history for ${first.label}`, { exact: true })).toBeVisible();
});

test("keeps neuron names readable and explains each role and state on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.locator(".node-name")).toHaveText(["A", "B", "C", "D", "E"]);
  await expect(page.locator(".node-role")).toHaveText(["Food", "Light", "OR", "COPY", "NOT"]);
  await expect.poll(() => page.locator(".node-name").first().evaluate(el => {
    const matrix = (el as SVGGraphicsElement).getScreenCTM()!;
    return parseFloat(getComputedStyle(el).fontSize) * Math.hypot(matrix.a, matrix.b);
  })).toBeGreaterThanOrEqual(18);
  await expect(page.locator("circle.neuron-body")).toHaveCount(5);
  await expect(page.locator(".node-status, .selection-ring, .mover-badge")).toHaveCount(0);
  await expect(page.locator(".node-caption")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Edit neuron A", exact: true })).toHaveAccessibleDescription(/Senses food.*Energy/);
  const labels = await page.locator(".node-name").evaluateAll(elements => elements.map(el => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }));
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
  }
});

test("shows signal histories and trails at high speed and exact states when paused or slowed", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await open(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  const speed = page.getByRole("slider");
  await speed.focus();
  await speed.press("End");
  await expect(speed).toHaveValue("12");
  await page.getByRole("button", { name: /Play/ }).click();
  await expect(page.locator(".network-svg")).toHaveClass(/calm/);
  await expect(page.locator(".graph-legend")).toHaveCount(0);
  await expect(page.locator(".signal-history")).toHaveCount(5);
  await expect(page.locator(".signal-history rect")).toHaveCount(60);
  const neuron = page.getByRole("button", { name: "Edit neuron A", exact: true });
  await expect(neuron).toHaveAccessibleDescription(/% on over the last/);
  const before = await page.locator(".hud").textContent();
  await expect(page.locator(".hud")).not.toHaveText(before!);
  await expect.poll(() => page.locator(".signal-flight").count()).toBeGreaterThan(0);
  await expect(page.locator(".pulse, .reach-out, .graph-node.on, .graph-node.tired")).toHaveCount(0);
  expect(await page.locator(".spawn").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.locator(".network-svg")).not.toHaveClass(/calm/);
  await expect(page.locator(".signal-history, .signal-flight")).toHaveCount(0);
  await expect(neuron).not.toHaveAccessibleDescription(/% on over the last/);
  await speed.focus();
  await speed.press("Home");
  await page.getByRole("button", { name: /Play/ }).click();
  await expect(page.locator(".network-svg")).not.toHaveClass(/calm/);
});

test("explains a top-ranked group's circuit and observed behavior", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await open(page, "overlap");
  await page.getByRole("button", { name: /Pause/ }).click();
  const machine = page.getByRole("region", { name: "Machine description" });
  await expect(machine.locator(".machine-name")).toHaveText("Memory & oscillator");
  await expect(machine).toContainText("Outside inputs held steady; all neurons update together.");
  await expect(machine).toContainText("Observing");
  for (let i = 0; i < 14; i++) await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(machine.locator(".machine-observation")).not.toContainText("Observing");
  await expect(machine.locator(".raster-row")).toHaveCount(2);
  await expect(machine.locator(".machine-raster")).toHaveAttribute("aria-label", /last 14 ticks/);
  // An edit outside this group preserves its own observed signal history.
  await editNeuron(page, "C");
  await page.getByLabel("Rule for C").selectOption("not");
  await page.getByRole("tab", { name: "Population", exact: true }).click();
  await expect(machine.locator(".machine-observation")).not.toContainText("Observing");
  // Changing the circuit invalidates old observations.
  await editNeuron(page, "B");
  await page.getByLabel("Rule for B").selectOption("xor");
  await page.getByRole("tab", { name: "Population", exact: true }).click();
  await expect(machine.locator(".machine-observation")).toContainText("Observing");
  // XOR closes a three-neuron loop, which outranks the two-neuron self-predicting groups.
  // A rule change invalidates inference, not the recorded timeline.
  await expect(machine.locator(".raster-row")).toHaveCount(3);
  await expect(machine.locator(".machine-raster")).toHaveAttribute("aria-label", /last 14 ticks/);
  await expect(machine.locator(".raster-row i:not(.empty)")).toHaveCount(42);
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(machine.locator(".rule-change")).toHaveCount(3);
});

test("keeps high-speed history visible with reduced motion and suppresses trails", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await open(page);
  const speed = page.getByRole("slider");
  await speed.focus();
  await speed.press("End");
  await expect(page.locator(".signal-history")).toHaveCount(5);
  await expect(page.locator(".signal-flight")).toHaveCount(0);
});

test("holds a leading group until a meaningful lead lasts two seconds", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await open(page, "clusters");
  await expect(page.locator(".group-summary")).toContainText("{A, B}");
  await page.locator(".leader-note").evaluate(note => {
    note.setAttribute("data-text-changes", "0");
    new MutationObserver(() => note.setAttribute("data-text-changes", String(Number(note.getAttribute("data-text-changes")) + 1)))
      .observe(note, { childList: true, characterData: true, subtree: true });
  });
  await editNeuron(page, "A");
  await page.getByLabel("Sense for A").selectOption("food");
  await page.getByRole("tab", { name: "Population", exact: true }).click();
  await expect(page.locator(".leader-note")).toHaveText("Stable view · pause for exact ranking");
  await expect(page.locator(".group-summary")).toContainText("{A, B}");
  await expect(page.locator(".group-summary")).toContainText("{C, D}", { timeout: 4000 });
  // Worker refreshes, challenger changes and the settled handoff must not flash new hints.
  await expect(page.locator(".leader-note")).toHaveAttribute("data-text-changes", "0");
});

test("pausing bypasses the group settling delay", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await open(page, "clusters");
  await expect(page.locator(".group-summary")).toContainText("{A, B}");
  await editNeuron(page, "A");
  await page.getByLabel("Sense for A").selectOption("food");
  await page.getByRole("tab", { name: "Population", exact: true }).click();
  await expect(page.locator(".group-summary")).toContainText("{A, B}");
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.locator(".group-summary")).toContainText("{C, D}");
  await expect(page.locator(".leader-note")).toHaveText("Exact ranking · paused");
});

test("collects machine changes for a reading interval and keeps whole-circuit inspection available", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await open(page, "overlap");
  await expect(page.locator(".machine-name")).toHaveText("Memory & oscillator");
  await expect(page.locator(".machine-context")).toBeVisible();
  await editNeuron(page, "A");
  await page.getByLabel("Rule for A").selectOption("not");
  await page.getByRole("tab", { name: "Population", exact: true }).click();
  await expect(page.locator(".machine-pending")).toContainText("last settled type");
  await expect(page.locator(".machine-name")).toHaveText("Memory & oscillator");
  await expect(page.getByRole("button", { name: "Inspect whole circuit", exact: true })).toBeVisible();
  await expect(page.locator(".machine-raster")).toBeVisible();
  await expect(page.locator(".machine-name")).toHaveText("Oscillator", { timeout: 3000 });
  await expect(page.locator(".machine-pending")).toHaveCount(0);
  await expect(page.locator(".machine-context")).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`combines details, charts and guide in accessible tabs at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.getByRole("button", { name: /Pause/ }).click();
    const tabs = page.getByRole("tablist", { name: "Inspector panels" });
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.locator(".side .vitals")).toBeVisible();
    await expect(page.locator(".graph-panel .vitals, .graph-legend")).toHaveCount(0);
    const canvas = await page.locator(".habitat-canvas").boundingBox();
    const svg = await page.locator(".network-svg").boundingBox();
    expect(Math.abs(canvas!.height - svg!.height)).toBeLessThan(1);
    await expect(page.getByText("Logocausal", { exact: true })).toHaveCount(0);
    const centers = await page.locator(".brand-mark").evaluate(el => {
      const mark = el.getBoundingClientRect(), icon = el.querySelector("img")!.getBoundingClientRect();
      return { x: Math.abs(mark.x + mark.width / 2 - icon.x - icon.width / 2), y: Math.abs(mark.y + mark.height / 2 - icon.y - icon.height / 2) };
    });
    expect(centers.x).toBeLessThan(0.5);
    expect(centers.y).toBeLessThan(0.5);
    const population = tabs.getByRole("tab", { name: "Population", exact: true });
    await population.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Neuron", exact: true })).toBeFocused();
    await expect(page.getByRole("region", { name: "Neuron details", exact: true })).toBeVisible();
    await page.keyboard.press("End");
    await expect(tabs.getByRole("tab", { name: "Guide", exact: true })).toBeFocused();
    await expect(page.getByRole("region", { name: "Simulation guide" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Visual key" })).toBeVisible();
    await expect(page.getByLabel("Explore", { exact: true })).toContainText("Inspect");
    await expect(page.locator(".guide-life")).toContainText("0 energy → die");
    await expect(page.getByText("Read food or light.", { exact: true })).not.toBeVisible();
    await page.getByText("Cells & rules", { exact: true }).click();
    await expect(page.getByText("Read food or light.", { exact: true })).toBeVisible();
    await tabs.getByRole("tab", { name: "Guide", exact: true }).focus();
    await page.keyboard.press("Home");
    await expect(population).toBeFocused();
    await editNeuron(page, "C");
    await expect(tabs.getByRole("tab", { name: "Neuron", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".neuron-title")).toContainText("Neuron C");
  });
}

test("pausing freezes the physical environment and stepping advances it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  const neuron = page.getByRole("button", { name: "Edit neuron C", exact: true });
  await expect(neuron).toBeVisible();
  const before = await neuron.getAttribute("transform");
  await page.waitForTimeout(400);
  expect(await neuron.getAttribute("transform")).toBe(before);
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(neuron).not.toHaveAttribute("transform", before!);
});

test("keeps the sun on the visible boundary through resizes and draws food as zones", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Pause/ }).click();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator(".network-svg").evaluate(el => {
      const svg = el as SVGSVGElement;
      const rect = svg.getBoundingClientRect();
      return Math.abs(svg.viewBox.baseVal.width / svg.viewBox.baseVal.height - rect.width / rect.height);
    })).toBeLessThan(0.001);
    const distanceToEdge = await page.locator(".sun").evaluate(el => {
      const group = el as SVGGraphicsElement;
      const svg = group.ownerSVGElement!;
      const point = svg.createSVGPoint().matrixTransform(group.getScreenCTM()!);
      const rect = svg.getBoundingClientRect();
      return Math.min(Math.abs(point.x - rect.left), Math.abs(point.x - rect.right),
        Math.abs(point.y - rect.top), Math.abs(point.y - rect.bottom));
    });
    expect(distanceToEdge).toBeLessThan(0.5);
    await expect(page.locator(".food polygon")).toHaveCount(0);
    expect(await page.locator(".food .zone.feed").count()).toBeGreaterThan(0);
  }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
  test(`fits the entire workspace in ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page);
    await page.getByRole("button", { name: /Pause/ }).click();
    await page.getByRole("tab", { name: "Neuron", exact: true }).click();
    const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, innerWidth, innerHeight }));
    expect(size.width).toBeLessThanOrEqual(size.innerWidth);
    expect(size.height).toBeLessThanOrEqual(size.innerHeight);
    for (const selector of [".app-header", ".graph-panel", ".inspector"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      expect(box!.height).toBeGreaterThan(0);
    }
    const panel = page.locator(".inspector .panel-scroll");
    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByText("Life history", { exact: true })).toBeVisible();
  });
}
